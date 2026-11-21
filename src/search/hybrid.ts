/**
 * Hybrid search over doc_chunks: vector similarity (multilingual-e5-small) and keyword rank,
 * merged by reciprocal rank fusion in the SQL function search_doc_chunks.
 *
 * A question in a non-Latin script (Bengali, Hindi) is also translated to English and searched again.
 * The two result lists are merged by the best score of each chunk. A failed translation does not stop the search.
 */
import { admin } from "@/lib/supabase";
import { embed, toPgVector } from "@/lib/embeddings";
import { hasNonLatinScript } from "./lang";
import { translateToEnglish } from "./translate";

export interface SearchHit {
  id: string;
  text: string;
  source_id: string;
  source_type: "document" | "message";
  document_id: string | null;
  message_id: string | null;
  page: number | null;
  score: number;
  vector_score: number | null;
  keyword_score: number | null;
}

export interface SearchOptions {
  caseId?: string;
  vendorId?: string;
  limit?: number;
  /** Also search an English translation of a non-Latin question. Default: on, unless SEARCH_TRANSLATE=off. */
  translate?: boolean;
}

export interface SearchInfo {
  hits: SearchHit[];
  /** The English text that was also searched, or null. */
  translation: string | null;
}

// Words that carry no meaning for the keyword half. The vector half still sees the whole question.
const STOPWORDS = new Set(
  ("a an and are as at be by can could did do does for from give gives given has have how i in is it its me my of on or our " +
    "please quote quoted quotes says show tell than that the their them there these they this to us was we were what when where " +
    "which who whom whose why will with would you your any all about").split(" "),
);

/** The meaningful words of a question, in lower case, without repeats. Exported for tests. */
export function keywordTerms(q: string): string[] {
  const tokens = ((q ?? "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+(?:[.'][\p{L}\p{M}\p{N}]+)*/gu) ?? []).filter(
    (t) => !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)),
  );
  return [...new Set(tokens)];
}

/**
 * The keyword half needs short terms joined by OR: with AND, a whole question rarely matches one chunk.
 * Returns a websearch_to_tsquery string such as `warranty or 10 or years`. Exported for tests.
 */
export function keywordQuery(q: string, terms: string[] = keywordTerms(q)): string {
  return terms.length ? terms.join(" or ") : q.trim();
}

/**
 * Postgres keyword rank has no inverse document frequency: a word on every page ("Fosroc", "waterproofing")
 * counts as much as a rare one ("CICO"). So drop the words that are in more than `maxShare` of the chunks.
 * When every word is common, keep the rarest one. Exported for tests.
 */
export function pickRareTerms(terms: string[], df: Map<string, number>, total: number, maxShare = 0.3): string[] {
  if (total < 20 || terms.length <= 1) return terms;
  const rare = terms.filter((t) => (df.get(t) ?? 0) / total <= maxShare);
  if (rare.length) return rare;
  return [terms.reduce((a, b) => ((df.get(b) ?? 0) < (df.get(a) ?? 0) ? b : a))];
}

const dfCache = new Map<string, { at: number; n: number }>();
const DF_TTL_MS = 5 * 60 * 1000;

/** How many chunks (in the same case and vendor filter) contain each word. Cached for 5 minutes. */
async function documentFrequencies(terms: string[], opts: SearchOptions): Promise<{ df: Map<string, number>; total: number }> {
  const scope = `${opts.caseId ?? "*"}|${opts.vendorId ?? "*"}`;
  const count = async (term: string | null) => {
    const key = `${scope}|${term ?? ""}`;
    const hit = dfCache.get(key);
    if (hit && Date.now() - hit.at < DF_TTL_MS) return hit.n;
    let q = admin().from("doc_chunks").select("id", { count: "exact", head: true });
    if (opts.caseId) q = q.eq("case_id", opts.caseId);
    if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
    if (term) q = q.textSearch("tsv", term, { config: "simple", type: "plain" });
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    dfCache.set(key, { at: Date.now(), n: n ?? 0 });
    return n ?? 0;
  };
  const [total, ...counts] = await Promise.all([count(null), ...terms.map((t) => count(t))]);
  return { df: new Map(terms.map((t, i) => [t, counts[i]])), total };
}

/** The keyword text for the SQL function: rare words joined by OR. Falls back to all words on any error. */
async function keywordText(q: string, opts: SearchOptions): Promise<string> {
  const terms = keywordTerms(q);
  if (terms.length <= 1) return keywordQuery(q, terms);
  try {
    const { df, total } = await documentFrequencies(terms, opts);
    return keywordQuery(q, pickRareTerms(terms, df, total));
  } catch {
    return keywordQuery(q, terms);
  }
}

/** Merge result lists: one hit per chunk with its best score, best first. Exported for tests. */
export function mergeHits(lists: SearchHit[][], limit: number): SearchHit[] {
  const best = new Map<string, SearchHit>();
  for (const list of lists) {
    for (const h of list) {
      const prev = best.get(h.id);
      if (!prev) {
        best.set(h.id, { ...h });
        continue;
      }
      const top = h.score > prev.score ? { ...h } : { ...prev };
      top.vector_score = maxOrNull(prev.vector_score, h.vector_score);
      top.keyword_score = maxOrNull(prev.keyword_score, h.keyword_score);
      best.set(h.id, top);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

const maxOrNull = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

interface Row {
  id: string; document_id: string | null; message_id: string | null; case_id: string | null; vendor_id: string | null;
  page: number | null; content: string; source_type: string; vector_score: number | null; keyword_score: number | null; score: number;
}

async function searchOnce(q: string, opts: SearchOptions, limit: number): Promise<SearchHit[]> {
  const [[vector], queryText] = await Promise.all([embed([q], "query"), keywordText(q, opts)]);
  const { data, error } = await admin().rpc("search_doc_chunks", {
    query_embedding: toPgVector(vector),
    query_text: queryText,
    match_count: limit,
    filter_case: opts.caseId ?? null,
    filter_vendor: opts.vendorId ?? null,
  });
  if (error) throw new Error(`search_doc_chunks failed: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    text: r.content,
    source_id: (r.document_id ?? r.message_id)!,
    source_type: r.source_type === "message" ? "message" : "document",
    document_id: r.document_id,
    message_id: r.message_id,
    page: r.page,
    score: Number(r.score),
    vector_score: r.vector_score == null ? null : Number(r.vector_score),
    keyword_score: r.keyword_score == null ? null : Number(r.keyword_score),
  }));
}

export async function searchWithInfo(q: string, opts: SearchOptions = {}): Promise<SearchInfo> {
  const query = (q ?? "").trim();
  if (!query) return { hits: [], translation: null };
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 10)));
  const wantTranslation = (opts.translate ?? process.env.SEARCH_TRANSLATE !== "off") && hasNonLatinScript(query);

  const [original, translation] = await Promise.all([
    searchOnce(query, opts, limit),
    wantTranslation ? translateToEnglish(query).catch(() => null) : Promise.resolve(null),
  ]);
  if (!translation || translation.toLowerCase() === query.toLowerCase()) return { hits: original, translation: null };
  try {
    const english = await searchOnce(translation, opts, limit);
    return { hits: mergeHits([original, english], limit), translation };
  } catch (e) {
    console.warn(`[search] search on the translation failed: ${(e as Error).message}`);
    return { hits: original, translation: null };
  }
}

export async function hybridSearch(
  q: string,
  opts?: { caseId?: string; vendorId?: string; limit?: number; translate?: boolean },
): Promise<SearchHit[]> {
  return (await searchWithInfo(q, opts)).hits;
}

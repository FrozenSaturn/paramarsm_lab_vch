/**
 * Optional query translation for search. A question in Bengali or Hindi is also translated to English,
 * because the quotes are in English and the local embedding model matches across languages only weakly.
 *
 * The model only translates a short search question. It has no tools. Any failure returns null,
 * and search then runs on the original question alone.
 */
import Anthropic from "@anthropic-ai/sdk";

/** A small, fast model is enough for a one-line translation. */
export const TRANSLATE_MODEL = process.env.SEARCH_TRANSLATE_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = Number(process.env.SEARCH_TRANSLATE_TIMEOUT_MS || 8000);

const SYSTEM = [
  "You translate search questions for a construction procurement team in Kolkata.",
  "Translate the user's text into plain English.",
  "Keep vendor names, brand names, product codes, numbers and units exactly as written.",
  "Common terms: quotation, rate, warranty, payment terms, advance, GST, BOQ, waterproofing, RA bill, work order.",
  "Reply with the English text only. Do not answer the question. Do not add notes.",
].join("\n");

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 }));

const cache = new Map<string, string>();

/** Clean a model reply into a single search line. Exported for tests. */
export function cleanTranslation(reply: string): string | null {
  const line = reply
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(english|translation)\s*:\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (!line || line.length > 500) return null;
  return line;
}

export async function translateToEnglish(text: string): Promise<string | null> {
  const q = text.trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q)!;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  try {
    const msg = await anthropic().messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 400,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: q }],
    });
    if (msg.stop_reason === "refusal") return null;
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    const en = cleanTranslation(reply);
    if (en) {
      if (cache.size > 500) cache.clear();
      cache.set(q, en);
    }
    return en;
  } catch (e) {
    console.warn(`[search] translation failed, searching the original text only: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Audit timeline data (PLAN.md section 8). Server only: it uses the service key.
 *
 * It reads four append-only records and merges them into one list, newest first:
 *   - events: what happened in the world
 *   - agent_steps: what an agent did, and why
 *   - actions with their receipts: what a person approved and what was executed
 *   - decisions with their recommendations: what the HOD decided
 * It resolves user ids to emails, vendor ids to names and case ids to titles.
 * The pure helpers below have no network access, so the tests can call them.
 */
import { admin } from "@/lib/supabase";

export type AuditType = "event" | "step" | "action" | "decision";
export type AuditFilter = AuditType | "all";

export type AuditLink = { label: string; href: string };

export type AuditItem = {
  id: string;
  at: string;
  type: AuditType;
  who: string;
  what: string;
  why: string | null;
  case_id: string | null;
  case_title: string | null;
  links: AuditLink[];
  /** True for a decision of kind override. The UI marks these clearly. */
  override: boolean;
  /** Proof of execution, from the receipt of an action. */
  proof: { payload_hash: string; executed_at: string | null; provider_id: string | null } | null;
  details: Record<string, unknown>;
};

export type Lookups = {
  emails: Map<string, string>;
  vendors: Map<string, string>;
  cases: Map<string, string>;
};

export type EventRow = { id: string; name: string; case_id: string | null; payload: unknown; actor: string | null; created_at: string | null };
export type StepRow = {
  id: string; case_id: string | null; workflow: string | null; step: string; status: string | null; model: string | null;
  prompt_version: string | null; reasoning: string | null; cost_usd: number | string | null; started_at: string | null; finished_at: string | null;
};
export type ActionRow = {
  id: string; case_id: string | null; kind: string; status: string; payload: unknown; proposed_by: string | null; approved_by: string | null;
  edited_by: string | null; approved_at: string | null; reject_reason: string | null; error: string | null; created_at: string | null;
};
export type ReceiptRow = { action_id: string; payload_hash: string; approved_by: string | null; approved_at: string | null; executed_at: string | null; provider_id: string | null };
export type DecisionRow = {
  id: string; recommendation_id: string | null; case_id?: string | null; vendor_id: string | null; decided_by: string | null;
  kind?: string | null; overridden?: boolean | null; top_vendor_id?: string | null; reason: string | null; created_at: string | null;
};
export type RecommendationRow = { id: string; case_id?: string | null; top_vendor_id?: string | null };

const EPOCH = "1970-01-01T00:00:00.000Z";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const shortHash = (h: string | null | undefined, n = 10) => (h ? h.slice(0, n) : "");

/** Gives the email for a user id. Gives the raw value for a workflow name or an unknown id. */
export function resolveWho(id: string | null | undefined, emails: Map<string, string>): string {
  if (!id) return "system";
  return emails.get(id) ?? id;
}

function caseLink(caseId: string | null, l: Lookups): { case_title: string | null; links: AuditLink[] } {
  if (!caseId) return { case_title: null, links: [] };
  const title = l.cases.get(caseId) ?? null;
  return { case_title: title, links: [{ label: title ?? "Case", href: `/cases/${caseId}` }] };
}

const vendorLink = (vendorId: string | null | undefined, l: Lookups): AuditLink[] =>
  vendorId ? [{ label: l.vendors.get(vendorId) ?? "Vendor", href: `/vendors/${vendorId}` }] : [];

/** Finds vendor ids in a payload: `vendor_id`, `top_vendor_id` and `vendor_ids`. */
export function payloadVendorIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["vendor_id", "top_vendor_id"]) if (typeof p[k] === "string") out.push(p[k] as string);
  if (Array.isArray(p.vendor_ids)) for (const v of p.vendor_ids) if (typeof v === "string") out.push(v);
  return [...new Set(out)];
}

export function eventItem(r: EventRow, l: Lookups): AuditItem {
  const c = caseLink(r.case_id, l);
  return {
    id: `event:${r.id}`, at: r.created_at ?? EPOCH, type: "event", who: resolveWho(r.actor, l.emails), what: r.name, why: null,
    case_id: r.case_id, case_title: c.case_title, links: [...c.links, ...payloadVendorIds(r.payload).flatMap((v) => vendorLink(v, l))],
    override: false, proof: null, details: { payload: r.payload },
  };
}

export function stepItem(r: StepRow, l: Lookups): AuditItem {
  const c = caseLink(r.case_id, l);
  const what = `${r.workflow ? `${r.workflow} / ` : ""}${r.step}${r.status ? ` (${r.status})` : ""}`;
  return {
    id: `step:${r.id}`, at: r.finished_at ?? r.started_at ?? EPOCH, type: "step", who: r.workflow ? `agent ${r.workflow}` : "agent", what,
    why: r.reasoning, case_id: r.case_id, case_title: c.case_title, links: c.links, override: false, proof: null,
    details: { model: r.model, prompt_version: r.prompt_version, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd), started_at: r.started_at, finished_at: r.finished_at },
  };
}

export function actionItem(r: ActionRow, receipt: ReceiptRow | undefined, l: Lookups): AuditItem {
  const c = caseLink(r.case_id, l);
  const actor = r.approved_by ?? r.edited_by ?? r.proposed_by;
  const why = r.reject_reason ? `Rejected: ${r.reject_reason}` : r.error ? `Error: ${r.error}` : null;
  const links = [...c.links, ...payloadVendorIds(r.payload).flatMap((v) => vendorLink(v, l))];
  if (r.status === "proposed" || r.status === "edited") links.push({ label: "Approvals", href: "/approvals" });
  return {
    id: `action:${r.id}`, at: receipt?.executed_at ?? r.approved_at ?? r.created_at ?? EPOCH, type: "action", who: resolveWho(actor, l.emails),
    what: `${r.kind}: ${r.status}`, why, case_id: r.case_id, case_title: c.case_title, links, override: false,
    proof: receipt ? { payload_hash: receipt.payload_hash, executed_at: receipt.executed_at, provider_id: receipt.provider_id } : null,
    details: {
      proposed_by: resolveWho(r.proposed_by, l.emails), edited_by: r.edited_by ? resolveWho(r.edited_by, l.emails) : null,
      approved_by: r.approved_by ? resolveWho(r.approved_by, l.emails) : null, approved_at: r.approved_at, payload: r.payload,
    },
  };
}

export const isOverride = (d: DecisionRow) => d.kind === "override" || (d.kind == null && d.overridden === true);

export function decisionItem(r: DecisionRow, rec: RecommendationRow | undefined, l: Lookups): AuditItem {
  const caseId = r.case_id ?? rec?.case_id ?? null;
  const c = caseLink(caseId, l);
  const kind = r.kind ?? (r.overridden ? "override" : "approve");
  const vendor = r.vendor_id ? l.vendors.get(r.vendor_id) ?? r.vendor_id : null;
  const topId = r.top_vendor_id ?? rec?.top_vendor_id ?? null;
  const top = topId ? l.vendors.get(topId) ?? topId : null;
  const what =
    kind === "send_back" ? "HOD sent the recommendation back"
    : kind === "override" ? `HOD override: chose ${vendor ?? "?"}${top ? ` instead of ${top}` : ""}`
    : `HOD approved ${vendor ?? top ?? "the recommendation"}`;
  const links = [...c.links, ...vendorLink(r.vendor_id, l)];
  if (topId && topId !== r.vendor_id) links.push(...vendorLink(topId, l));
  return {
    id: `decision:${r.id}`, at: r.created_at ?? EPOCH, type: "decision", who: resolveWho(r.decided_by, l.emails), what, why: r.reason,
    case_id: caseId, case_title: c.case_title, links, override: isOverride(r), proof: null,
    details: { kind, recommendation_id: r.recommendation_id, recommended_vendor: top, chosen_vendor: vendor },
  };
}

/** Filters by type and actor, sorts newest first and cuts to `limit`. The sort is stable on id for equal times. */
export function mergeTimeline(items: AuditItem[], opts: { type?: AuditFilter; actor?: string; limit?: number } = {}): AuditItem[] {
  const type = opts.type ?? "all";
  const actor = opts.actor?.trim().toLowerCase();
  return items
    .filter((i) => type === "all" || i.type === type)
    .filter((i) => !actor || i.who.toLowerCase().includes(actor))
    .sort((a, b) => {
      const d = Date.parse(b.at) - Date.parse(a.at);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    })
    .slice(0, opts.limit ?? 300);
}

/** Collects the ids that need a name, so each lookup table is read once. */
export function collectIds(rows: { events: EventRow[]; steps: StepRow[]; actions: ActionRow[]; decisions: DecisionRow[]; recs: RecommendationRow[] }) {
  const users = new Set<string>();
  const vendors = new Set<string>();
  const cases = new Set<string>();
  const user = (v: string | null | undefined) => { if (v && UUID.test(v)) users.add(v); };
  const kase = (v: string | null | undefined) => { if (v) cases.add(v); };
  for (const e of rows.events) { user(e.actor); kase(e.case_id); payloadVendorIds(e.payload).forEach((v) => vendors.add(v)); }
  for (const s of rows.steps) kase(s.case_id);
  for (const a of rows.actions) { user(a.proposed_by); user(a.approved_by); user(a.edited_by); kase(a.case_id); payloadVendorIds(a.payload).forEach((v) => vendors.add(v)); }
  for (const d of rows.decisions) { user(d.decided_by); kase(d.case_id); if (d.vendor_id) vendors.add(d.vendor_id); if (d.top_vendor_id) vendors.add(d.top_vendor_id); }
  for (const r of rows.recs) { kase(r.case_id); if (r.top_vendor_id) vendors.add(r.top_vendor_id); }
  return { users: [...users], vendors: [...vendors].filter((v) => UUID.test(v)), cases: [...cases] };
}

export type AuditQuery = { caseId?: string; type?: AuditFilter; actor?: string; limit?: number };

/** Loads and merges the audit records. Each table read is cut to `limit` rows before the merge. */
export async function loadAuditTimeline({ caseId, type = "all", actor, limit = 300 }: AuditQuery = {}): Promise<AuditItem[]> {
  // Typed as any: the generic supabase builder types go too deep (TS2589).
  const db: any = admin();
  const want = (t: AuditType) => type === "all" || type === t;
  const scoped = (q: any): any => (caseId ? q.eq("case_id", caseId) : q);
  const warn = (what: string, e: { message: string } | null) => { if (e) console.error(`audit: ${what}: ${e.message}`); };

  const [ev, st, ac, de] = await Promise.all([
    want("event") ? scoped(db.from("events").select("id,name,case_id,payload,actor,created_at")).order("created_at", { ascending: false }).limit(limit) : null,
    want("step") ? scoped(db.from("agent_steps").select("id,case_id,workflow,step,status,model,prompt_version,reasoning,cost_usd,started_at,finished_at")).order("started_at", { ascending: false }).limit(limit) : null,
    want("action") ? scoped(db.from("actions").select("id,case_id,kind,status,payload,proposed_by,approved_by,edited_by,approved_at,reject_reason,error,created_at")).order("created_at", { ascending: false }).limit(limit) : null,
    // decisions has case_id from stage 4. Select all columns so an older schema still works.
    want("decision") ? db.from("decisions").select("*").order("created_at", { ascending: false }).limit(caseId ? limit * 3 : limit) : null,
  ]);
  warn("events", ev?.error ?? null); warn("agent_steps", st?.error ?? null); warn("actions", ac?.error ?? null); warn("decisions", de?.error ?? null);
  const events = (ev?.data ?? []) as EventRow[];
  const steps = (st?.data ?? []) as StepRow[];
  const actions = (ac?.data ?? []) as ActionRow[];
  let decisions = (de?.data ?? []) as DecisionRow[];

  const actionIds = actions.map((a) => a.id);
  const recIds = [...new Set(decisions.map((d) => d.recommendation_id).filter((x): x is string => !!x))];
  const [rc, rr] = await Promise.all([
    actionIds.length ? db.from("receipts").select("action_id,payload_hash,approved_by,approved_at,executed_at,provider_id").in("action_id", actionIds) : null,
    recIds.length ? db.from("recommendations").select("*").in("id", recIds) : null,
  ]);
  warn("receipts", rc?.error ?? null); warn("recommendations", rr?.error ?? null);
  const receipts = new Map(((rc?.data ?? []) as ReceiptRow[]).map((r) => [r.action_id, r]));
  const recs = (rr?.data ?? []) as RecommendationRow[];
  const recById = new Map(recs.map((r) => [r.id, r]));
  if (caseId) decisions = decisions.filter((d) => (d.case_id ?? recById.get(d.recommendation_id ?? "")?.case_id) === caseId);

  const ids = collectIds({ events, steps, actions, decisions, recs });
  const [pr, vr, cr] = await Promise.all([
    ids.users.length ? db.from("profiles").select("id,email").in("id", ids.users) : null,
    ids.vendors.length ? db.from("vendors").select("id,name").in("id", ids.vendors) : null,
    ids.cases.length ? db.from("cases").select("id,title").in("id", ids.cases) : null,
  ]);
  const lookups: Lookups = {
    emails: new Map(((pr?.data ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email])),
    vendors: new Map(((vr?.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name])),
    cases: new Map(((cr?.data ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title])),
  };

  const items: AuditItem[] = [
    ...events.map((e) => eventItem(e, lookups)),
    ...steps.map((s) => stepItem(s, lookups)),
    ...actions.map((a) => actionItem(a, receipts.get(a.id), lookups)),
    ...decisions.map((d) => decisionItem(d, recById.get(d.recommendation_id ?? ""), lookups)),
  ];
  return mergeTimeline(items, { type, actor, limit });
}

/** The cases for the filter select, newest first. */
export async function loadAuditCases(): Promise<{ id: string; title: string }[]> {
  const db: any = admin();
  const { data, error } = await db.from("cases").select("id,title").order("created_at", { ascending: false }).limit(200);
  if (error) console.error(`audit: cases: ${error.message}`);
  return (data ?? []) as { id: string; title: string }[];
}

/** Reads the filter from URL search params. Unknown values fall back to the defaults. */
export function parseAuditQuery(sp: Record<string, string | string[] | undefined>): AuditQuery {
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
  const t = one("type");
  const type: AuditFilter = t === "event" || t === "step" || t === "action" || t === "decision" ? t : "all";
  const caseId = one("case");
  return { caseId: caseId && UUID.test(caseId) ? caseId : undefined, type, actor: one("actor") };
}

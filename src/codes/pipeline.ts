import { admin } from "../lib/supabase";
import { logStep, emit } from "../lib/steps";
import { normDesc } from "../erp/hygiene";
import { aliasFor, findCandidates } from "./candidates";
import { combine, judge, type Suggestion } from "./judge";
import { modelJudge, PROMPT_VERSION } from "./model-judge";

type Flag = { type: string; [k: string]: unknown };
const siteCodeOf = (flags: Flag[]) => (flags.find(f => f.type === "site_code")?.value as string | undefined) ?? null;
const withoutSuggestion = (flags: Flag[]) => flags.filter(f => f.type !== "code_suggestion");

/** W2: suggest an item code for each BOQ line that has none yet. Nothing is confirmed here: a person confirms. */
export async function mapBoqVersion(boqVersionId: string) {
  const db = admin();
  const { data: ver } = await db.from("boq_versions").select("id, case_id").eq("id", boqVersionId).single();
  if (!ver) throw new Error("BOQ version not found");
  const { data: lines } = await db.from("boq_lines").select("id, serial, description, unit, item_code, flags").eq("boq_version_id", boqVersionId).order("serial");
  const { data: all } = await db.from("item_codes").select("code");
  const allCodes = (all ?? []).map(r => r.code as string);
  const out: { serial: string | null; decision: string; top: string | null }[] = [];

  for (const line of lines ?? []) {
    if (line.item_code) continue; // already confirmed
    const flags = (line.flags ?? []) as Flag[];
    const siteCode = siteCodeOf(flags);
    let s: Suggestion;
    let usage: { model: string; input_tokens: number; output_tokens: number } | null = null;
    const alias = await aliasFor(line.description);
    if (alias) {
      s = { type: "code_suggestion", decision: "auto", confidence: 1, judged_by: "alias", reason: "A person confirmed this wording before.", warnings: [],
        picks: [{ ids: [alias.id], code: alias.code, description: alias.description, erp_serial: alias.erp_serial, serials: [alias.erp_serial], score: 1, agree: ["confirmed alias"], differ: [], conflicts: [], sameMeaningCodes: [] }] };
    } else {
      const found = await findCandidates(line.description, siteCode);
      s = judge({ description: line.description, siteCode }, found, allCodes);
      // The model judge runs when a key is set. CODE_JUDGE=rules turns it off. A failure keeps the rule answer.
      if (process.env.CODE_JUDGE !== "rules" && process.env.ANTHROPIC_API_KEY && s.picks.length) {
        try {
          const meanings = [...new Set(found.siteCodeRows.map(r => r.description.trim()))];
          const m = await modelJudge({ description: line.description, unit: line.unit ?? null, siteCode }, s.picks, meanings);
          s = combine(s, m);
          usage = { model: m.model, input_tokens: m.input_tokens, output_tokens: m.output_tokens };
        } catch (e: any) { s = combine(s, { error: String(e?.message ?? e).slice(0, 120) }); }
      }
    }
    await db.from("boq_lines").update({ flags: [...withoutSuggestion(flags), s] }).eq("id", line.id);
    await logStep({ caseId: ver.case_id, workflow: "W2", step: `map line ${line.serial}`, prompt_version: usage ? PROMPT_VERSION : undefined, input: { description: line.description, siteCode },
      output: { decision: s.decision, confidence: s.confidence, top: s.picks[0]?.code, judged_by: s.judged_by, model_choice: s.model?.code ?? null, usage },
      model: usage?.model, reasoning: s.reason, evidence: s.picks.slice(0, 3).map(p => ({ code: p.code, score: p.score })) });
    out.push({ serial: line.serial, decision: s.decision, top: s.picks[0]?.code ?? null });
  }
  return out;
}

/** A person confirms a mapping. The wording is saved as an alias so the next BOQ maps at once. */
export async function confirmCode(lineId: string, userId: string, choice: { itemCodeId: string } | { newCode: true }) {
  const db = admin();
  const { data: p } = await db.from("profiles").select("role").eq("id", userId).single();
  if (!p || !["contracts_engineer", "hod", "admin"].includes(p.role)) throw new Error("forbidden: role cannot confirm item codes");
  const { data: line } = await db.from("boq_lines").select("id, description, flags, boq_version_id, boq_versions!inner(case_id)").eq("id", lineId).single();
  if (!line) throw new Error("BOQ line not found");
  const caseId = (line as any).boq_versions.case_id as string;
  const flags = (line.flags ?? []) as Flag[];
  const sugg = flags.find(f => f.type === "code_suggestion") as unknown as Suggestion | undefined;
  const now = new Date().toISOString();

  if ("itemCodeId" in choice) {
    const { data: code } = await db.from("item_codes").select("id, code").eq("id", choice.itemCodeId).single();
    if (!code) throw new Error("item code not found");
    await db.from("boq_lines").update({ item_code: code.code, flags: [...withoutSuggestion(flags), { type: "code_confirmed", item_code_id: code.id, code: code.code, by: userId, at: now }] }).eq("id", lineId);
    const { data: has } = await db.from("code_aliases").select("id").eq("alias_text", normDesc(line.description)).eq("item_code_id", code.id).maybeSingle();
    if (!has) await db.from("code_aliases").insert({ alias_text: normDesc(line.description), item_code_id: code.id, confirmed_by: userId });
  } else {
    const np = sugg?.proposed_new;
    if (!np) throw new Error("This line has no new-code proposal.");
    await db.from("code_proposals").insert({ case_id: caseId, boq_line_id: lineId, proposed_code: np.code, description: np.description, nearest: np.nearest, status: "proposed" });
    await db.from("boq_lines").update({ item_code: np.code, flags: [...withoutSuggestion(flags), { type: "new_code_pending", code: np.code, by: userId, at: now }] }).eq("id", lineId);
  }
  await logStep({ caseId, workflow: "W2", step: "confirm code", input: { lineId, choice }, output: { by: userId }, status: "done" });

  // When every line has a code and no suggestion is left, tell the next workflow.
  const { data: rest } = await db.from("boq_lines").select("item_code, flags").eq("boq_version_id", line.boq_version_id);
  const open = (rest ?? []).filter(l => !l.item_code || ((l.flags ?? []) as Flag[]).some(f => f.type === "code_suggestion"));
  if (!open.length) await emit("codes.confirmed", { case_id: caseId }, { caseId, actor: userId });
  return { remaining: open.length };
}

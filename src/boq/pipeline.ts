import { admin } from "../lib/supabase";
import { logStep } from "../lib/steps";
import { proposeAction } from "../executor";
import { parseBoq } from "./parse";
import { checkBoq, clarificationDraft, type Finding } from "./check";

const BUCKET = process.env.STORAGE_BUCKET || "documents";

/** W1: read the BOQ sheet, check it, save it as a new version and draft a clarification to site. Nothing is sent here. */
export async function runBoqCheck(opts: { caseId: string; documentId: string; requirementText?: string }) {
  const db = admin();
  const { data: doc } = await db.from("documents").select("id, filename, storage_path").eq("id", opts.documentId).single();
  const { data: cs } = await db.from("cases").select("id, title, project_id").eq("id", opts.caseId).single();
  if (!doc || !cs) throw new Error("document or case not found");
  const file = await db.storage.from(BUCKET).download(doc.storage_path);
  if (file.error || !file.data) throw new Error(`could not read ${doc.storage_path}: ${file.error?.message}`);

  const parsed = await parseBoq(Buffer.from(await file.data.arrayBuffer()));
  const findings = checkBoq(parsed, opts.requirementText ?? "");

  const { data: last } = await db.from("boq_versions").select("version").eq("case_id", cs.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: ver, error } = await db.from("boq_versions").insert({ case_id: cs.id, version: (last?.version ?? 0) + 1, status: "draft", source_document_id: doc.id }).select("id, version").single();
  if (error) throw error;

  for (const l of parsed.lines) {
    const flags: unknown[] = [];
    if (l.siteCode) flags.push({ type: "site_code", value: l.siteCode });
    for (const f of findings.filter(x => x.line === l.serial)) flags.push(f.code === "not_measured" ? { type: "not_measured", note: f.message } : { type: "check", code: f.code, severity: f.severity, message: f.message });
    const { error: le } = await db.from("boq_lines").insert({ boq_version_id: ver.id, serial: l.serial, description: l.description, unit: l.unit, quantity: l.quantity, flags });
    if (le) throw le;
  }
  // Evidence: each finding with its source document, so the review screen can show where it came from.
  if (findings.length) await db.from("extracted_fields").insert(findings.map(f => ({
    entity_type: "boq_version", entity_id: ver.id, field: `check:${f.code}`, value: f, document_id: doc.id, snippet: f.message, confidence: 1 })));
  await db.from("cases").update({ stage: "boq_check" }).eq("id", cs.id);

  // Draft the clarification. The engineer edits it and approves it. The recipient is the site contact if we know one.
  let actionId: string | null = null;
  const draft = clarificationDraft(cs.title, findings);
  if (draft) {
    const { data: ppl } = await db.from("people").select("email").eq("project_id", cs.project_id ?? "").not("email", "is", null);
    const a = await proposeAction("send_clarification", cs.id, { to: (ppl ?? []).map(p => p.email as string), ...draft }, { proposedBy: "W1" });
    actionId = a.id;
  }
  await logStep({ caseId: cs.id, workflow: "W1", step: "BOQ check", input: { document: doc.filename, sheet: parsed.sheet },
    output: { version: ver.version, lines: parsed.lines.length, errors: findings.filter(f => f.severity === "error").length, warnings: findings.filter(f => f.severity === "warn").length, clarification_action: actionId },
    reasoning: findings.length ? `${findings.length} finding(s); the clarification to site is waiting for approval.` : "No findings." });
  return { versionId: ver.id as string, version: ver.version as number, lines: parsed.lines.length, findings: findings as Finding[], actionId };
}

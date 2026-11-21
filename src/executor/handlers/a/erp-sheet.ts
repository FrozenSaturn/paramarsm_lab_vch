import { registerHandler } from "../..";
import { admin } from "../../../lib/supabase";
import { buildItemImportSheet } from "../../../erp/import-sheet";

const BUCKET = process.env.STORAGE_BUCKET || "documents";

/** Builds the Farvision import sheet for approved new codes. It writes a file and nothing else. */
registerHandler("erp_import_sheet", async (action) => {
  // Which proposals go in the sheet comes from the proposed payload, never from an edit.
  const ids = ((action.original_payload ?? {}) as { proposal_ids?: string[] }).proposal_ids ?? [];
  if (!ids.length) throw new Error("No code proposals in this action.");
  const db = admin();
  const { data: props } = await db.from("code_proposals").select("id, proposed_code, description, status").in("id", ids);
  const rows = (props ?? []).filter(p => p.status === "proposed" || p.status === "sheet_generated");
  if (!rows.length) throw new Error("The proposals are not open any more.");
  const buf = await buildItemImportSheet(rows.map(p => ({ code: p.proposed_code!, description: p.description ?? "" })));
  const path = `erp/${new Date().toISOString().slice(0, 10)}/item_import_${action.id.slice(0, 8)}.xlsx`;
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
  if (up.error) throw new Error(`could not store the sheet: ${up.error.message}`);
  await db.from("code_proposals").update({ status: "sheet_generated" }).in("id", rows.map(r => r.id));
  return { provider_id: path, result: { path, rows: rows.length, note: "Import sheet generated. A person uploads it to Farvision. Nothing was written to Farvision." } };
});

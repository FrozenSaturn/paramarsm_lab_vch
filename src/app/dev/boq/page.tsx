import { notFound, redirect } from "next/navigation";
import { admin } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { runBoqCheck } from "@/boq/pipeline";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function upload(form: FormData) {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  await requireRole("contracts_engineer", "admin");
  const file = form.get("file") as File | null;
  if (!file || !file.size) throw new Error("Choose an .xlsx file.");
  const db = admin();
  const projectId = String(form.get("project") || "") || null;
  const title = String(form.get("title") || "").trim() || file.name.replace(/\.xlsx$/i, "");
  const { data: cs, error } = await db.from("cases").insert({ title, project_id: projectId, stage: "requirement", is_demo: true }).select("id").single();
  if (error) throw error;
  const path = `boq/${cs.id}/${file.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  const up = await db.storage.from(process.env.STORAGE_BUCKET || "documents").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
  if (up.error) throw up.error;
  const { data: doc } = await db.from("documents").insert({ case_id: cs.id, filename: file.name, mime: file.type, storage_path: path, kind: "boq" }).select("id").single();
  await runBoqCheck({ caseId: cs.id, documentId: doc!.id, requirementText: String(form.get("text") || "") });
  redirect(`/cases/${cs.id}/boq`);
}

export default async function DevBoq() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireRole("contracts_engineer", "admin");
  const { data: projects } = await admin().from("projects").select("id, name").order("name");
  return (
    <>
      <h1>Dev: upload a BOQ</h1>
      <p>Creates a new case from a BOQ sheet, without any channel. It reads the sheet, runs the checks and drafts the clarification.</p>
      <form action={upload} style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <input type="file" name="file" accept=".xlsx" required />
        <input name="title" placeholder="case title (default: file name)" />
        <select name="project"><option value="">(no project)</option>{(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <textarea name="text" rows={5} placeholder="Paste the site's email or message here. The check looks for dates and scope." />
        <button>Upload and check</button>
      </form>
    </>
  );
}

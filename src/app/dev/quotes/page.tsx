import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePageUser, requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { publish } from "@/workflows/b/publish";
import { runQuoteIntake } from "@/quotes/intake";
import { QuotesTable } from "@/components/case/b/QuotesTable";
import { ComparativePanel } from "@/components/case/b/ComparativePanel";
import { RecommendationPanel } from "@/components/case/b/RecommendationPanel";
import { s } from "@/components/case/b/ui";
export const dynamic = "force-dynamic";

/** Dev only: start W5 on a stored PDF without any channel. "Emit" goes through Inngest; "Read now" runs W5 in this request. */
async function startIntake(form: FormData) {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  await requireRole("contracts_engineer", "hod", "admin");
  const input = {
    case_id: String(form.get("case_id")), rfq_id: String(form.get("rfq_id")),
    vendor_id: String(form.get("vendor_id")), document_id: String(form.get("document_id")),
  };
  if (Object.values(input).some((v) => !v || v === "null")) throw new Error("pick a case, RFQ, vendor and document");
  if (form.get("mode") === "direct") await runQuoteIntake(input, { force: form.get("force") === "on" });
  else await publish("quote.received", input, { caseId: input.case_id, actor: "dev/quotes" });
  revalidatePath("/dev/quotes");
  redirect(`/dev/quotes?case=${input.case_id}`);
}

export default async function DevQuotes({ searchParams }: { searchParams: Promise<{ case?: string; cv?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  await requirePageUser();
  const { case: caseParam, cv } = await searchParams;
  const db = admin();
  const { data: cases } = await db.from("cases").select("id,title").order("created_at", { ascending: false }).limit(20);
  const caseId = caseParam ?? cases?.[0]?.id;
  const [{ data: rfqs }, { data: docs }, { data: vendors }] = caseId
    ? await Promise.all([
        db.from("rfqs").select("id,ref").eq("case_id", caseId),
        db.from("documents").select("id,filename,kind").eq("case_id", caseId).ilike("mime", "%pdf%").order("filename"),
        db.from("vendors").select("id,name").order("name"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <div style={{ maxWidth: 1400 }}>
      <h1>Dev: quotes</h1>
      <p style={s.muted}>
        Starts W5 on a PDF already in Storage, without any channel. Reader: {process.env.QUOTE_READER === "fixture" ? "hand-checked fixtures (no model call)" : `Claude (${process.env.QUOTE_MODEL || "claude-opus-5-5"})`}.
      </p>
      <p>
        Case:{" "}
        {(cases ?? []).map((c: any) => (
          <Link key={c.id} href={`/dev/quotes?case=${c.id}`} style={{ marginRight: 12, fontWeight: c.id === caseId ? 700 : 400 }}>{c.title}</Link>
        ))}
        {!cases?.length && <span style={s.muted}>No cases. Run scripts/seed/b/dev-fixtures.ts on a local database.</span>}
      </p>
      {caseId && (
        <form action={startIntake} style={{ ...s.card, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignItems: "end" }}>
          <input type="hidden" name="case_id" value={caseId} />
          <label>RFQ<br />
            <select name="rfq_id" required style={{ width: "100%" }}>{(rfqs ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.ref ?? r.id.slice(0, 8)}</option>)}</select>
          </label>
          <label>Vendor<br />
            <select name="vendor_id" required style={{ width: "100%" }}>{(vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          </label>
          <label>Quote PDF<br />
            <select name="document_id" required style={{ width: "100%" }}>{(docs ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.filename}{d.kind ? ` (${d.kind})` : ""}</option>)}</select>
          </label>
          <label><input type="checkbox" name="force" /> Read again even if already read</label>
          <button name="mode" value="emit" style={s.button}>Emit quote.received (Inngest)</button>
          <button name="mode" value="direct" style={s.primary}>Read now (no Inngest)</button>
        </form>
      )}
      {caseId && <QuotesTable caseId={caseId} />}
      {caseId && <div id="comparative"><ComparativePanel caseId={caseId} version={cv ? Number(cv) : undefined} versionHref={(v) => `/dev/quotes?case=${caseId}&cv=${v}`} /></div>}
      {caseId && <RecommendationPanel caseId={caseId} />}
    </div>
  );
}

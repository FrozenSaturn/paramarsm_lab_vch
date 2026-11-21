import Link from "next/link";
import { admin } from "@/lib/supabase";
import { documentPageUrl } from "@/quotes/source";
import { REVIEW_CODES, type Flag } from "@/quotes/normalise";
import { DEFAULT_TERMS, type TermKey } from "@/quotes/terms";
import { HEADER_FIELDS, type ExtractedQuote } from "@/quotes/schema";
import { fmtDate, fmtINR, fmtNum } from "@/quotes/format";
import { Badge, Flags, s, statusTone } from "./ui";

const TERM_TONE = { met: "ok", not_met: "block", not_stated: "plain" } as const;

/**
 * Quote review: the PDF page on the left, what was read on the right, and a confirm/correct
 * form for every value that waits for a person (handwriting, disagreeing reads, low confidence).
 */
export async function QuoteReview({ quoteId, page, pageHref, confirmAction }: {
  quoteId: string;
  page?: number;
  pageHref: (page: number) => string;
  confirmAction: (form: FormData) => Promise<void>;
}) {
  const db = admin();
  const { data: q } = await db.from("quotes").select("*").eq("id", quoteId).single();
  if (!q) return <p>Quote not found.</p>;
  const [{ data: lines }, { data: terms }, { data: vendor }] = await Promise.all([
    db.from("quote_lines").select("*").eq("quote_id", quoteId).order("position"),
    db.from("quote_terms").select("*").eq("quote_id", quoteId),
    db.from("vendors").select("name").eq("id", q.vendor_id).single(),
  ]);
  const x = q.extraction as ExtractedQuote | null;
  const confirmations = (q.confirmations ?? {}) as Record<string, { value: unknown; original: unknown }>;
  const second = (serial: string) => (q.second_read?.rates ?? []).find((r: any) => String(r.serial).trim() === serial.trim());
  const toReview = (lines ?? []).filter((l: any) => (l.flags as Flag[]).some((f) => REVIEW_CODES.has(f.code)));
  const firstPage = page ?? toReview[0]?.page ?? 1;
  const pdfUrl = q.document_id ? await documentPageUrl(q.document_id, firstPage) : null;
  const pageLink = (p: number | null | undefined) => (p ? <Link href={pageHref(p)} style={{ fontWeight: p === firstPage ? 700 : 400 }}>p.{p}</Link> : <span style={s.muted}>—</span>);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ margin: "4px 0" }}>{vendor?.name ?? "Vendor"} <span style={s.muted}>v{q.version}</span></h2>
        <Badge tone={statusTone(q.status)}>{String(q.status).replace("_", " ")}</Badge>
        <span>Dated {fmtDate(q.quote_date)}</span>
        <span>On Vinayak's quantities: <b>{fmtINR(q.total_on_boq)}</b> <span style={s.muted}>({q.comparable_lines} lines)</span></span>
        <span style={s.muted}>As priced by the vendor: {fmtINR(q.vendor_total)}</span>
        <span style={s.muted}>Read by {q.model} · {q.prompt_version}</span>
      </div>
      <ul style={{ margin: "6px 0 12px", paddingLeft: 18 }}>
        {(q.flags as Flag[]).filter((f) => f.severity !== "info").map((f, i) => <li key={i} style={{ fontSize: 13 }}><Badge tone={f.severity}>{f.code.replace(/_/g, " ")}</Badge>{f.message}</li>)}
      </ul>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 5fr) 7fr", gap: 16 }}>
        <div style={{ position: "sticky", top: 8, alignSelf: "start" }}>
          {pdfUrl
            ? <iframe key={firstPage} src={pdfUrl} title="Quote PDF" style={{ width: "100%", height: "85vh", border: "1px solid var(--hairline)", borderRadius: 12 }} />
            : <p style={s.muted}>PDF not available.</p>}
        </div>

        <div>
          {toReview.length > 0 && (
            <section style={{ ...s.card, borderColor: "color-mix(in srgb, var(--warn) 45%, var(--hairline))" }}>
              <h3 style={{ marginTop: 0 }}>Waiting for you ({toReview.length})</h3>
              <p style={s.muted}>Check each value against the page and confirm it, or type what the page actually says.</p>
              {toReview.map((l: any) => {
                const sr = second(l.serial);
                return (
                  <form key={l.id} action={confirmAction} style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr auto", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--hairline)" }}>
                    <input type="hidden" name="quote_id" value={quoteId} />
                    <input type="hidden" name="key" value={`line:${String(l.serial).trim()}:rate`} />
                    <div>
                      <b>Line {l.serial}</b> {pageLink(l.page)}<br />
                      <span style={s.muted}>{l.item} · {fmtNum(l.quantity)} {l.unit}</span>
                    </div>
                    <div style={{ fontSize: 13 }}>
                      Read: <b>{fmtNum(l.rate)}</b>{sr && <> · second read: <b>{sr.rate == null ? "unreadable" : fmtNum(sr.rate)}</b></>}
                      <div><Flags flags={(l.flags as Flag[]).filter((f) => REVIEW_CODES.has(f.code))} /></div>
                    </div>
                    <input name="value" type="number" step="any" defaultValue={l.rate ?? ""} required style={{ width: "100%" }} aria-label={`Rate for line ${l.serial}`} />
                    <button style={s.primary}>Confirm rate</button>
                  </form>
                );
              })}
            </section>
          )}

          <section style={s.card}>
            <h3 style={{ marginTop: 0 }}>Lines</h3>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>#</th><th style={s.th}>Item</th><th style={s.th}>BOQ</th>
                  <th style={{ ...s.th, ...s.num }}>Vendor qty</th><th style={{ ...s.th, ...s.num }}>Rate</th><th style={{ ...s.th, ...s.num }}>Printed amt</th>
                  <th style={{ ...s.th, ...s.num }}>Rate per BOQ unit</th><th style={{ ...s.th, ...s.num }}>On Vinayak qty</th><th style={s.th}>Flags</th><th style={s.th}>Page</th>
                </tr>
              </thead>
              <tbody>
                {(lines ?? []).map((l: any) => (
                  <tr key={l.id}>
                    <td style={s.td}>{l.serial}</td>
                    <td style={s.td}>{l.item}{l.make && <div style={s.muted}>Make: {l.make}</div>}</td>
                    <td style={s.td}>{l.boq_line_id ? <span>{fmtNum(l.boq_quantity)} <span style={s.muted}>{l.boq_unit}</span></span> : <span style={s.muted}>—</span>}</td>
                    <td style={{ ...s.td, ...s.num }}>{fmtNum(l.quantity)} <span style={s.muted}>{l.unit_raw}</span></td>
                    <td style={{ ...s.td, ...s.num }}>
                      {fmtNum(l.rate)}
                      {confirmations[`line:${String(l.serial).trim()}:rate`] && <div><Badge tone="ok">confirmed</Badge></div>}
                    </td>
                    <td style={{ ...s.td, ...s.num }}>{fmtINR(l.amount_stated)}</td>
                    <td style={{ ...s.td, ...s.num }}>{l.normalized_rate != null ? <>{fmtINR(l.normalized_rate)}<span style={s.muted}>/{l.normalized_unit}</span></> : "—"}</td>
                    <td style={{ ...s.td, ...s.num }}>{fmtINR(l.amount_on_boq)}</td>
                    <td style={s.td}><Flags flags={l.flags ?? []} /></td>
                    <td style={s.td}>{pageLink(l.page)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={s.card}>
            <h3 style={{ marginTop: 0 }}>Vinayak's six RFQ terms</h3>
            <table style={s.table}>
              <tbody>
                {(terms ?? []).sort((a: any, b: any) => Object.keys(DEFAULT_TERMS).indexOf(a.term) - Object.keys(DEFAULT_TERMS).indexOf(b.term)).map((t: any) => {
                  const ev = x?.terms.find((e) => e.term === t.term);
                  return (
                    <tr key={t.id}>
                      <td style={{ ...s.td, width: 140 }}>{DEFAULT_TERMS[t.term as TermKey]?.label ?? t.term}</td>
                      <td style={{ ...s.td, width: 90 }}><Badge tone={TERM_TONE[t.status as keyof typeof TERM_TONE]}>{t.status.replace("_", " ")}</Badge></td>
                      <td style={s.td}>{t.detail}</td>
                      <td style={s.td}>{pageLink(ev?.page)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {x && (
            <section style={s.card}>
              <h3 style={{ marginTop: 0 }}>What the quote says</h3>
              <table style={s.table}>
                <tbody>
                  {HEADER_FIELDS.filter((f) => x.header[f].value != null).map((f) => (
                    <tr key={f}>
                      <td style={{ ...s.td, width: 140 }}>{f.replace(/_/g, " ")}</td>
                      <td style={s.td}>{x.header[f].value}{x.header[f].confidence < 0.8 && <Badge tone="warn">confidence {x.header[f].confidence}</Badge>}</td>
                      <td style={s.td}>{pageLink(x.header[f].page)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {x.vendor_conditions.length > 0 && (
                <>
                  <h4>Vendor's own conditions</h4>
                  <ul style={{ fontSize: 13 }}>{x.vendor_conditions.map((c, i) => <li key={i}>{c.text} {pageLink(c.page)}</li>)}</ul>
                </>
              )}
              {x.reader_notes && <p style={s.muted}>Reader's notes: {x.reader_notes}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

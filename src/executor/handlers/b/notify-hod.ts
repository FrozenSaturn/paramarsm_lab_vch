/**
 * `notify_hod`: runs when the contracts engineer approves the recommendation packet.
 *
 * 1. Sets the recommendation to "with_hod" and records sent_at. The packet is now in the
 *    HOD's Approvals queue in the app.
 * 2. Publishes `recommendation.ready` (W7 waits for the decision).
 * 3. Proposes a `send_email` action to the HOD with a plain summary and the approval link.
 *    The contracts engineer approves that mail as a second click. B never sends mail itself.
 *
 * Record ids come from original_payload: an edit may change the summary text, not the record.
 */
import { proposeAction, registerHandler } from "@/executor";
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import { publish } from "@/workflows/b/publish";
import type { Handler } from "@/contracts/actions";

export const W7 = "W7 approval";

interface RankingEntry { vendor_id: string; name: string; rank: number | null; total: number }

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Plain-text mail to the HOD. No vendor-written text: names, scores and the computed summary only. */
export function hodMailBody(a: { caseTitle: string; summary: string; ranking: RankingEntry[]; link: string }): string {
  const lines = a.ranking.slice(0, 3).map((r) => `  ${r.rank ?? "-"}. ${r.name}: score ${r.total}`);
  return [
    `A vendor recommendation is ready for your decision.`,
    ``,
    `Case: ${a.caseTitle}`,
    ``,
    `Ranking:`,
    ...lines,
    ``,
    `Summary:`,
    a.summary,
    ``,
    `Open the packet to approve, send it back, or choose another vendor with a reason:`,
    a.link,
    ``,
    `Each reason in the packet links to its proof (PDF page, comparative or message).`,
  ].join("\n");
}

const notifyHod: Handler = async (action) => {
  const ids = (action.original_payload ?? action.payload) as { recommendation_id?: string };
  const recId = ids.recommendation_id;
  if (!recId) throw new Error("notify_hod needs recommendation_id in its payload.");
  const edited = action.payload as { summary?: string };
  const db = admin();

  const { data: rec, error } = await db.from("recommendations")
    .select("id,case_id,status,sent_at,notify_action_id,top_vendor_id,ranking,explanation").eq("id", recId).maybeSingle();
  if (error) throw error;
  if (!rec) throw new Error(`Recommendation ${recId} not found.`);
  if (action.case_id && rec.case_id !== action.case_id) throw new Error("The recommendation does not belong to the case of this action.");
  // Idempotent: a second run of the same action changes nothing.
  if (rec.status === "with_hod" && rec.notify_action_id === action.id && rec.sent_at) {
    return { result: { recommendation_id: recId, status: "with_hod", already_sent: true } };
  }
  if (rec.status !== "draft") throw new Error(`The recommendation is ${rec.status}. Only a draft can go to the HOD. Run the comparison again for a new packet.`);
  if (rec.notify_action_id && rec.notify_action_id !== action.id) throw new Error("Another notify_hod action owns this recommendation.");
  if (!rec.top_vendor_id) throw new Error("The ranking is withheld (fewer than three quotes), so the packet cannot go to the HOD.");

  const sentAt = new Date().toISOString();
  // Claim: only a draft moves to with_hod, so two runs cannot both send.
  const { data: claimed, error: uErr } = await db.from("recommendations")
    .update({ status: "with_hod", sent_at: sentAt, notify_action_id: action.id }).eq("id", recId).eq("status", "draft").select("id");
  if (uErr) throw uErr;
  if (!claimed?.length) throw new Error("The recommendation changed while it was being sent. Reload and try again.");

  const caseId = rec.case_id as string;
  await publish("recommendation.ready", { recommendation_id: recId, case_id: caseId }, { caseId, actor: W7 });

  const { data: hods } = await db.from("profiles").select("email").eq("role", "hod");
  const to = [...new Set((hods ?? []).map((h: any) => h.email as string).filter(Boolean))].sort();
  const { data: kase } = await db.from("cases").select("title").eq("id", caseId).maybeSingle();
  const caseTitle = (kase?.title as string | undefined) ?? caseId;
  const ranking = (Array.isArray(rec.ranking) ? rec.ranking : []) as RankingEntry[];
  const summary = (edited.summary ?? "").trim() || ((rec.explanation as any)?.summary ?? []).map((s: any) => s.text).join(" ");
  const link = `${appUrl()}/approvals?rec=${recId}`;

  let emailActionId: string | null = null;
  if (to.length) {
    const top = ranking.find((r) => r.vendor_id === rec.top_vendor_id);
    const mail = await proposeAction("send_email", caseId, {
      to,
      subject: `Recommendation for your decision: ${caseTitle}${top ? ` (top: ${top.name})` : ""}`,
      body: hodMailBody({ caseTitle, summary, ranking, link }),
    });
    emailActionId = mail.id;
  }

  await logStep({
    caseId, workflow: W7, step: "Packet in the HOD queue",
    input: { action_id: action.id, recommendation_id: recId, approved_by: action.approved_by },
    output: { status: "with_hod", sent_at: sentAt, hod_emails: to, email_action_id: emailActionId, link },
    evidence: { recommendation_id: recId },
    reasoning: to.length
      ? `The packet is in the HOD's Approvals queue. A mail to ${to.join(", ")} waits for the contracts engineer to approve it.`
      : "The packet is in the HOD's Approvals queue. No profile has the HOD role, so no mail was drafted.",
  });

  return { result: { recommendation_id: recId, status: "with_hod", sent_at: sentAt, email_action_id: emailActionId, hod_emails: to } };
};

registerHandler("notify_hod", notifyHod);

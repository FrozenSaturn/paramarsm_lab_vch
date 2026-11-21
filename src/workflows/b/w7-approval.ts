import { inngest } from "@/workflows/client";
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import type { EventMap } from "@/contracts/events";

export const W7 = "W7 approval";

/**
 * W7 Approval: starts when a packet is in the HOD's queue (`recommendation.ready`, from the
 * notify_hod handler). It waits up to 3 days for `decision.made` on the same case. On a
 * timeout it writes a reminder note to the timeline. It sends no mail: a reminder mail is
 * an action that a person approves.
 *
 * A send-back emits no `decision.made` (the frozen event needs a vendor_id). A send-back is
 * still recorded in `decisions` and `agent_steps`; the timeout step checks the status first,
 * so it writes no reminder for a packet that was sent back.
 */
export const w7Approval = inngest.createFunction(
  {
    id: "w7-approval",
    name: "W7 Approval",
    triggers: [{ event: "recommendation.ready" }],
    idempotency: "event.data.recommendation_id",
    retries: 2,
  },
  async ({ event, step }) => {
    const data = event.data as EventMap["recommendation.ready"];
    await step.run("log packet with HOD", () =>
      logStep({
        caseId: data.case_id, workflow: W7, step: "Packet with HOD",
        input: { event: event.name, data }, reasoning: "Waiting up to 3 days for the HOD to approve, send back or choose another vendor.", status: "waiting",
      }),
    );

    const decision = await step.waitForEvent("wait for decision", { event: "decision.made", match: "data.case_id", timeout: "3d" });
    if (decision) {
      const d = decision.data as EventMap["decision.made"];
      await step.run("log decision", () =>
        logStep({
          caseId: data.case_id, workflow: W7, step: d.overridden ? "HOD chose another vendor" : "HOD approved the top vendor",
          input: { recommendation_id: data.recommendation_id }, output: d, evidence: { decision_id: d.decision_id },
        }),
      );
      return { decided: true, decision_id: d.decision_id };
    }

    const status = await step.run("check status", async () => {
      const { data: rec } = await admin().from("recommendations").select("status").eq("id", data.recommendation_id).maybeSingle();
      return (rec?.status as string | undefined) ?? null;
    });
    if (status !== "with_hod") return { decided: false, status };
    await step.run("reminder note", () =>
      logStep({
        caseId: data.case_id, workflow: W7, step: "No decision after 3 days",
        input: { recommendation_id: data.recommendation_id },
        reasoning: "The packet has been with the HOD for 3 days. Remind the HOD. No mail was sent: draft a reminder if one is needed.",
        status: "alert",
      }),
    );
    return { decided: false, reminded: true };
  },
);

import { inngest } from "../client";
import { admin } from "../../lib/supabase";
import { emit } from "../../lib/steps";
import { planChase, proposeReminders } from "../../tender/chase";

/** W4: after the RFQs are sent, wait, propose one reminder for vendors who have not quoted, then wait for the due date and say so. */
export const w4Chase = inngest.createFunction(
  { id: "w4-dispatch-chase", name: "W4 Dispatch and chase", triggers: [{ event: "rfq.approved" }], concurrency: { key: "event.data.case_id", limit: 1 } },
  async ({ event, step }) => {
    const { rfq_id, case_id } = event.data;
    const rfq = await step.run("load", async () => (await admin().from("rfqs").select("due_date").eq("id", rfq_id).maybeSingle()).data);
    if (!rfq?.due_date) return { skipped: "the RFQ is gone or has no due date" };
    const { dueAt, reminderAt } = planChase(new Date(), rfq.due_date);
    let reminders = 0;
    if (reminderAt) {
      await step.sleepUntil("wait-for-reminder", reminderAt);
      reminders = (await step.run("reminders", () => proposeReminders(rfq_id))).length;
    }
    await step.sleepUntil("wait-for-due-date", dueAt);
    await step.run("due-date-passed", () => emit("rfq.due_date_passed", { case_id, rfq_id }, { caseId: case_id, actor: "W4" }));
    return { reminders };
  },
);

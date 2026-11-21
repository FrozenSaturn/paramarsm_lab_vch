import { inngest } from "../client";
import { admin } from "../../lib/supabase";
import { prepareTender } from "../../tender/prepare";

/** W3: starts when every BOQ line has a confirmed code. Drafts the RFQs. A person edits and approves them. */
export const w3Tender = inngest.createFunction(
  { id: "w3-tender-prep", name: "W3 Tender preparation", triggers: [{ event: "codes.confirmed" }], concurrency: { key: "event.data.case_id", limit: 1 } },
  async ({ event, step }) => step.run("prepare", async () => {
    // A case can be gone by the time the event runs. Skip it. A retry would never succeed.
    const { data } = await admin().from("cases").select("id").eq("id", event.data.case_id).maybeSingle();
    if (!data) return { skipped: "the case no longer exists" };
    return prepareTender({ caseId: event.data.case_id });
  }),
);

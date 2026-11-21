import { inngest } from "../client";
import { prepareTender } from "../../tender/prepare";

/** W3: starts when every BOQ line has a confirmed code. Drafts the RFQs. A person edits and approves them. */
export const w3Tender = inngest.createFunction(
  { id: "w3-tender-prep", name: "W3 Tender preparation", triggers: [{ event: "codes.confirmed" }], concurrency: { key: "event.data.case_id", limit: 1 } },
  async ({ event, step }) => step.run("prepare", () => prepareTender({ caseId: event.data.case_id })),
);

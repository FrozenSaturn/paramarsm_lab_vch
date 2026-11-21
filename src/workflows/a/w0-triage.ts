import { inngest } from "../client";
import { triageMessage } from "../../triage/triage";

/** W0: starts for each inbound message that no RFQ reply rule claimed. */
export const w0Triage = inngest.createFunction(
  { id: "w0-triage", name: "W0 Triage", triggers: [{ event: "message.received" }], concurrency: { limit: 3 } },
  async ({ event, step }) => step.run("triage", () => triageMessage(event.data.message_id)),
);

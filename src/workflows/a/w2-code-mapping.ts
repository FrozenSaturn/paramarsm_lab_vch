import { inngest } from "../client";
import { mapBoqVersion } from "../../codes/pipeline";

/** W2: starts when the engineer accepts the BOQ. Suggests a code for each line. People confirm in the Codes screen. */
export const w2CodeMapping = inngest.createFunction(
  { id: "w2-code-mapping", name: "W2 Item-code mapping", triggers: [{ event: "boq.accepted" }], concurrency: { key: "event.data.case_id", limit: 1 } },
  async ({ event, step }) => step.run("map-lines", () => mapBoqVersion(event.data.boq_version_id)),
);

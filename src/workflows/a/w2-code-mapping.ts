import { inngest } from "../client";
import { admin } from "../../lib/supabase";
import { mapBoqVersion } from "../../codes/pipeline";

/** W2: starts when the engineer accepts the BOQ. Suggests a code for each line. People confirm in the Codes screen. */
export const w2CodeMapping = inngest.createFunction(
  { id: "w2-code-mapping", name: "W2 Item-code mapping", triggers: [{ event: "boq.accepted" }], concurrency: { key: "event.data.case_id", limit: 1 } },
  async ({ event, step }) => step.run("map-lines", async () => {
    const { data } = await admin().from("boq_versions").select("id").eq("id", event.data.boq_version_id).maybeSingle();
    if (!data) return { skipped: "the BOQ version no longer exists" };
    return mapBoqVersion(event.data.boq_version_id);
  }),
);

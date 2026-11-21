import { inngest } from "../client";
import { admin } from "../../lib/supabase";
import { pollMailbox } from "../../channels/gmail/poller";

/** Every minute: read new mail in the mailbox of each contracts engineer.
 *  Only one machine may run this (RUN_INGEST=true). Two pollers would store every mail twice. */
export const gmailPoll = inngest.createFunction(
  { id: "gmail-poll", name: "Gmail poll", triggers: [{ cron: "* * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    if (process.env.RUN_INGEST !== "true") return { skipped: "RUN_INGEST is not true on this machine" };
    const { data: users } = await admin().from("profiles").select("id").eq("role", "contracts_engineer");
    const results = [];
    for (const u of users ?? []) results.push(await step.run(`poll-${u.id}`, () => pollMailbox(u.id)));
    return results;
  },
);

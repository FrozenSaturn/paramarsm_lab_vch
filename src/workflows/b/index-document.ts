/**
 * Index for search.
 * - On document.stored: read the file, chunk it, embed it, and replace its rows in doc_chunks.
 * - On message.stored: do the same for the message body (subject, body and body_en).
 *
 * Both run in our own database with the local embedding model. No text leaves the machine.
 * One run at a time for each source, so two events for the same file cannot race.
 */
import { inngest } from "@/workflows/client";
import type { EventMap } from "@/contracts/events";
import { indexDocument, indexMessage } from "@/search/index-document";

export const indexDocumentFn = inngest.createFunction(
  {
    id: "b-index-document",
    name: "Index document",
    triggers: [{ event: "document.stored" }],
    concurrency: { key: "event.data.document_id", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const input = event.data as EventMap["document.stored"];
    return step.run("chunk and embed", () => indexDocument(input.document_id));
  },
);

export const indexMessageFn = inngest.createFunction(
  {
    id: "b-index-message",
    name: "Index message",
    triggers: [{ event: "message.stored" }],
    concurrency: { key: "event.data.message_id", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const input = event.data as EventMap["message.stored"];
    return step.run("chunk and embed", () => indexMessage(input.message_id));
  },
);

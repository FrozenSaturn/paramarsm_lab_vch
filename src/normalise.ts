import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cfg } from "./config.js";
import { Quote } from "./schema.js";

const SYSTEM = `You read vendor quotations received for construction work in India (often over WhatsApp, in English/Hindi/Hinglish) and convert them to a structured record.
Rules:
- Never invent numbers. If a value is not stated, use null and add a note to needs_review.
- Rates are per unit in INR excluding GST. If the vendor quotes GST-inclusive, say so via gst_included and flag it.
- Convert spoken numbers ("pachaas rupaye", "two eighty five") to digits, but flag if unsure.
- Flag mismatches (qty x rate != amount, differing quantities from the tender, unclear units).
- One message may be a fragment (e.g. only a rate). Extract what is there; do not guess the rest.`;

export type Source =
  | { type: "text"; text: string }
  | { type: "image"; data: Buffer; mime: string }
  | { type: "pdf"; data: Buffer };

export async function normalise(sources: Source[], context: string): Promise<Quote> {
  const client = new Anthropic({ apiKey: cfg.anthropicKey() });
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: `Sender: ${context}` }];
  for (const s of sources) {
    if (s.type === "text") content.push({ type: "text", text: s.text });
    else if (s.type === "image") content.push({ type: "image", source: { type: "base64", media_type: s.mime as any, data: s.data.toString("base64") } });
    else content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: s.data.toString("base64") } });
  }
  const res = await client.messages.create({
    model: cfg.model, max_tokens: 4096, system: SYSTEM,
    tools: [{ name: "record_quote", description: "Record the extracted quotation", input_schema: z.toJSONSchema(Quote) as any }],
    tool_choice: { type: "tool", name: "record_quote" },
    messages: [{ role: "user", content }],
  });
  const tool = res.content.find(b => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("Model returned no structured quote");
  return Quote.parse(tool.input);
}

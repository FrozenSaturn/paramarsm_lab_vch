import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cfg } from "../config.js";
import { Quote } from "../schema.js";
import type { QuoteExtractor, Source } from "./types.js";

export const claude: QuoteExtractor = {
  name: "claude",
  async extract(system: string, sources: Source[], context: string) {
    const client = new Anthropic({ apiKey: cfg.anthropicKey() });
    const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: `Sender: ${context}` }];
    for (const s of sources) {
      if (s.type === "text") content.push({ type: "text", text: s.text });
      else if (s.type === "image") content.push({ type: "image", source: { type: "base64", media_type: s.mime as any, data: s.data.toString("base64") } });
      else content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: s.data.toString("base64") } });
    }
    const res = await client.messages.create({
      model: cfg.claudeModel, max_tokens: 4096, system,
      tools: [{ name: "record_quote", description: "Record the extracted quotation", input_schema: z.toJSONSchema(Quote) as any }],
      tool_choice: { type: "tool", name: "record_quote" },
      messages: [{ role: "user", content }],
    });
    const tool = res.content.find(b => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") throw new Error("Model returned no structured quote");
    return Quote.parse(tool.input);
  },
};

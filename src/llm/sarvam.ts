import { z } from "zod";
import { cfg } from "../config.js";
import { Quote } from "../schema.js";
import type { QuoteExtractor, Source } from "./types.js";

/** Sarvam chat is text-only here: images and scanned PDFs need an OCR step first (not wired yet). */
function toText(sources: Source[], context: string): string {
  const parts = [`Sender: ${context}`];
  for (const s of sources) {
    if (s.type === "text") parts.push(s.text);
    else throw new Error(`Sarvam provider cannot read ${s.type} input directly; set LLM_PROVIDER=claude for images/scanned PDFs, or add an OCR step`);
  }
  return parts.join("\n\n");
}

/** Reasoning models may prefix <think>...</think>; then take the outermost JSON object. */
function parseJson(raw: string): unknown {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("No JSON object in model output");
  return JSON.parse(s.slice(a, b + 1));
}

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${cfg.sarvamUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": cfg.sarvamKey() },
    body: JSON.stringify({ model: cfg.sarvamModel, messages, temperature: 0, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`Sarvam chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

export const sarvam: QuoteExtractor = {
  name: "sarvam",
  async extract(system, sources, context) {
    const schema = JSON.stringify(z.toJSONSchema(Quote));
    const sys = `${system}\n\nRespond with ONLY one JSON object (no prose) matching this JSON Schema:\n${schema}`;
    const messages = [{ role: "system", content: sys }, { role: "user", content: toText(sources, context) }];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await chat(messages);
      try { return Quote.parse(parseJson(out)); }
      catch (e) {
        lastErr = e;
        messages.push({ role: "assistant", content: out }, { role: "user", content: `That was invalid (${(e as Error).message.slice(0, 300)}). Reply again with ONLY the corrected JSON object.` });
      }
    }
    throw new Error(`Sarvam returned no valid quote: ${(lastErr as Error).message}`);
  },
};

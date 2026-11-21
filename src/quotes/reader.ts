/**
 * Reads a quote PDF with Claude. The model only reads: it has no tools and its output
 * is a fixed schema, so a hostile PDF can at worst produce a wrong field that a reviewer sees.
 *
 * Kept in this one file so it can move behind A's model interface (src/llm, readDocument)
 * once that exists, without touching the rest of W5.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ExtractedQuote, HandwrittenRates } from "./schema";
import { HANDWRITING_PROMPT_VERSION, HANDWRITING_SYSTEM, HANDWRITING_USER, READ_PROMPT_VERSION, READ_SYSTEM, readUserText } from "./prompts";
import type { BoqLineIn } from "./normalise";
import type { TermKey } from "./terms";

/** The most capable model for quote reading: few calls, and accuracy matters most here. */
export const QUOTE_MODEL = process.env.QUOTE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export interface ModelCall {
  model: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ms: number;
}

// Opus 5.5 list price per million tokens (input, output).
const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10] };

async function parsePdf<S extends z.ZodType>(schema: S, system: string, pdf: Buffer, text: string, promptVersion: string) {
  const started = Date.now();
  const stream = anthropic().beta.messages.stream({
    model: QUOTE_MODEL,
    max_tokens: 32000,
    // If a safety classifier declines, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(schema) },
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`model declined to read the document (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new Error("model ran out of output tokens while reading the document");
  if (!msg.parsed_output) throw new Error("model output did not match the quote schema");
  const [pin, pout] = PRICE[msg.model] ?? PRICE["claude-opus-5-5"];
  const call: ModelCall = {
    model: msg.model,
    prompt_version: promptVersion,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cost_usd: (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6,
    ms: Date.now() - started,
  };
  return { data: msg.parsed_output as z.infer<S>, call };
}

export interface ReadResult {
  extracted: ExtractedQuote;
  /** Present for scans and handwritten rates: an independent second read of the handwritten rates only. */
  secondRead: HandwrittenRates | null;
  calls: ModelCall[];
}

export async function readQuotePdf(
  pdf: Buffer,
  ctx: { boq: BoqLineIn[]; terms: Record<TermKey, { label: string; text: string }>; vendorHint?: string | null },
): Promise<ReadResult> {
  const first = await parsePdf(ExtractedQuote, READ_SYSTEM, pdf, readUserText(ctx), READ_PROMPT_VERSION);
  const calls = [first.call];
  let secondRead: HandwrittenRates | null = null;
  if (first.data.is_scanned || first.data.lines.some((l) => l.rate_handwritten)) {
    // Independent: the second read does not see the first read's numbers.
    const second = await parsePdf(HandwrittenRates, HANDWRITING_SYSTEM, pdf, HANDWRITING_USER, HANDWRITING_PROMPT_VERSION);
    secondRead = second.data;
    calls.push(second.call);
  }
  return { extracted: first.data, secondRead, calls };
}

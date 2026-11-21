/**
 * W6 explanation writer. Claude gets ONLY the computed facts (no quote text, no PDF), and
 * its JSON answer is checked in code. One retry with the errors; after that, or with no
 * ANTHROPIC_API_KEY, the plain-code template is used.
 *
 * Kept in this one file so it can move behind A's model interface (src/llm) later.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { RecommendationFact } from "@/compare/recommend-facts";
import { templateExplanation, validateExplanation, type Explanation } from "./explain-check";
import { EXPLAIN_PROMPT_VERSION, EXPLAIN_SYSTEM, explainRetryText, explainUserText } from "./prompts";

/** The strong model, as for quote reading. */
export const EXPLAIN_MODEL = process.env.QUOTE_MODEL || "claude-opus-5-5";

// List price per million tokens (input, output).
const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10] };

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const Sentence = z.object({ text: z.string(), fact_ids: z.array(z.string()) });
const ExplanationSchema = z.object({
  summary: z.array(Sentence),
  vendors: z.array(z.object({ vendor_id: z.string(), reasons: z.array(Sentence) })),
});

export interface ExplainCall {
  model: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ms: number;
}

export interface ExplainResult {
  explanation: Explanation;
  /** "model" when Claude's answer passed the checks; "template" otherwise. */
  source: "model" | "template";
  /** Model name, or null for the template. */
  model: string | null;
  prompt_version: string;
  calls: ExplainCall[];
  cost_usd: number;
  /** Validation errors of each failed attempt, and the reason for a fallback. */
  errors: string[];
}

export interface ExplainContext {
  /** Top vendors, best first. */
  vendors: { vendor_id: string; name: string }[];
}

async function callModel(userText: string): Promise<{ data: unknown; call: ExplainCall }> {
  const started = Date.now();
  const stream = anthropic().beta.messages.stream({
    model: EXPLAIN_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(ExplanationSchema) },
    system: EXPLAIN_SYSTEM,
    messages: [{ role: "user", content: userText }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`model declined (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new Error("model ran out of output tokens");
  if (!msg.parsed_output) throw new Error("model output did not match the explanation schema");
  const [pin, pout] = PRICE[msg.model] ?? PRICE["claude-opus-5-5"];
  return {
    data: msg.parsed_output,
    call: {
      model: msg.model, prompt_version: EXPLAIN_PROMPT_VERSION,
      input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens,
      cost_usd: (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6, ms: Date.now() - started,
    },
  };
}

/** Keeps only the fields of the shape, in the vendor order given. */
function tidy(e: Explanation, order: string[]): Explanation {
  const s = (x: { text: string; fact_ids: string[] }) => ({ text: x.text.trim(), fact_ids: [...new Set(x.fact_ids)] });
  return {
    summary: e.summary.map(s),
    vendors: [...e.vendors].sort((a, b) => order.indexOf(a.vendor_id) - order.indexOf(b.vendor_id)).map((v) => ({ vendor_id: v.vendor_id, reasons: v.reasons.map(s) })),
  };
}

/** Writes the explanation from the facts. Never throws for a model problem: it falls back to the template. */
export async function writeExplanation(facts: RecommendationFact[], ctx: ExplainContext): Promise<ExplainResult> {
  const ids = ctx.vendors.map((v) => v.vendor_id);
  const calls: ExplainCall[] = [];
  const errors: string[] = [];
  const done = (explanation: Explanation, source: "model" | "template", model: string | null): ExplainResult => ({
    explanation, source, model, prompt_version: EXPLAIN_PROMPT_VERSION, calls, errors,
    cost_usd: Math.round(calls.reduce((a, c) => a + c.cost_usd, 0) * 1e6) / 1e6,
  });
  const fallback = (why: string) => { errors.push(why); return done(templateExplanation(facts, ids), "template", null); };

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return fallback("No ANTHROPIC_API_KEY: used the plain-code template.");

  let previous: unknown = null;
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = previous == null ? explainUserText(facts, ctx.vendors) : explainRetryText(facts, ctx.vendors, previous, lastErrors);
      const { data, call } = await callModel(text);
      calls.push(call);
      const errs = validateExplanation(data, facts, ids);
      if (!errs.length) return done(tidy(data as Explanation, ids), "model", call.model);
      previous = data;
      lastErrors = errs;
      errors.push(...errs.map((e) => `Attempt ${attempt}: ${e}`));
    } catch (e) {
      errors.push(`Attempt ${attempt}: ${(e as Error).message}`);
      if (attempt === 2) return fallback("The model call failed: used the plain-code template.");
    }
  }
  return fallback("The model answer failed the checks twice: used the plain-code template.");
}

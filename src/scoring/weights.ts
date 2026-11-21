/**
 * Scoring weights (PLAN.md section 7.4). Plain code with no server imports, so the
 * "what if" control in the browser can use it.
 *
 * Rule: a set of weights has all six parameters, each a non-negative number, and the
 * sum is 100. The HOD edits them per category in `scoring_weights`.
 */
import { DEFAULT_WEIGHTS, PARAMS, type Param, type Weights } from "./types";
import { round } from "@/quotes/units";

/** Allowed gap from 100 for the sum, so 33.33 + 33.33 + 33.34 passes. */
const SUM_TOLERANCE = 1e-6;

/**
 * Checks a weights object and returns a clean copy with the keys in PARAMS order.
 * Throws an Error that names the problem when a key is missing or unknown, a value is
 * negative or not a number, or the sum is not 100.
 */
export function validateWeights(w: unknown): Weights {
  if (!w || typeof w !== "object" || Array.isArray(w)) throw new Error("Weights must be an object with the six parameters.");
  const obj = w as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => !(PARAMS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`Unknown weight parameter: ${unknown.join(", ")}. Use only ${PARAMS.join(", ")}.`);
  const out = {} as Weights;
  for (const p of PARAMS) {
    const v = obj[p];
    if (v === undefined || v === null) throw new Error(`Weight for "${p}" is missing.`);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Weight for "${p}" must be a number.`);
    if (v < 0) throw new Error(`Weight for "${p}" must not be negative.`);
    out[p] = v;
  }
  const sum = sumWeights(out);
  if (Math.abs(sum - 100) > SUM_TOLERANCE) throw new Error(`Weights must add up to 100. They add up to ${round(sum, 4)}.`);
  return out;
}

/** Sum of the six weights. */
export const sumWeights = (w: Weights) => PARAMS.reduce((s, p) => s + w[p], 0);

/**
 * Scales any non-negative weights so they add up to 100, each rounded to 2 places.
 * The rounding remainder goes to the largest weight, so the sum is exactly 100.
 * A missing or bad value counts as 0. All zero gives DEFAULT_WEIGHTS.
 */
export function normaliseWeights(w: Partial<Record<Param, number>>): Weights {
  const clean = {} as Weights;
  for (const p of PARAMS) {
    const v = w[p];
    clean[p] = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  }
  const sum = sumWeights(clean);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as Weights;
  for (const p of PARAMS) out[p] = round((clean[p] * 100) / sum);
  const rest = round(100 - sumWeights(out));
  if (rest !== 0) {
    const top = PARAMS.reduce((a, b) => (out[b] > out[a] ? b : a), PARAMS[0]);
    out[top] = round(out[top] + rest);
  }
  return out;
}

/**
 * Changes one weight and scales the other five so the sum stays 100. For the "what if"
 * slider. The value is clamped to 0–100.
 */
export function setWeight(w: Weights, param: Param, value: number): Weights {
  const v = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const others = PARAMS.filter((p) => p !== param);
  const otherSum = others.reduce((s, p) => s + w[p], 0);
  const out = {} as Weights;
  out[param] = round(v);
  const left = 100 - out[param];
  for (const p of others) out[p] = round(otherSum > 0 ? (w[p] * left) / otherSum : left / others.length);
  const rest = round(100 - sumWeights(out));
  if (rest !== 0) {
    const top = others.reduce((a, b) => (out[b] > out[a] ? b : a), others[0]);
    out[top] = round(out[top] + rest);
  }
  return out;
}

/** True when two weight sets are the same to 2 places. */
export const sameWeights = (a: Weights, b: Weights) => PARAMS.every((p) => round(a[p]) === round(b[p]));

/**
 * Weights for a category from `scoring_weights` rows: the exact category, else "default",
 * else DEFAULT_WEIGHTS. Throws when the row it picks holds bad weights, so a broken
 * setting is seen and not hidden.
 */
export function weightsForCategory(rows: { category: string; weights: unknown }[], category?: string | null): Weights {
  const want = category?.trim().toLowerCase() || null;
  const row = (want ? rows.find((r) => r.category.trim().toLowerCase() === want) : undefined)
    ?? rows.find((r) => r.category.trim().toLowerCase() === "default");
  if (!row) return { ...DEFAULT_WEIGHTS };
  try {
    return validateWeights(row.weights);
  } catch (e) {
    throw new Error(`scoring_weights for "${row.category}": ${(e as Error).message}`);
  }
}

/**
 * The payload of a `performance_record` action, and its check. Pure code, no database.
 *
 * Ratings are integers 1..5, where 5 is best:
 *   quality     5 = no defects          1 = serious rework
 *   timeliness  5 = on time or early    1 = very late
 *   disputes    5 = no disputes         1 = serious dispute (billing, scope, claims)
 *   safety      5 = no incidents        1 = serious incident
 *
 * Record ids (vendor, message, memory) come from the payload the agent proposed. An approver's
 * edit may change the ratings and the note. It may not point the record at another vendor.
 */
import { isUuid } from "@/memory/entities";

export const RATING_KEYS = ["quality", "timeliness", "disputes", "safety"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

export interface PerformancePayload {
  vendor_id: string;
  vendor_name?: string;
  quality?: number | null;
  timeliness?: number | null;
  disputes?: number | null;
  safety?: number | null;
  note: string;
  evidence?: string;
  source_memory_id?: string | null;
  message_id?: string | null;
}

export interface PerformanceRow {
  vendor_id: string;
  quality: number | null;
  timeliness: number | null;
  disputes: number | null;
  safety: number | null;
  note: string | null;
  source_message_id: string | null;
  source_memory_id: string | null;
}

/** An integer 1..5, null for "not rated". Anything else is an error. */
export function parseRating(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5 ? n : "invalid";
}

/** Checks the approved payload. Returns the vendor_performance row or the list of errors. */
export function validatePerformance(
  original: Record<string, unknown> | null,
  approved: Record<string, unknown>,
): { ok: true; row: PerformanceRow } | { ok: false; errors: string[] } {
  const ids = (original ?? approved) as Partial<PerformancePayload>;
  const errors: string[] = [];
  if (!isUuid(ids.vendor_id)) errors.push("vendor_id must be a uuid");
  if (approved.vendor_id !== undefined && approved.vendor_id !== ids.vendor_id) errors.push("vendor_id cannot be changed by an edit");
  const ratings = {} as Record<RatingKey, number | null>;
  for (const k of RATING_KEYS) {
    const r = parseRating(approved[k]);
    if (r === "invalid") errors.push(`${k} must be an integer from 1 to 5, or empty`);
    ratings[k] = r === "invalid" ? null : r;
  }
  if (!errors.length && RATING_KEYS.every((k) => ratings[k] == null)) errors.push("give at least one rating");
  if (errors.length) return { ok: false, errors };
  const note = typeof approved.note === "string" && approved.note.trim() ? approved.note.trim().slice(0, 2000) : null;
  return {
    ok: true,
    row: {
      vendor_id: ids.vendor_id as string,
      ...ratings,
      note,
      source_message_id: isUuid(ids.message_id) ? ids.message_id : null,
      source_memory_id: typeof ids.source_memory_id === "string" && ids.source_memory_id ? ids.source_memory_id : null,
    },
  };
}

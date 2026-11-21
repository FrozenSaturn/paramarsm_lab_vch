/**
 * Reads saved comparatives back (server only). The panel and the Excel route show exactly
 * what was stored: they never rebuild the numbers.
 */
import { admin } from "@/lib/supabase";
import { DEFAULT_WEIGHTS, type VendorScore, type Weights } from "@/scoring/types";
import type { Matrix } from "./types";

export interface StoredComparative {
  id: string;
  case_id: string;
  version: number;
  created_at: string;
  rfq_id: string | null;
  trigger: string | null;
  created_by: string | null;
  category: string | null;
  inputs_hash: string | null;
  weights: Weights;
  matrix: Matrix;
  /** In the matrix's vendor order. */
  scores: VendorScore[];
}

export interface ComparativeVersion {
  id: string;
  version: number;
  created_at: string;
  trigger: string | null;
}

/** Every version on the case, newest first. */
export async function listComparatives(caseId: string): Promise<ComparativeVersion[]> {
  const { data, error } = await admin().from("comparatives").select("id,version,created_at,trigger").eq("case_id", caseId).order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ComparativeVersion[];
}

/** One saved comparative with its scores, or null. */
export async function loadComparative(id: string): Promise<StoredComparative | null> {
  const db = admin();
  const { data: c, error } = await db.from("comparatives")
    .select("id,case_id,version,created_at,rfq_id,trigger,created_by,category,inputs_hash,weights,matrix").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const { data: rows, error: sErr } = await db.from("scores").select("vendor_id,total,breakdown,flags,rank").eq("comparative_id", id);
  if (sErr) throw sErr;
  const matrix = c.matrix as Matrix;
  const order = new Map(matrix.vendors.map((v, i) => [v.vendor_id, i]));
  const scores: VendorScore[] = ((rows ?? []) as any[])
    .map((r) => ({ vendor_id: r.vendor_id, total: Number(r.total ?? 0), rank: r.rank ?? null, params: r.breakdown ?? [], risk_flags: r.flags ?? [] }))
    .sort((a, b) => (order.get(a.vendor_id) ?? 99) - (order.get(b.vendor_id) ?? 99));
  return { ...(c as any), weights: (c.weights as Weights | null) ?? { ...DEFAULT_WEIGHTS }, matrix, scores };
}

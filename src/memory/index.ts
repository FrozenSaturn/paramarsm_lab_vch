/**
 * The memory layer. Only two places call it: getContext (search) and the remember-message
 * workflow (add). The panel lists and deletes through listMemories and deleteMemory.
 *
 *   memoryStore()     Mem0Store when MEM0_API_KEY is set, else LocalStore
 *   resilientSearch() mem0 first; LocalStore when mem0 throws or is slow
 *
 * Memories supply colour, not evidence. A score never changes because of a memory alone.
 */
import type { ContextItem, MemoryStore } from "@/contracts/context";
import { admin } from "@/lib/supabase";
import { cleanEntities, withTimeout } from "./entities";
import { LocalStore } from "./local";
import { Mem0Store, markDeleted, resolveMem0Id } from "./mem0";

export { Mem0Store } from "./mem0";
export { LocalStore } from "./local";
export type { AddOptions, AddResult, MemoryRef } from "./mem0";
export * from "./entities";

let store: (Mem0Store | LocalStore) | null = null;
let local: LocalStore | null = null;

export const mem0Enabled = () => !!process.env.MEM0_API_KEY;

export function memoryStore(): Mem0Store | LocalStore {
  return (store ??= mem0Enabled() ? new Mem0Store() : localStore());
}

export function localStore(): LocalStore {
  return (local ??= new LocalStore());
}

export interface SearchOutcome {
  items: ContextItem[];
  used: "mem0" | "local" | "none";
  error?: string;
}

/**
 * Searches the primary store. On an error or a timeout it searches the fallback.
 * It throws only when the fallback fails too.
 */
export async function searchWithFallback(
  primary: MemoryStore,
  fallback: MemoryStore | null,
  query: string,
  entities: string[],
  timeoutMs = 6000,
): Promise<SearchOutcome> {
  const ents = cleanEntities(entities);
  if (!ents.length) return { items: [], used: "none" };
  const primaryName = primary instanceof LocalStore ? "local" : "mem0";
  try {
    return { items: await withTimeout(primary.search(query, ents), timeoutMs, "memory search"), used: primaryName };
  } catch (e) {
    const error = (e as Error).message;
    if (!fallback || fallback === primary) throw e;
    console.warn(`[memory] ${primaryName} search failed, using local memory_refs: ${error}`);
    return { items: await withTimeout(fallback.search(query, ents), timeoutMs, "local memory search"), used: "local", error };
  }
}

/** Memory search for getContext and the search box. mem0 first, memory_refs when mem0 fails. */
export async function resilientSearch(query: string, entities: string[], limit = 8): Promise<ContextItem[]> {
  const out = await searchWithFallback(memoryStore(), localStore(), query, entities);
  return out.items.slice(0, limit);
}

export interface MemoryRow {
  id: string;
  mem0_id: string;
  entity: string;
  text: string | null;
  message_id: string | null;
  vendor_id: string | null;
  case_id: string | null;
  is_demo: boolean;
  pending: boolean;
  created_at: string | null;
}

/** The "What we remember" panel: the live memories of one entity, newest first. */
export async function listMemories(entity: string, limit = 50): Promise<MemoryRow[]> {
  const [e] = cleanEntities([entity]);
  if (!e) return [];
  const s = memoryStore();
  if (s instanceof Mem0Store) await withTimeout(s.reconcile([e]), 6000, "memory reconcile").catch(() => 0);
  const { data, error } = await admin().from("memory_refs")
    .select("id,mem0_id,entity,text,message_id,vendor_id,case_id,is_demo,created_at")
    .eq("entity", e).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`memory_refs read failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({ ...r, pending: String(r.mem0_id).startsWith("pending:") }));
}

/**
 * Deletes one memory from the panel. The caller's server action checks the role first.
 * The memory is hidden in memory_refs (deleted_by = userId) and then deleted in mem0.
 * A mem0 failure does not undo the local delete: the memory stays hidden everywhere.
 */
export async function deleteMemory(memoryRefId: string, userId: string): Promise<{ hidden: number; mem0Deleted: boolean; error?: string }> {
  const mem0Id = await resolveMem0Id(memoryRefId);
  const hidden = await markDeleted(mem0Id, userId);
  const s = memoryStore();
  if (!(s instanceof Mem0Store) || mem0Id.startsWith("pending:") || mem0Id.startsWith("local:")) return { hidden, mem0Deleted: false };
  try {
    await s.remove(mem0Id, { deletedBy: userId });
    return { hidden, mem0Deleted: true };
  } catch (e) {
    return { hidden, mem0Deleted: false, error: (e as Error).message };
  }
}

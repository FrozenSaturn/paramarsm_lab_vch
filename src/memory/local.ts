/**
 * MemoryStore over memory_refs only. No network.
 *
 * - It is the fallback for search when mem0 is down or slow.
 * - It is the store when MEM0_API_KEY is not set. Then add() keeps the text in our own
 *   database and nothing leaves it.
 *
 * Search is a keyword match (ILIKE on each query word), ranked in code by word and trigram overlap.
 */
import { randomUUID } from "node:crypto";
import { admin } from "@/lib/supabase";
import type { ContextItem, MemoryStore } from "@/contracts/context";
import { cleanEntities, entityColumns, isUuid, queryWords, rankByOverlap, textKey } from "./entities";
import { markDeleted, resolveMem0Id, type AddOptions, type AddResult, type MemoryRef } from "./mem0";

const MAX_TEXT = 4000;

export class LocalStore implements MemoryStore {
  async add(text: string, entities: string[], meta: { message_id: string }): Promise<void> {
    await this.remember(text, entities, meta);
  }

  /** Keeps the text in memory_refs, one row per entity. Returns the rows written. */
  async remember(text: string, entities: string[], meta: { message_id: string }, opts: AddOptions = {}): Promise<AddResult> {
    const ents = cleanEntities(entities);
    const id = randomUUID();
    if (!ents.length || !text.trim()) return { add_id: id, memories: 0, pending: [], refs: [] };
    const rows = ents.map((e) => ({
      mem0_id: `local:${id}`, entity: e, text: text.trim().slice(0, MAX_TEXT),
      message_id: isUuid(meta.message_id) ? meta.message_id : null, is_demo: !!opts.isDemo, ...entityColumns(e),
    }));
    const { data, error } = await admin().from("memory_refs").upsert(rows, { onConflict: "mem0_id,entity" }).select("id,mem0_id,entity,text");
    if (error) throw new Error(`memory_refs write failed: ${error.message}`);
    return { add_id: id, memories: rows.length, pending: [], refs: (data ?? []) as MemoryRef[] };
  }

  async search(query: string, entities: string[], limit = 10): Promise<ContextItem[]> {
    const ents = cleanEntities(entities);
    if (!ents.length) return [];
    let q = admin().from("memory_refs").select("id,mem0_id,entity,text,created_at")
      .in("entity", ents).is("deleted_at", null).not("mem0_id", "like", "pending:%")
      .order("created_at", { ascending: false }).limit(200);
    const words = queryWords(query);
    // queryWords keeps letters and digits only, so the words are safe inside the or() filter.
    if (words.length) q = q.or(words.map((w) => `text.ilike.%${w}%`).join(","));
    const { data, error } = await q;
    if (error) throw new Error(`memory_refs search failed: ${error.message}`);
    const seen = new Set<string>();
    // One memory has a row per entity, and mem0 stores the same text once per entity: keep one.
    const unique = (data ?? []).filter((r: any) => {
      const k = textKey(r.text ?? "");
      if (!r.text || seen.has(r.mem0_id) || seen.has(k)) return false;
      seen.add(r.mem0_id).add(k);
      return true;
    });
    return rankByOverlap(query, unique as { id: string; text: string }[], limit)
      .map((r) => ({ text: r.text, source_id: r.id, source_type: "memory" }));
  }

  async remove(memoryId: string, opts: { deletedBy?: string | null } = {}): Promise<void> {
    await markDeleted(await resolveMem0Id(memoryId), opts.deletedBy ?? null);
  }
}

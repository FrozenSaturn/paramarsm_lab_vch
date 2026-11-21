/**
 * MemoryStore over the hosted mem0 platform (mem0ai MemoryClient, API v3).
 *
 * What the API does (checked with a made-up round trip, mem0ai 3.3.1):
 *   - add() is asynchronous. It returns { eventId, status: "PENDING" }, not memories.
 *     mem0 extracts the memories some seconds later (about 4 to 6 s in our test).
 *   - search() and getAll() take a filters object: { user_id } or { OR: [{ user_id }, ...] }.
 *     Each hit has id, memory (the text), userId, score and the metadata we sent.
 *   - delete(id) removes one memory.
 *
 * We keep each entity scope as its own mem0 user_id ("vendor:<uuid>"). For each memory
 * and each entity we write one memory_refs row: the panel shows it and can delete it,
 * and LocalStore searches it when mem0 is down.
 *
 * After add() we poll getAll() briefly for memories that carry our add_id. If none come
 * back in time we write a "pending:<add_id>" row, and search() or reconcile() completes it later.
 *
 * Every call has a timeout. Only callers that pass the sender allow-list send text here.
 */
import { randomUUID } from "node:crypto";
import type { Memory } from "mem0ai";
import { admin } from "@/lib/supabase";
import type { ContextItem, MemoryStore } from "@/contracts/context";
import { cleanEntities, entityColumns, isUuid, textKey, withTimeout } from "./entities";

/** The part of MemoryClient that we use. Tests pass a fake. */
export interface Mem0Like {
  add(messages: { role: "user" | "assistant"; content: string }[], options?: Record<string, any>): Promise<unknown>;
  search(query: string, options?: Record<string, any>): Promise<{ results: Memory[] }>;
  getAll(options?: Record<string, any>): Promise<{ results: Memory[] }>;
  delete(memoryId: string): Promise<unknown>;
}

export interface Mem0StoreOptions {
  apiKey?: string;
  client?: Mem0Like;
  /** Timeout of each mem0 call. */
  timeoutMs?: number;
  /** How long add() waits for mem0 to finish extracting, in total. 0 = do not wait. */
  pollTotalMs?: number;
  pollEveryMs?: number;
}

export interface AddOptions {
  /** Seeded, made-up anecdotes. The panel shows a demo badge. */
  isDemo?: boolean;
  /**
   * false = store the text as it is, with no extraction by mem0. The seed uses it for
   * anecdotes that are already short facts, so mem0 does not merge two of them into one.
   */
  infer?: boolean;
}

export interface AddResult {
  add_id: string;
  memories: number;
  /** Entities for which mem0 had not finished when we stopped waiting. */
  pending: string[];
  /** The memory_refs rows written (a pending row has mem0_id "pending:<add_id>"). */
  refs: MemoryRef[];
}

export interface MemoryRef {
  id: string;
  mem0_id: string;
  entity: string;
  text: string | null;
}

const PENDING = "pending:";
const MAX_TEXT = 4000;
/** A pending row older than this, with no memory in mem0, means mem0 kept nothing. */
const PENDING_GIVE_UP_MS = 30 * 60 * 1000;

const memoryText = (m: Memory) => (m.memory ?? m.data?.memory ?? "").trim();
const metaOf = (m: Memory) => (m.metadata && typeof m.metadata === "object" ? (m.metadata as Record<string, unknown>) : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One client per API key, shared by every store in the process. */
const clients = new Map<string, Promise<Mem0Like>>();
async function defaultClient(apiKey: string): Promise<Mem0Like> {
  // The client sends usage telemetry to a third party unless this is "false". Set it before the import.
  process.env.MEM0_TELEMETRY ??= "false";
  const { MemoryClient } = await import("mem0ai");
  return new MemoryClient({ apiKey }) as unknown as Mem0Like;
}

export class Mem0Store implements MemoryStore {
  private readonly timeoutMs: number;
  private readonly pollTotalMs: number;
  private readonly pollEveryMs: number;
  private readonly client: () => Promise<Mem0Like>;

  constructor(opts: Mem0StoreOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.pollTotalMs = opts.pollTotalMs ?? 15000;
    this.pollEveryMs = opts.pollEveryMs ?? 2000;
    if (opts.client) {
      const c = opts.client;
      this.client = async () => c;
    } else {
      const key = opts.apiKey ?? process.env.MEM0_API_KEY;
      if (!key) throw new Error("Mem0Store needs MEM0_API_KEY");
      this.client = () => {
        let c = clients.get(key);
        if (!c) clients.set(key, (c = defaultClient(key)));
        return c;
      };
    }
  }

  private call<T>(label: string, fn: (c: Mem0Like) => Promise<T>): Promise<T> {
    return withTimeout(this.client().then(fn), this.timeoutMs, `mem0 ${label}`);
  }

  /** MemoryStore.add (the frozen contract). Use remember() to get the rows written. */
  async add(text: string, entities: string[], meta: { message_id: string }): Promise<void> {
    await this.remember(text, entities, meta);
  }

  /** Sends the text to mem0 once per entity, then records what mem0 kept in memory_refs. */
  async remember(text: string, entities: string[], meta: { message_id: string }, opts: AddOptions = {}): Promise<AddResult> {
    const ents = cleanEntities(entities);
    const addId = randomUUID();
    const result: AddResult = { add_id: addId, memories: 0, pending: [], refs: [] };
    if (!ents.length || !text.trim()) return result;
    const metadata = { message_id: meta.message_id, entities: ents, add_id: addId };
    const messageId = isUuid(meta.message_id) ? meta.message_id : null;
    const db = admin();

    await Promise.all(
      ents.map(async (e) => {
        const res = await this.call("add", (c) => c.add([{ role: "user", content: text }], { userId: e, metadata, ...(opts.infer === false ? { infer: false } : {}) }));
        let memories: Memory[] = Array.isArray(res) ? (res as Memory[]).filter((m) => m.event !== "NOOP" && m.event !== "DELETE") : [];
        if (!Array.isArray(res)) memories = await this.waitFor(e, addId);
        const rows = memories.filter((m) => memoryText(m)).map((m) => ({
          mem0_id: m.id, entity: e, message_id: messageId, text: memoryText(m).slice(0, MAX_TEXT), is_demo: !!opts.isDemo, ...entityColumns(e),
        }));
        if (!rows.length) {
          rows.push({ mem0_id: PENDING + addId, entity: e, message_id: messageId, text: text.slice(0, MAX_TEXT), is_demo: !!opts.isDemo, ...entityColumns(e) });
          result.pending.push(e);
        } else result.memories += rows.length;
        const { data, error } = await db.from("memory_refs").upsert(rows, { onConflict: "mem0_id,entity" }).select("id,mem0_id,entity,text");
        if (error) throw new Error(`memory_refs write failed: ${error.message}`);
        result.refs.push(...((data ?? []) as MemoryRef[]));
      }),
    );
    return result;
  }

  /** Polls getAll() for the memories of one add() call. Returns [] when time runs out. */
  private async waitFor(e: string, addId: string): Promise<Memory[]> {
    const until = Date.now() + this.pollTotalMs;
    while (Date.now() < until) {
      await sleep(this.pollEveryMs);
      const found = await this.byAddId(e, addId).catch(() => []);
      if (found.length) return found;
    }
    return [];
  }

  private async byAddId(e: string, addId: string): Promise<Memory[]> {
    const page = await this.call("getAll", (c) => c.getAll({ filters: { user_id: e }, pageSize: 100 }));
    return (page.results ?? []).filter((m) => metaOf(m).add_id === addId && memoryText(m));
  }

  /** The mem0 memories of one entity whose metadata.message_id is this value. The seed uses it to skip repeats. */
  async findByMessageId(e: string, messageId: string): Promise<Memory[]> {
    const page = await this.call("getAll", (c) => c.getAll({ filters: { user_id: e }, pageSize: 100 }));
    return (page.results ?? []).filter((m) => metaOf(m).message_id === messageId);
  }

  /** Writes memory_refs rows for memories that mem0 already holds. */
  async recordExisting(memories: Memory[]) {
    return memories.length ? this.record(memories) : [];
  }

  /** Searches the memories of the given entities. Deleted memories stay hidden. */
  async search(query: string, entities: string[], limit = 10): Promise<ContextItem[]> {
    const ents = cleanEntities(entities);
    if (!ents.length || !query.trim()) return [];
    const filters = ents.length === 1 ? { user_id: ents[0] } : { OR: ents.map((e) => ({ user_id: e })) };
    const res = await this.call("search", (c) => c.search(query, { filters, topK: limit }));
    const hits = (res.results ?? []).filter((m) => memoryText(m));
    if (!hits.length) return [];

    const db = admin();
    const ids = [...new Set(hits.map((m) => m.id))];
    const { data: refs } = await db.from("memory_refs").select("id,mem0_id,entity,deleted_at").in("mem0_id", ids);
    const deleted = new Set((refs ?? []).filter((r: any) => r.deleted_at).map((r: any) => r.mem0_id));
    const refId = new Map<string, string>();
    for (const r of refs ?? []) if (!r.deleted_at && !refId.has(`${r.mem0_id}|${r.entity}`)) refId.set(`${r.mem0_id}|${r.entity}`, r.id);

    // Memories that mem0 finished after add() stopped waiting: record them now.
    const unknown = hits.filter((m) => !deleted.has(m.id) && m.userId && !refId.has(`${m.id}|${m.userId}`));
    if (unknown.length) {
      const inserted = await this.record(unknown).catch((e) => {
        console.warn("[memory] could not record new mem0 memories:", (e as Error).message);
        return [];
      });
      for (const r of inserted) refId.set(`${r.mem0_id}|${r.entity}`, r.id);
    }

    // The same text is stored once per entity, so one fact can come back once per scope.
    const out: ContextItem[] = [];
    const seen = new Set<string>();
    for (const m of hits) {
      const key = textKey(memoryText(m));
      if (deleted.has(m.id) || seen.has(m.id) || seen.has(key)) continue;
      seen.add(m.id).add(key);
      out.push({ text: memoryText(m), source_id: refId.get(`${m.id}|${m.userId}`) ?? `mem0:${m.id}`, source_type: "memory" });
    }
    return out;
  }

  /** Writes memory_refs rows for mem0 memories, and replaces the pending row of the same add_id. */
  private async record(memories: Memory[]): Promise<{ id: string; mem0_id: string; entity: string }[]> {
    const db = admin();
    const addIds = [...new Set(memories.map((m) => metaOf(m).add_id).filter((x): x is string => typeof x === "string"))];
    const { data: pend } = addIds.length
      ? await db.from("memory_refs").select("mem0_id,entity,is_demo").in("mem0_id", addIds.map((a) => PENDING + a))
      : { data: [] as any[] };
    const demo = new Map((pend ?? []).map((p: any) => [`${p.mem0_id}|${p.entity}`, !!p.is_demo]));
    const rows = memories.map((m) => {
      const md = metaOf(m);
      const e = m.userId as string;
      return {
        mem0_id: m.id, entity: e, text: memoryText(m).slice(0, MAX_TEXT),
        message_id: isUuid(md.message_id) ? (md.message_id as string) : null,
        is_demo: demo.get(`${PENDING}${md.add_id}|${e}`) ?? false, ...entityColumns(e),
      };
    });
    const { data, error } = await db.from("memory_refs").upsert(rows, { onConflict: "mem0_id,entity" }).select("id,mem0_id,entity");
    if (error) throw error;
    for (const m of memories) {
      const a = metaOf(m).add_id;
      if (typeof a === "string") await db.from("memory_refs").delete().eq("mem0_id", PENDING + a).eq("entity", m.userId as string).is("deleted_at", null);
    }
    return (data ?? []) as { id: string; mem0_id: string; entity: string }[];
  }

  /** Completes pending rows of these entities. Gives up on rows older than 30 minutes. Returns rows resolved. */
  async reconcile(entities: string[]): Promise<number> {
    const ents = cleanEntities(entities);
    if (!ents.length) return 0;
    const db = admin();
    const { data: pend } = await db.from("memory_refs").select("id,mem0_id,entity,created_at")
      .in("entity", ents).like("mem0_id", `${PENDING}%`).is("deleted_at", null);
    let resolved = 0;
    for (const p of pend ?? []) {
      const addId = String(p.mem0_id).slice(PENDING.length);
      const found = await this.byAddId(p.entity, addId).catch(() => null);
      if (found === null) continue; // mem0 down: try again later
      if (found.length) {
        await this.record(found);
        resolved++;
      } else if (Date.now() - new Date(p.created_at).getTime() > PENDING_GIVE_UP_MS) {
        await db.from("memory_refs").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
      }
    }
    return resolved;
  }

  /**
   * Deletes one memory. memoryId is a memory_refs id, a mem0 id or "mem0:<id>".
   * The local rows are hidden first, so the memory is gone from the panel even if mem0 fails.
   */
  async remove(memoryId: string, opts: { deletedBy?: string | null } = {}): Promise<void> {
    const mem0Id = await resolveMem0Id(memoryId);
    await markDeleted(mem0Id, opts.deletedBy ?? null);
    if (mem0Id.startsWith(PENDING) || mem0Id.startsWith("local:")) return;
    try {
      await this.call("delete", (c) => c.delete(mem0Id));
    } catch (e: any) {
      if (e?.name === "MemoryNotFoundError" || e?.constructor?.name === "MemoryNotFoundError") return;
      throw e;
    }
  }
}

/** memory_refs id -> its mem0_id. Otherwise the input is the mem0 id itself. */
export async function resolveMem0Id(memoryId: string): Promise<string> {
  const id = memoryId.startsWith("mem0:") ? memoryId.slice(5) : memoryId;
  if (isUuid(id)) {
    const { data } = await admin().from("memory_refs").select("mem0_id").eq("id", id).maybeSingle();
    if (data?.mem0_id) return data.mem0_id as string;
  }
  return id;
}

/** Hides every memory_refs row of one memory (one row per entity). */
export async function markDeleted(mem0Id: string, deletedBy: string | null): Promise<number> {
  const { data, error } = await admin().from("memory_refs")
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq("mem0_id", mem0Id).is("deleted_at", null).select("id");
  if (error) throw new Error(`memory_refs delete failed: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Seeds the "What we remember" panel with MADE-UP vendor anecdotes (PLAN section 6).
 * None of this text comes from the client. Each line says "(made-up demo note)", and each
 * memory_refs row has is_demo = true, so the panel shows a demo badge.
 *
 * It looks up the four quoting vendors and the projects by name (read only) and adds each
 * anecdote through memoryStore().add with the scopes vendor:<id> and project:<id>.
 * With MEM0_API_KEY it goes to mem0; without it, only to memory_refs.
 *
 * Safe to run again: an anecdote is skipped when memory_refs already has its text, or when
 * mem0 already holds a memory with its seed key.
 *
 *   npm run seed:b-memories
 */
import { createHash } from "node:crypto";
import { admin } from "../../../src/lib/supabase";
import { Mem0Store, entity, memoryStore } from "../../../src/memory";

interface Anecdote {
  vendor: string; // matched with ILIKE on vendors.name (exact name where another vendor shares the word)
  project?: string; // matched with ILIKE on projects.name
  text: string;
}

const ANECDOTES: Anecdote[] = [
  { vendor: "Bajrang%", project: "%21 Acres%", text: "Bajrang's team was 9 days late on the 21 Acres Phase 2 terrace waterproofing (made-up demo note)." },
  { vendor: "Bajrang%", project: "%Aquina%", text: "Bajrang re-did two toilet floors at no charge after a flood test failed at Aquina Block B (made-up demo note)." },
  { vendor: "Purvyakruti", project: "%Aquina%", text: "Purvyakruti finished the Aquina podium membrane 4 days early, and the site engineer rated the finish as clean (made-up demo note)." },
  { vendor: "Purvyakruti", text: "Purvyakruti asked for a 40% advance on a small repair job; Vinayak paid 10% and the job went ahead without trouble (made-up demo note)." },
  { vendor: "Shyama", project: "%21 Acres%", text: "Shyama's crew worked without harnesses in the 21 Acres lift well, and the safety officer stopped work for a day (made-up demo note)." },
  { vendor: "Shyama", project: "%Aquina%", text: "Shyama raised a billing dispute over measured quantities on the Aquina basement job; it took three weeks to settle (made-up demo note)." },
  { vendor: "S.K.%", project: "%Amara%", text: "S.K. Construction finished the Amara Tower-1 balcony waterproofing on time, with no leaks after the first monsoon (made-up demo note)." },
  { vendor: "S.K.%", text: "S.K. Construction sends handwritten rates; check each rate twice before a comparison (made-up demo note)." },
];

const seedKey = (text: string) => "seed:" + createHash("sha256").update(text).digest("hex").slice(0, 16);

async function one<T>(table: string, pattern: string): Promise<T | null> {
  const { data, error } = await admin().from(table).select("id,name").ilike("name", pattern).limit(2);
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  if (!data?.length) return null;
  if (data.length > 1) console.warn(`  ! ${table} "${pattern}" matches ${data.length} rows; using "${(data[0] as any).name}"`);
  return data[0] as T;
}

async function main() {
  const db = admin();
  const store = memoryStore();
  const usesMem0 = store instanceof Mem0Store;
  console.log(`Seeding ${ANECDOTES.length} made-up anecdotes into ${usesMem0 ? "mem0 + memory_refs" : "memory_refs only (MEM0_API_KEY not set)"}`);
  let added = 0, skipped = 0, failed = 0;

  for (const a of ANECDOTES) {
    const vendor = await one<{ id: string; name: string }>("vendors", a.vendor);
    if (!vendor) {
      console.warn(`  ! no vendor matches "${a.vendor}"; run A's seed first`);
      failed++;
      continue;
    }
    const project = a.project ? await one<{ id: string; name: string }>("projects", a.project) : null;
    const entities = [entity("vendor", vendor.id), ...(project ? [entity("project", project.id)] : [])];
    const key = seedKey(a.text);

    const { data: same } = await db.from("memory_refs").select("id").eq("text", a.text).limit(1);
    if (same?.length) {
      console.log(`  = ${vendor.name}: already in memory_refs`);
      skipped++;
      continue;
    }
    if (usesMem0) {
      const held = await store.findByMessageId(entities[0], key).catch(() => []);
      if (held.length) {
        await store.recordExisting(held);
        console.log(`  = ${vendor.name}: already in mem0 (${held.length} memory)`);
        skipped++;
        continue;
      }
    }
    try {
      const r = await store.remember(a.text, entities, { message_id: key }, { isDemo: true, infer: false });
      console.log(`  + ${vendor.name}${project ? ` / ${project.name}` : ""}: ${r.memories} memory row(s)${r.pending.length ? `, pending for ${r.pending.join(", ")}` : ""}`);
      added++;
    } catch (e) {
      console.warn(`  ! ${vendor.name}: ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`Done: ${added} added, ${skipped} skipped, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

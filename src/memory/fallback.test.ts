import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextItem, MemoryStore } from "@/contracts/context";
import { searchWithFallback } from "./index";

const E = "vendor:9baa9c2b-301b-4fe3-b295-ba1e0670f75c";
const item = (t: string): ContextItem => ({ text: t, source_id: `id-${t}`, source_type: "memory" });

class FakeStore implements MemoryStore {
  calls = 0;
  constructor(private behaviour: "ok" | "throw" | "hang", private items: ContextItem[] = []) {}
  async add() {}
  async remove() {}
  async search(): Promise<ContextItem[]> {
    this.calls++;
    if (this.behaviour === "throw") throw new Error("mem0 is down");
    if (this.behaviour === "hang") await new Promise((r) => setTimeout(r, 500));
    return this.items;
  }
}

test("fallback: primary answers, fallback not called", async () => {
  const primary = new FakeStore("ok", [item("late")]);
  const fallback = new FakeStore("ok", [item("local")]);
  const out = await searchWithFallback(primary, fallback, "late", [E]);
  assert.equal(out.used, "mem0");
  assert.deepEqual(out.items.map((i) => i.text), ["late"]);
  assert.equal(fallback.calls, 0);
});

test("fallback: primary throws, local answers", async () => {
  const out = await searchWithFallback(new FakeStore("throw"), new FakeStore("ok", [item("local")]), "late", [E]);
  assert.equal(out.used, "local");
  assert.match(out.error ?? "", /down/);
  assert.deepEqual(out.items.map((i) => i.text), ["local"]);
});

test("fallback: primary times out, local answers", async () => {
  const out = await searchWithFallback(new FakeStore("hang"), new FakeStore("ok", [item("local")]), "late", [E], 30);
  assert.equal(out.used, "local");
  assert.match(out.error ?? "", /timed out/);
});

test("fallback: both fail, the error goes to the caller (getContext turns it into memories: [])", async () => {
  await assert.rejects(searchWithFallback(new FakeStore("throw"), new FakeStore("throw"), "late", [E]), /down/);
});

test("fallback: no valid entity, no search", async () => {
  const primary = new FakeStore("ok", [item("x")]);
  const out = await searchWithFallback(primary, null, "late", ["junk"]);
  assert.deepEqual(out, { items: [], used: "none" });
  assert.equal(primary.calls, 0);
});

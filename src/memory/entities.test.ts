import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanEntities, emailKey, entityColumns, parseAllowlist, parseEntity, phoneKey, rankByOverlap, senderAllowed,
  vendorKeyword, vendorsMentioned, withTimeout, TimeoutError,
} from "./entities";

const V = "9baa9c2b-301b-4fe3-b295-ba1e0670f75c";
const C = "37b762dc-2e9f-4dde-a7ff-f2a20a3dc7f4";

test("entities: parse, columns, clean", () => {
  assert.deepEqual(parseEntity(`vendor:${V}`), { kind: "vendor", id: V });
  assert.deepEqual(parseEntity("Project:abc"), { kind: "project", id: "abc" });
  assert.equal(parseEntity("bajrang"), null);
  assert.equal(parseEntity("site:1"), null);
  assert.equal(parseEntity("vendor:"), null);
  assert.deepEqual(entityColumns(`vendor:${V}`), { vendor_id: V, case_id: null });
  assert.deepEqual(entityColumns(`case:${C}`), { vendor_id: null, case_id: C });
  assert.deepEqual(entityColumns("vendor:bajrang"), { vendor_id: null, case_id: null }, "only uuids go into uuid columns");
  assert.deepEqual(entityColumns(`project:${C}`), { vendor_id: null, case_id: null });
  assert.deepEqual(cleanEntities([`vendor:${V}`, "junk", `VENDOR:${V}`, `case:${C}`]), [`vendor:${V}`, `case:${C}`]);
});

test("allow-list: emails, phones, empty list sends nothing", () => {
  assert.equal(emailKey("Site Office <Site@Example.com>"), "site@example.com");
  assert.equal(emailKey("+91 98300 12345"), null);
  assert.equal(phoneKey("919830012345@s.whatsapp.net"), "9830012345");
  assert.equal(phoneKey("+91 98300-12345"), "9830012345");
  assert.equal(phoneKey("12345"), null);

  const list = parseAllowlist(" demo+site@gmail.com , +91 98300 12345 ,, ");
  assert.equal(senderAllowed("Demo <DEMO+site@gmail.com>", list), true);
  assert.equal(senderAllowed("919830012345@s.whatsapp.net", list), true);
  assert.equal(senderAllowed("098300 12345", list), true);
  assert.equal(senderAllowed("client@vinayak.example", list), false, "a client address is not on the list");
  assert.equal(senderAllowed(null, list), false);
  assert.equal(senderAllowed("", list), false);

  const empty = parseAllowlist("");
  assert.equal(senderAllowed("demo+site@gmail.com", empty), false);
  assert.equal(senderAllowed("demo+site@gmail.com", parseAllowlist(undefined)), false);
});

test("withTimeout rejects slow work and passes fast work", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, "fast"), 7);
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 20, "slow"), TimeoutError);
});

test("rankByOverlap: word matches first, rows with no common word dropped", () => {
  const rows = [
    { id: "a", text: "Bajrang was 9 days late at 21 Acres" },
    { id: "b", text: "Purvyakruti finished early" },
    { id: "c", text: "Late delivery of membrane by Bajrang" },
  ];
  const out = rankByOverlap("late Bajrang", rows, 5);
  assert.deepEqual(out.map((r) => r.id).sort(), ["a", "c"]);
  assert.ok(out[0].score >= out[1].score);
  assert.equal(rankByOverlap("anything", rows, 1).length, 0);
  assert.equal(rankByOverlap("", rows, 2).length, 2, "an empty query keeps the newest rows");
});

test("vendorsMentioned: distinctive word, full name, initials", () => {
  const vendors = [
    { id: "1", name: "Bajrang Construction & Waterproofing" },
    { id: "2", name: "Purvyakruti" },
    { id: "3", name: "S.K. Construction" },
    { id: "4", name: "Shyama" },
    { id: "5", name: "Shree Construction" },
  ];
  assert.equal(vendorKeyword("Bajrang Construction & Waterproofing"), "bajrang");
  assert.equal(vendorKeyword("Shree Construction"), null);
  const ids = (t: string) => vendorsMentioned(t, vendors).map((v) => v.id);
  assert.deepEqual(ids("Bajrang's team was late"), ["1"]);
  assert.deepEqual(ids("SK and Purvyakruti both quoted"), ["2", "3"]);
  assert.deepEqual(ids("s.k. construction sent rates"), ["3"]);
  assert.deepEqual(ids("Shyamal said construction is slow"), [], "a longer word does not match, generic words do not match");
});

test("textKey treats spacing, case and a final full stop as the same text", async () => {
  const { textKey } = await import("./entities");
  assert.equal(textKey("S.K. finished  on time."), textKey("s.k. finished on time"));
  assert.notEqual(textKey("on time"), textKey("late"));
});

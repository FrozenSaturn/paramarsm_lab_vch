import { test } from "node:test";
import assert from "node:assert/strict";
import { gstTreatmentFrom, newestPerVendor } from "./load";

test("GST treatment comes from W5's flags, then from the printed text", () => {
  assert.equal(gstTreatmentFrom([{ code: "gst_inclusive", severity: "warn", message: "" }], "Rates inclusive of GST"), "inclusive");
  assert.equal(gstTreatmentFrom([{ code: "gst_not_stated", severity: "info", message: "" }], null), "not_stated");
  assert.equal(gstTreatmentFrom([], null), "not_stated");
  assert.equal(gstTreatmentFrom([], "GST @ 18% extra"), "extra");
});

test("newest version per vendor wins, ordered by vendor id", () => {
  const rows = [
    { id: "q1", vendor_id: "b", version: 1 }, { id: "q2", vendor_id: "a", version: 1 },
    { id: "q3", vendor_id: "b", version: 2 }, { id: "q4", vendor_id: "a", version: null },
  ];
  assert.deepEqual(newestPerVendor(rows).map((r) => r.id), ["q2", "q3"]);
});

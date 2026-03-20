import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeTemporalMeta, validateTemporalMeta } from "../src/neuro/schemas.js";
import { computeRecencyWeight, inferTimeContext } from "../src/neuro/temporal.js";

test("validate/sanitize temporal meta", () => {
  const clean = sanitizeTemporalMeta({ date: "2025-02-10", timeContext: "historical", stage: "adolescencia" });
  assert.equal(clean.date, "2025-02-10");
  assert.equal(clean.timeContext, "historical");
  assert.equal(clean.stage, "adolescencia");
  assert.equal(clean.source, "unknown");
  assert.equal(validateTemporalMeta(clean).length, 0);
  assert.ok(validateTemporalMeta({ date: "2025-99-40" }).length > 0);
});

test("computeRecencyWeight and inferTimeContext use recency", () => {
  const now = "2026-03-19T00:00:00.000Z";
  assert.equal(inferTimeContext("2026-03-19T00:00:00.000Z", { now }), "current");
  assert.equal(inferTimeContext("2025-01-01T00:00:00.000Z", { now }), "historical");
  assert.ok(computeRecencyWeight("2026-03-18T00:00:00.000Z", { now }) > computeRecencyWeight("2024-01-01T00:00:00.000Z", { now }));
});

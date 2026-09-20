import test from "node:test";
import assert from "node:assert/strict";

import { createNeuron, sanitizeNeuron, validateNeuron, sanitizeTemporalMeta, validateTemporalMeta } from "../src/neuro/schemas.js";

test("sanitize manual meta normalizes aliases and category", () => {
  const n = sanitizeNeuron(createNeuron({
    type: "person",
    core: { concept: "Fergis", domain: "relationships", summary: "Esposa" },
    source: { kind: "manual", ref: "context_window" },
    meta: { aliases: ["Mi Esposa", " mi esposa ", "FERGIS"], priority: "high", pin: true, manualCategory: "people" },
  }));

  assert.deepEqual(n.meta.aliases, ["mi esposa", "fergis"]);
  assert.equal(n.meta.priority, "high");
  assert.equal(n.meta.pin, true);
  assert.equal(n.meta.manualCategory, "people");
  assert.equal(validateNeuron(n).length, 0);
});

test("legacy neurons stay valid without manual meta", () => {
  const legacy = createNeuron({ type: "memory", core: { concept: "Rutina", domain: "habits", summary: "mañana" } });
  const errs = validateNeuron(legacy);
  assert.equal(errs.length, 0);
});

test("temporal meta is sanitized and validated", () => {
  const today = new Date().toISOString().slice(0, 10);
  const t = sanitizeTemporalMeta({ date: today, stage: "trabajo_actual" });
  assert.equal(validateTemporalMeta(t).length, 0);
  const n = sanitizeNeuron(createNeuron({
    core: { concept: "hoy me siento", domain: "emocional", summary: "actual" },
    temporal: { date: today, recencyWeight: 0.01 },
  }));
  assert.ok(n.temporal.recencyWeight > 0.5);
});

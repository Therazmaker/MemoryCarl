import test from "node:test";
import assert from "node:assert/strict";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}
function reset() { Object.keys(store).forEach((k) => delete store[k]); }

import { importHistoricalEntries } from "../src/neuro/historicalImport.js";
import { getAllNeurons } from "../src/neuro/neuronStore.js";

test("importHistoricalEntries with exact dates", () => {
  reset();
  const out = importHistoricalEntries([
    { date: "2025-02-10", text: "Hoy me sentí saturado en el trabajo.", mode: "journal", source: "old_journal_app" },
    { date: "2025-02-11", text: "Volvió el bloqueo al iniciar tareas.", mode: "journal", source: "old_journal_app" },
  ]);
  assert.ok(out.created >= 1);
  assert.equal(out.temporalRange.start, "2025-02-10");
  const all = getAllNeurons();
  assert.ok(all.every((n) => n.temporal?.timeContext));
});

test("importHistoricalEntries supports stage without exact date", () => {
  reset();
  const out = importHistoricalEntries([
    { text: "En adolescencia sentía ansiedad al hablar.", approximatePeriod: "adolescencia", mode: "autobiography" },
  ]);
  assert.ok(out.created >= 1);
  const imported = getAllNeurons();
  assert.equal(imported[0].temporal.stage, "adolescencia");
  assert.equal(imported[0].temporal.timeContext, "historical");
});

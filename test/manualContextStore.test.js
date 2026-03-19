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
function resetStorage() { Object.keys(store).forEach((k) => delete store[k]); }

import {
  createManualContextNeuron,
  updateManualContextNeuron,
  deleteManualContextNeuron,
  searchManualContextNeurons,
  getPinnedContextNeurons,
} from "../src/neuro/neuronStore.js";

test("create/update/delete/search manual context neurons", async () => {
  resetStorage();
  const created = await createManualContextNeuron({
    type: "person",
    core: { concept: "Fergis", domain: "relationships", summary: "Esposa" },
    meta: { aliases: ["mi esposa"], priority: "high", pin: true, manualCategory: "people" },
  });
  assert.ok(created?.id);

  const matches = searchManualContextNeurons("esposa");
  assert.equal(matches.length, 1);

  const updated = await updateManualContextNeuron(created.id, {
    core: { concept: "Fergis", domain: "relationships", summary: "Esposa y partner de proyecto" },
    meta: { aliases: ["mi esposa", "fer"] },
  });
  assert.equal(updated.meta.aliases.includes("fer"), true);

  const pinned = getPinnedContextNeurons();
  assert.equal(pinned.length, 1);

  const removed = await deleteManualContextNeuron(created.id);
  assert.equal(removed, true);
  assert.equal(searchManualContextNeurons("fergis").length, 0);
});

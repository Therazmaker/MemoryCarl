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

import { createManualContextNeuron, getAllNeurons } from "../src/neuro/neuronStore.js";
import { linkNeurons, unlinkNeurons, suggestContextLinks } from "../src/neuro/connections.js";
import { applyQuickTemplate, getContextNeuronDeletionImpact, deleteContextNeuronSafely } from "../src/neuro/contextWindow.js";

test("linkNeurons and unlinkNeurons keep bidirectional links", async () => {
  resetStorage();
  const person = await createManualContextNeuron({ type: "person", core: { concept: "Fergis", domain: "relationships", summary: "esposa" }, meta: { manualCategory: "people" } });
  const project = await createManualContextNeuron({ type: "project", core: { concept: "Atlas", domain: "work", summary: "proyecto" }, meta: { manualCategory: "projects" } });

  assert.equal(linkNeurons(person.id, project.id, { connectionSource: "manual" }), true);
  let all = getAllNeurons();
  const p1 = all.find((n) => n.id === person.id);
  assert.ok(p1.connections.includes(project.id));

  assert.equal(unlinkNeurons(person.id, project.id), true);
  all = getAllNeurons();
  const p1u = all.find((n) => n.id === person.id);
  assert.equal(p1u.connections.includes(project.id), false);
});

test("quick template and suggestion helpers", () => {
  const t = applyQuickTemplate("person", "Fergis");
  assert.equal(t.type, "person");
  assert.equal(t.manualCategory, "people");

  const suggestions = suggestContextLinks(
    { id: "a", core: { concept: "Atlas", domain: "work" }, meta: { aliases: ["atlas app"] } },
    [{ id: "b", core: { concept: "Proyecto Atlas", summary: "atlas app", domain: "work" }, triggers: [] }],
  );
  assert.equal(suggestions.length, 1);
});

test("deleteContextNeuronSafely elimina neurona manual y no rompe store", async () => {
  resetStorage();
  const a = await createManualContextNeuron({ type: "person", core: { concept: "Fergis", domain: "relationships", summary: "" }, meta: { manualCategory: "people" } });
  const b = await createManualContextNeuron({ type: "project", core: { concept: "Atlas", domain: "work", summary: "" }, meta: { manualCategory: "projects" } });
  linkNeurons(a.id, b.id, { connectionSource: "manual" });
  localStorage.setItem("memorycarl_memories_v1", JSON.stringify([{ id: "m1", linkedNeurons: [a.id], text: "x" }]));
  const impact = getContextNeuronDeletionImpact(a.id);
  assert.equal(impact.memoriesAffected, 1);
  const result = deleteContextNeuronSafely(a.id, { hard: true });
  assert.equal(result.ok, true);
  assert.equal(getAllNeurons().some((n) => n.id === a.id), false);
});

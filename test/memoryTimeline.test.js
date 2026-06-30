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
  saveMemory,
  getAllMemories,
  updateMemory,
  deleteMemory,
  searchMemories,
  linkMemoryToNeurons,
} from "../src/memory/memoryStore.js";
import { getMemories, saveMemoryFromMessage, getMemoryContextByNeuron, clearChatHistory, getChatHistory } from "../src/chat/neurochat.js";
import { saveInsightBatch } from "../src/neuro/insightHistory.js";
import { renderMemoriesTimeline, __setNeuroChatUiStateForTests } from "../src/chat/neurochat-ui.js";

test("memory storage CRUD + filtros avanzados", () => {
  resetStorage();
  const m1 = saveMemory({
    title: "Graduación",
    text: "Hoy recordé mi graduación y me sentí feliz.",
    date: "2020-07-10",
    emotion: "joy",
    importance: "high",
    tags: ["educación", "hito"],
    temporal: { stage: "past", date: "2020-07-10" },
    isMilestone: true,
  });
  const m2 = saveMemory({
    title: "Mudanza",
    text: "Ayer me mudé y tuve ansiedad.",
    date: "2024-01-05",
    emotion: "fear",
    importance: "medium",
    tags: ["hogar"],
    temporal: { stage: "present", date: "2024-01-05" },
  });
  assert.equal(getAllMemories().length, 2);

  const updated = updateMemory(m2.id, { importance: "high", tags: ["hogar", "familia"] });
  assert.equal(updated.importance, "high");
  assert.ok(updated.tags.includes("hogar"));
  assert.ok(updated.tags.includes("familia"));

  const filtered = searchMemories("mud", {
    importance: "high",
    stage: "present",
    tags: ["hogar"],
    dateFrom: "2023-01-01",
    dateTo: "2025-12-31",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, m2.id);

  assert.equal(deleteMemory(m1.id), true);
  assert.equal(getAllMemories().length, 1);
});

test("guardar memoria desde chat toma mensaje y neuronas activadas", () => {
  resetStorage();
  clearChatHistory();
  const messageId = "msg_test_1";
  getChatHistory().push(
    { role: "user", content: "Hoy logré mi primer ascenso en el trabajo", ts: 1, mode: "chat", messageId },
    { role: "assistant", content: "Qué bien", ts: 2, messageId, activatedNeuronIds: ["n_job_1", "n_growth_2"] },
  );

  const memory = saveMemoryFromMessage(messageId, { importance: "high", isMilestone: true });
  assert.equal(memory.isMilestone, true);
  assert.equal(memory.linkedNeurons.length, 2);
  assert.match(memory.title, /Hoy logré/i);
});

test("timeline renderiza lista cronológica y filtros", () => {
  resetStorage();
  saveMemory({
    title: "Recuerdo A",
    text: "Ayer me sentí feliz en casa",
    date: "2023-08-20",
    emotion: "joy",
    importance: "high",
    tags: ["familia"],
    linkedNeurons: ["n1"],
  });
  saveMemory({
    title: "Recuerdo B",
    text: "Tuve miedo en una reunión",
    date: "2024-02-10",
    emotion: "fear",
    importance: "medium",
    tags: ["trabajo"],
  });
  __setNeuroChatUiStateForTests({
    activeTab: "memories",
    memorySearch: "",
    memoryFilters: { emotion: "joy", importance: "", stage: "", tags: "", dateFrom: "", dateTo: "" },
  });
  const html = renderMemoriesTimeline();
  assert.match(html, /Nueva memoria/i);
  assert.match(html, /Recuerdo A/i);
  assert.doesNotMatch(html, /Recuerdo B/i);
});

test("timeline muestra conceptos legibles y botón de auto-fix", () => {
  resetStorage();
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([
    {
      id: "n_lab_1",
      type: "memory",
      core: { concept: "tensión con Fergis", domain: "relationships", summary: "" },
      triggers: [],
      connections: [],
      weight: 0.5,
      emotion: "fear",
      evidence: [],
      embedding: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { kind: "user", ref: "" },
      feedbackStats: { likes: 0, dislikes: 0, netScore: 0, lastFeedbackAt: null },
      activationLearning: { usefulCount: 0, falsePositiveCount: 0 },
      evolution: { enabled: true, usageCount: 0, successfulActivations: 0, failedActivations: 0, falsePositiveCount: 0, finalSelectionCount: 0, likeCount: 0, dislikeCount: 0, lastUsedAt: null, lastEvolvedAt: null, recentUsage: [], triggerCandidates: [], triggerHistory: [], summaryHistory: [], weightHistory: [], connectionHistory: [], summarySuggestion: null, connectionSuggestions: [] },
      temporal: { timeContext: "timeless", source: "unknown", confidence: "low", recencyWeight: 0.4, sourcePeriod: null, isHistorical: false, isPast: false, date: null, timestamp: null, stage: null },
    },
  ]));
  saveMemory({
    title: "Conflicto",
    text: "No estábamos alineados con Fergis",
    date: "2026-03-20",
    linkedNeurons: ["n_lab_1"],
  });
  __setNeuroChatUiStateForTests({ activeTab: "memories", memoryFilters: { emotion: "", importance: "", stage: "", tags: "", dateFrom: "", dateTo: "" } });
  const html = renderMemoriesTimeline();
  assert.match(html, /Auto-fix memory/i);
  assert.match(html, /tensión con Fergis/i);
});

test("vínculo memoria-neurona devuelve insights relacionados", () => {
  resetStorage();
  const mem = saveMemory({
    title: "Terapia",
    text: "En terapia entendí mejor mi ansiedad.",
    linkedNeurons: ["n_therapy"],
  });
  linkMemoryToNeurons(mem.id, ["n_therapy", "n_calm"]);
  saveInsightBatch([{
    id: "ins_1",
    type: "dominant_pattern",
    title: "Patrón de calma progresiva",
    summary: "Menos ansiedad en contextos sociales.",
    basedOnNeurons: ["n_therapy"],
    signals: {},
  }]);
  const context = getMemoryContextByNeuron("n_therapy");
  assert.equal(context.memories.length, 1);
  assert.equal(context.insights.length, 1);
  const byFilter = getMemories({ filters: { tags: ["terapia"] } });
  assert.equal(byFilter.length, 1);
});

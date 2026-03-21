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
  assert.deepEqual(updated.tags, ["hogar", "familia"]);

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

import test from "node:test";
import assert from "node:assert/strict";

const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const { addMissingById, cloudNeuronToLocal, mergeCloudDays, repairDaysFromChat, cloudChatToLocal } = await import("../src/services/cloudRestore.js");
const { getAllNeurons } = await import("../src/neuro/neuronStore.js");
const { getAllDays, repairDaysFromChatHistory, mergeDaysFromCloud, appendToCurrentDay } = await import("../src/day/dayStore.js");
const { todayLocalStr } = await import("../src/chat/lifeDates.js");

test("las neuronas recortadas de la nube se reconstruyen al cargarlas", () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([
    { id: "n1", concept: "Trabajo", domain: "work", summary: "Empresa B", triggers: ["trabajo"], emotion: "neutral", weight: 1, temporal: {} },
  ]));
  const neurons = getAllNeurons();
  assert.equal(neurons.length, 1);
  assert.equal(neurons[0].core.concept, "Trabajo");
  assert.ok(JSON.parse(localStorage.getItem("memorycarl_neurochat_neurons"))[0].core, "se guarda ya reparada");
});

test("restaurar solo añade lo que falta, nunca reemplaza", () => {
  const local = [{ id: "n1", core: { concept: "Local" }, connections: ["n2"] }];
  const cloud = [{ id: "n1", concept: "Nube" }, { id: "n3", concept: "Nueva" }];
  const { list, added } = addMissingById(local, cloud, cloudNeuronToLocal);
  assert.equal(added, 1);
  assert.equal(list.find((n) => n.id === "n1").core.concept, "Local");
  assert.equal(list.find((n) => n.id === "n3").core.concept, "Nueva");
});

test("los días de la nube no borran los mensajes del día", () => {
  const local = [{ id: "d1", date: "2026-10-29", rawChat: [{ role: "user", content: "hola", ts: 1 }], summary: "", dominantThemes: [] }];
  const cloud = [
    { id: "d1", date: "2026-10-29", summary: "Día tranquilo", dominant_emotion: "joy", dominant_themes: ["trabajo"] },
    { id: "d2", date: "2026-10-20", summary: "Otro día" },
  ];
  const { list } = mergeCloudDays(local, cloud);
  const d1 = list.find((d) => d.date === "2026-10-29");
  assert.equal(d1.rawChat.length, 1);
  assert.equal(d1.summary, "Día tranquilo");
  assert.deepEqual(list.find((d) => d.date === "2026-10-20").rawChat, []);
});

test("los días recuperan sus mensajes desde el historial del chat", () => {
  localStorage.clear();
  const ts = new Date(2026, 9, 28, 21, 30).getTime(); // 28 oct, 21:30 hora local
  localStorage.setItem("memorycarl_days_v1", JSON.stringify([{ id: "x", date: "2026-10-28", summary: "s" }])); // día recortado
  const history = [
    { role: "user", content: "Conseguí trabajo", ts, messageId: "m1" },
    { role: "assistant", content: "¡Felicidades!", ts: ts + 1000, messageId: "m1" },
  ];
  assert.equal(repairDaysFromChatHistory(history), 2);
  assert.equal(repairDaysFromChatHistory(history), 0, "no duplica");
  const day = getAllDays().find((d) => d.date === "2026-10-28");
  assert.equal(day.rawChat.length, 2);
  assert.equal(day.summary, "s");
});

test("el día de hoy usa la fecha local", () => {
  localStorage.clear();
  const day = appendToCurrentDay({ role: "user", content: "hola", ts: Date.now() });
  assert.equal(day.date, todayLocalStr());
});

test("mensajes de la nube recuperan su fecha", () => {
  const m = cloudChatToLocal({ id: "a", message_id: "a", role: "user", content: "hola", created_at: "2026-10-29T10:00:00Z" });
  assert.equal(m.ts, Date.parse("2026-10-29T10:00:00Z"));
  assert.equal(m.messageId, "a");
  assert.equal(mergeDaysFromCloud([]), false);
});

test("una neurona más reciente en la nube actualiza la local sin perder conexiones", async () => {
  const { refreshNeuronsFromCloud } = await import("../src/services/cloudRestore.js");
  const local = [
    { id: "a", core: { concept: "Viejo", domain: "general", summary: "" }, connections: ["b"], updatedAt: "2026-07-01T00:00:00.000Z" },
    { id: "b", core: { concept: "Local nuevo", domain: "general", summary: "" }, connections: [], updatedAt: "2026-10-30T00:00:00.000Z" },
  ];
  const cloud = [
    { id: "a", concept: "Nuevo en la nube", domain: "work", updated_at: "2026-10-29T00:00:00.000Z" },
    { id: "b", concept: "Viejo en la nube", domain: "general", updated_at: "2026-08-01T00:00:00.000Z" },
  ];
  const { list, updated } = refreshNeuronsFromCloud(local, cloud);
  assert.equal(updated, 1);
  assert.equal(list[0].core.concept, "Nuevo en la nube");
  assert.deepEqual(list[0].connections, ["b"]);
  assert.equal(list[1].core.concept, "Local nuevo");
});

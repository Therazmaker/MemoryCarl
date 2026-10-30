import test from "node:test";
import assert from "node:assert/strict";

const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const { getApiConfig, buildSyncPayload, pushNeurochatNow, getSyncStatus } = await import("../src/services/neurochatSync.js");

test("usa la key de la app principal si NeuroChat no tiene la suya", () => {
  localStorage.clear();
  assert.equal(getApiConfig().key, "");
  localStorage.setItem("memorycarl_script_api_key", "k-app");
  assert.deepEqual(getApiConfig(), { url: "https://memory-carl.vercel.app", key: "k-app", source: "app" });
  localStorage.setItem("memorycarl_api_url", "https://otra.vercel.app/");
  localStorage.setItem("memorycarl_api_key", "k-nc");
  assert.deepEqual(getApiConfig(), { url: "https://otra.vercel.app", key: "k-nc", source: "neurochat" });
});

test("el envío lleva solo lo que el servidor guarda", () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([{ id: "n1", type: "memory", core: { concept: "A", domain: "general", summary: "" }, triggers: [], connections: ["n2"], weight: 0.5, emotion: "neutral", evidence: [], embedding: [0.1, 0.2] }]));
  localStorage.setItem("memorycarl_days_v1", JSON.stringify([{ id: "d", date: "2026-10-30", rawChat: [{ role: "user", content: "hola", ts: 1 }], summary: "s" }]));
  localStorage.setItem("memorycarl_neurochat_history", JSON.stringify([
    { role: "user", content: "hola", ts: 1, messageId: "m1" },
    { role: "assistant", content: "¡hola!", ts: 2, messageId: "m1" },
  ]));
  const p = buildSyncPayload();
  assert.ok(!("embedding" in p.neurons[0]));
  assert.ok(!("rawChat" in p.days[0]));
  assert.deepEqual(Object.keys(p.appState).sort(), ["lifeFacts", "openThreads"]);
  assert.deepEqual(p.chatHistory.map((m) => m.messageId), ["m1_user", "m1_assistant"]);
});

test("guarda el error del servidor para mostrarlo", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "mala");
  global.fetch = async () => new Response(JSON.stringify({ message: "No autorizado. API Key inválida." }), { status: 401 });
  const st = await pushNeurochatNow();
  assert.equal(st.ok, false);
  assert.equal(st.httpStatus, 401);
  assert.match(getSyncStatus().message, /No autorizado/);
});

test("sin key no intenta subir y lo explica", async () => {
  localStorage.clear();
  let called = false;
  global.fetch = async () => { called = true; return new Response("{}"); };
  const st = await pushNeurochatNow();
  assert.equal(called, false);
  assert.match(st.message, /Falta la API key/);
});

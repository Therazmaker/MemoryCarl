import test from "node:test";
import assert from "node:assert/strict";

const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const { getApiConfig, buildOutboxBatch, pushNeurochatNow, getSyncStatus } = await import("../src/services/neurochatSync.js");
const { markChanged, markAppStateChanged, pendingCount, loadOutbox } = await import("../src/services/syncOutbox.js");
const { saveNeuron, deleteNeuron } = await import("../src/neuro/neuronStore.js");
const { createNeuron } = await import("../src/neuro/schemas.js");

test("usa la key de la app principal si NeuroChat no tiene la suya", () => {
  localStorage.clear();
  assert.equal(getApiConfig().key, "");
  localStorage.setItem("memorycarl_script_api_key", "k-app");
  assert.deepEqual(getApiConfig(), { url: "https://memory-carl.vercel.app", key: "k-app", source: "app" });
  localStorage.setItem("memorycarl_api_url", "https://otra.vercel.app/");
  localStorage.setItem("memorycarl_api_key", "k-nc");
  assert.deepEqual(getApiConfig(), { url: "https://otra.vercel.app", key: "k-nc", source: "neurochat" });
});

test("la cola lleva la neurona completa sin embedding y los días con su chat", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([{ id: "n1", type: "memory", core: { concept: "A", domain: "general", summary: "" }, triggers: [], connections: ["n2"], weight: 0.5, emotion: "neutral", evidence: [], embedding: [0.1, 0.2] }]));
  localStorage.setItem("memorycarl_days_v1", JSON.stringify([{ id: "d", date: "2026-10-30", rawChat: [{ role: "user", content: "hola", ts: 1 }], summary: "s" }]));
  markChanged("neurons", ["n1"]);
  markChanged("days", ["2026-10-30"]);
  markAppStateChanged();
  const { payload, empty } = await buildOutboxBatch();
  assert.equal(empty, false);
  assert.ok(!("embedding" in payload.neurons[0]));
  assert.deepEqual(payload.neurons[0].connections, ["n2"]);
  assert.equal(payload.days[0].rawChat.length, 1);
  assert.deepEqual(Object.keys(payload.appState).sort(), ["lifeFacts", "openThreads"]);
});

test("guardar y borrar neuronas las anota en la cola", () => {
  localStorage.clear();
  const n = createNeuron({ core: { concept: "Trabajo", domain: "work", summary: "" } });
  saveNeuron(n);
  assert.equal(loadOutbox().neurons[n.id].op, "upsert");
  deleteNeuron(n.id);
  assert.equal(loadOutbox().neurons[n.id].op, "delete");
});

test("solo se confirma lo que el servidor guardó; lo que falló sigue en la cola", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "k");
  localStorage.setItem("memorycarl_sync_backfill_v2", "1");
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([{ id: "n1", type: "memory", core: { concept: "A", domain: "general", summary: "" }, triggers: [], connections: [], weight: 0.5, emotion: "neutral", evidence: [], embedding: [] }]));
  localStorage.setItem("memorycarl_days_v1", JSON.stringify([{ id: "d", date: "2026-10-30", rawChat: [], summary: "" }]));
  markChanged("neurons", ["n1"]);
  markChanged("days", ["2026-10-30"]);
  global.fetch = async () => new Response(JSON.stringify({ data: { neuronsSynced: 1, errors: ["Error guardando días: boom"] } }), { status: 200 });
  const st = await pushNeurochatNow();
  assert.equal(st.partial, true);
  assert.equal(Object.keys(loadOutbox().neurons).length, 0);
  assert.equal(Object.keys(loadOutbox().days).length, 1);
});

test("muchos cambios se suben en varias tandas hasta vaciar la cola", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "k");
  localStorage.setItem("memorycarl_sync_backfill_v2", "1");
  const neurons = Array.from({ length: 320 }, (_, i) => ({ id: "n" + i, type: "memory", core: { concept: "N" + i, domain: "general", summary: "" }, triggers: [], connections: [], weight: 0.5, emotion: "neutral", evidence: [], embedding: [] }));
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify(neurons));
  markChanged("neurons", neurons.map((n) => n.id));
  let calls = 0;
  global.fetch = async (_url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    return new Response(JSON.stringify({ data: { neuronsSynced: body.neurons.length, errors: [] } }), { status: 200 });
  };
  const st = await pushNeurochatNow();
  assert.equal(calls, 3);
  assert.equal(st.counts.neurons, 320);
  assert.equal(pendingCount(), 0);
});

test("guarda el error del servidor para mostrarlo", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "mala");
  localStorage.setItem("memorycarl_sync_backfill_v2", "1");
  markAppStateChanged();
  global.fetch = async () => new Response(JSON.stringify({ message: "No autorizado. API Key inválida." }), { status: 401 });
  const st = await pushNeurochatNow();
  assert.equal(st.ok, false);
  assert.equal(st.httpStatus, 401);
  assert.match(getSyncStatus().message, /No autorizado/);
  assert.equal(pendingCount(), 1, "lo pendiente sigue en la cola");
});

test("sin key no intenta subir y lo explica", async () => {
  localStorage.clear();
  let called = false;
  global.fetch = async () => { called = true; return new Response("{}"); };
  const st = await pushNeurochatNow();
  assert.equal(called, false);
  assert.match(st.message, /Falta la API key/);
});

test("una tanda demasiado grande se parte y ningún envío supera ~3 MB", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "k");
  localStorage.setItem("memorycarl_sync_backfill_v2", "1");
  // 6 días con ~900 KB de chat cada uno (10 juntos superarían el límite)
  const big = "x".repeat(900 * 1024);
  const days = Array.from({ length: 6 }, (_, i) => ({ id: "d" + i, date: `2026-10-0${i + 1}`, rawChat: [{ role: "user", content: big, ts: i }], summary: "", _previousVersion: { rawChat: [{ content: big }] } }));
  localStorage.setItem("memorycarl_days_v1", JSON.stringify(days));
  markChanged("days", days.map((d) => d.date));
  const sizes = [];
  global.fetch = async (_url, opts) => {
    sizes.push(opts.body.length);
    const body = JSON.parse(opts.body);
    assert.ok(!("_previousVersion" in body.days[0]));
    return new Response(JSON.stringify({ data: { daysSynced: body.days.length, errors: [] } }), { status: 200 });
  };
  const st = await pushNeurochatNow();
  assert.equal(st.counts.days, 6);
  assert.ok(sizes.length >= 2);
  assert.ok(Math.max(...sizes) <= 3 * 1024 * 1024);
  assert.equal(pendingCount(), 0);
});

test("la subida inicial de todo se hace aunque el arranque haya fallado, y siempre tras leer la nube", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "k");
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([{ id: "viejo", type: "memory", core: { concept: "Desde julio", domain: "general", summary: "" }, triggers: [], connections: [], weight: 0.5, emotion: "neutral", evidence: [], embedding: [] }]));
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(String(url).includes("restore") ? "restore" : "sync");
    if (String(url).includes("restore")) return new Response(JSON.stringify({ data: { appState: {} } }), { status: 200 });
    const body = JSON.parse(opts.body);
    return new Response(JSON.stringify({ data: { neuronsSynced: body.neurons.length, errors: [] } }), { status: 200 });
  };
  const st = await pushNeurochatNow();
  assert.equal(calls[0], "restore", "primero lee la nube");
  assert.equal(st.counts.neurons, 1, "sube lo que ya existía");
  assert.equal(localStorage.getItem("memorycarl_sync_backfill_v2"), "1");
});

test("al fusionar 'Ahora' con la nube, lo que solo está en el teléfono se marca para subir", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_api_key", "k");
  localStorage.setItem("memorycarl_sync_backfill_v2", "1");
  localStorage.setItem("memorycarl_life_facts", JSON.stringify([{ id: "local", text: "Solo en el teléfono", category: "otro", status: "active", since: "2026-10-30", updatedAt: "2026-10-30T10:00:00Z" }]));
  global.fetch = async () => new Response(JSON.stringify({ data: { appState: { lifeFacts: [{ id: "nube", text: "Solo en la nube", category: "otro", status: "active", since: "2026-10-29", updatedAt: "2026-10-29T10:00:00Z" }] } } }), { status: 200 });
  const { pullNeurochat } = await import("../src/services/neurochatSync.js");
  await pullNeurochat();
  assert.ok(loadOutbox().appState > 0);
  const { payload } = await buildOutboxBatch();
  assert.deepEqual(payload.appState.lifeFacts.map((f) => f.id).sort(), ["local", "nube"]);
});

import test from "node:test";
import assert from "node:assert/strict";

const memoryStorage = {};
global.localStorage = {
  getItem: (key) => memoryStorage[key] ?? null,
  setItem: (key, val) => { memoryStorage[key] = String(val); },
  removeItem: (key) => { delete memoryStorage[key]; },
  clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
};

const { todayLocalStr } = await import("../src/chat/lifeDates.js");
const { upsertLifeFact, getLifeFacts, buildLifeFactsPromptBlock, inferArea } = await import("../src/chat/lifeFacts.js");
const { openThread, getOpenThreads, buildOpenThreadsPromptBlock, OPEN_THREADS_KEY } = await import("../src/chat/openThreads.js");
const { applyLifeActions, undoLifeChanges, reconcileThreadsWithFacts, describeLifeChange, mergeLifeLists } = await import("../src/chat/lifeChanges.js");
const { LIFE_FACTS_KEY } = await import("../src/chat/lifeFacts.js");

const daysAgo = (n) => todayLocalStr(new Date(Date.now() - n * 86400000));

test("conseguir trabajo cierra 'buscando trabajo' aunque la IA no lo cierre", () => {
  localStorage.clear();
  openThread({ topic: "Buscando trabajo", openedAt: daysAgo(20) });
  upsertLifeFact({ text: "Sin empleo", category: "trabajo", since: daysAgo(30) });

  const changes = applyLifeActions([
    { type: "upsertLifeFact", fact: { text: "Trabaja en Empresa B", category: "trabajo", since: todayLocalStr() } },
  ]);

  assert.equal(getOpenThreads({ status: "open" }).length, 0);
  assert.equal(getLifeFacts({ status: "active" }).length, 1);
  assert.equal(getLifeFacts({ status: "ended" })[0].text, "Sin empleo");
  assert.deepEqual(changes.map((c) => c.kind).sort(), ["fact_ended", "fact_started", "thread_resolved"]);
  assert.match(describeLifeChange(changes.find((c) => c.kind === "thread_resolved")).text, /Cerré: Buscando trabajo/);
});

test("deshacer deja todo como estaba", () => {
  localStorage.clear();
  openThread({ topic: "Buscando trabajo", openedAt: daysAgo(20) });
  upsertLifeFact({ text: "Sin empleo", category: "trabajo", since: daysAgo(30) });
  const beforeFacts = JSON.stringify(getLifeFacts({ status: "all" }));
  const beforeThreads = localStorage.getItem(OPEN_THREADS_KEY);

  const changes = applyLifeActions([
    { type: "upsertLifeFact", fact: { text: "Trabaja en Empresa B", category: "trabajo" } },
  ]);
  undoLifeChanges(changes);

  assert.equal(JSON.stringify(getLifeFacts({ status: "all" })), beforeFacts);
  assert.deepEqual(JSON.parse(localStorage.getItem(OPEN_THREADS_KEY)), JSON.parse(beforeThreads));
});

test("la IA puede cerrar hilos y etapas por id", () => {
  localStorage.clear();
  const t = openThread({ topic: "Esperando respuesta del casero" });
  const f = upsertLifeFact({ text: "Vive con sus padres", category: "vivienda" });
  applyLifeActions([
    { type: "resolveThread", id: t.id },
    { type: "endLifeFact", id: f.id },
  ]);
  assert.equal(getOpenThreads({ status: "open" }).length, 0);
  assert.equal(getLifeFacts({ status: "active" }).length, 0);
});

test("cerrar por texto ignora tildes y mayúsculas", () => {
  localStorage.clear();
  openThread({ topic: "Búsqueda de departamento" });
  applyLifeActions([{ type: "resolveThread", match: "busqueda de DEPARTAMENTO" }]);
  assert.equal(getOpenThreads({ status: "open" }).length, 0);
});

test("en áreas no exclusivas las etapas conviven, salvo reemplazo explícito", () => {
  localStorage.clear();
  const a = upsertLifeFact({ text: "Va al gimnasio 3 veces por semana", category: "salud" });
  upsertLifeFact({ text: "Hace terapia los martes", category: "salud" });
  assert.equal(getLifeFacts({ status: "active" }).length, 2);

  applyLifeActions([{ type: "upsertLifeFact", fact: { text: "Va al gimnasio 5 veces por semana", category: "salud", replaces: a.id } }]);
  const active = getLifeFacts({ status: "active" }).map((x) => x.text).sort();
  assert.deepEqual(active, ["Hace terapia los martes", "Va al gimnasio 5 veces por semana"]);
});

test("no cierra búsquedas abiertas después de empezar la etapa", () => {
  localStorage.clear();
  upsertLifeFact({ text: "Trabaja en Empresa A", category: "trabajo", since: daysAgo(200) });
  openThread({ topic: "Buscando un trabajo mejor", openedAt: daysAgo(10) });
  reconcileThreadsWithFacts();
  assert.equal(getOpenThreads({ status: "open" }).length, 1);
});

test("los prompts incluyen ids y área", () => {
  localStorage.clear();
  const f = upsertLifeFact({ text: "Trabaja en Empresa B", category: "trabajo" });
  const t = openThread({ topic: "Entrevista el jueves" });
  assert.ok(buildLifeFactsPromptBlock("hola").blockText.includes(`id=${f.id}`));
  const threadsBlock = buildOpenThreadsPromptBlock().blockText;
  assert.ok(threadsBlock.includes(`id=${t.id}`));
  assert.ok(threadsBlock.includes("TRABAJO"));
});

test("inferArea deduce el área de textos libres", () => {
  assert.equal(inferArea("Buscando chamba"), "trabajo");
  assert.equal(inferArea("Mudanza al nuevo depa"), "vivienda");
  assert.equal(inferArea("algo sin pistas"), "otro");
});

test("reconfirmar un hecho igual no genera aviso", () => {
  localStorage.clear();
  const f = upsertLifeFact({ text: "Trabaja en Empresa B", category: "trabajo", source: "user_said" });
  const changes = applyLifeActions([{ type: "upsertLifeFact", fact: { id: f.id, text: "Trabaja en Empresa B", category: "trabajo" } }]);
  assert.equal(changes.length, 0);
});

test("cada cambio guardado lleva updatedAt", () => {
  localStorage.clear();
  const f = upsertLifeFact({ text: "Vive en Lima", category: "vivienda" });
  const stored = JSON.parse(localStorage.getItem(LIFE_FACTS_KEY));
  assert.ok(stored.find((x) => x.id === f.id).updatedAt);
});

test("una copia vieja de la nube no borra lo guardado en el teléfono", () => {
  const cloud = [
    { id: "t1", topic: "Buscando trabajo", status: "open", updatedAt: "2026-09-01T00:00:00.000Z" },
    { id: "t2", topic: "Solo en la nube", status: "open", updatedAt: "2026-09-01T00:00:00.000Z" },
  ];
  const local = [
    { id: "t1", topic: "Buscando trabajo", status: "resolved", updatedAt: "2026-10-30T00:00:00.000Z" },
    { id: "t3", topic: "Nuevo en el teléfono", status: "open", updatedAt: "2026-10-30T00:00:00.000Z" },
  ];
  const merged = mergeLifeLists(local, cloud);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((x) => x.id === "t1").status, "resolved");
  // Si la nube es más reciente, gana la nube
  const newer = mergeLifeLists([{ id: "a", v: 1, updatedAt: "2026-01-01" }], [{ id: "a", v: 2, updatedAt: "2026-02-01" }]);
  assert.equal(newer[0].v, 2);
});

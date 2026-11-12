import test from "node:test";
import assert from "node:assert/strict";

import { stem, searchMemories, searchNeurons, memoryTimeline, readMemory, snippetAround } from "../src/memory/lifeSearch.js";
import { runCarlTool, CARL_TOOLS, describeToolCall } from "../src/chat/carlTools.js";

const mem = (id, date, title, text, extra = {}) => ({ id, date, title, text, tags: [], emotion: "neutral", linkedNeurons: [], ...extra });
const memories = [
  mem("m1", "2023-03-10", "Entrevista", "Hoy tuve la entrevista en la tienda de Lucas. Estaba muy nervioso pero salió bien.", { linkedNeurons: ["n_lucas"] }),
  mem("m2", "2023-08-02", "Cansancio", "Dormí poco, estoy cansado todo el día. El trabajo me agota.", { tags: ["trabajo"] }),
  mem("m3", "2024-01-15", "Deudas", "Pagué parte de la deuda con Marta. Todavía queda el préstamo.", { emotion: "fear" }),
  mem("m4", "2024-02-20", "Trabajo nuevo", "Empecé a trabajar en otra empresa. Me siento con energía.", { tags: ["trabajo"] }),
];
const neurons = [
  { id: "n_lucas", core: { concept: "Lucas", domain: "relationships", summary: "Amigo con una tienda" }, triggers: ["lucas", "tienda"], connections: ["n_trab"] },
  { id: "n_trab", core: { concept: "Trabajo en la tienda", domain: "work", summary: "Etapa trabajando con Lucas" }, triggers: ["tienda", "trabajo"], connections: ["n_lucas"], temporal: { isPast: true } },
  { id: "n_deuda", core: { concept: "Deudas", domain: "finance", summary: "Préstamos pendientes" }, triggers: ["deuda", "préstamo"], connections: [] },
];

test("raíces: variantes de la misma palabra coinciden", () => {
  assert.equal(stem("cansado"), stem("cansancio"));
  assert.equal(stem("cansada"), stem("cansado"));
  assert.equal(stem("trabajo"), stem("trabajando"));
  assert.equal(stem("hijo"), stem("hijos"));
  assert.equal(stem("deudas"), stem("deuda"));
});

test("buscar memorias: por palabras con raíz, acentos y fechas", () => {
  const r = searchMemories(memories, { query: "cansancio" });
  assert.equal(r[0].id, "m2", "'cansancio' encuentra 'cansado'");
  assert.equal(searchMemories(memories, { query: "prestamo" })[0].id, "m3", "sin acento también");
  const ranged = searchMemories(memories, { query: "trabajo", from: "2024-01-01" });
  assert.deepEqual(ranged.map((x) => x.id), ["m4"]);
  assert.deepEqual(searchMemories(memories, { query: "deuda", to: "2024-01" }).map((x) => x.id), ["m3"], "hasta un mes incluye todo ese mes");
  assert.deepEqual(searchMemories(memories, { query: "trabajo", from: "2024", to: "2024" }).map((x) => x.id), ["m4"], "límites por año");
  const noQuery = searchMemories(memories, { from: "2024-01-01" });
  assert.deepEqual(noQuery.map((x) => x.id), ["m4", "m3"], "sin consulta: las del rango, recientes primero");
  assert.deepEqual(searchMemories(memories, { query: "entrevista" }, neurons)[0].neurons, ["Lucas"]);
  assert.equal(searchMemories(memories, { query: "playa vacaciones" }).length, 0);
});

test("fragmento alrededor de lo buscado", () => {
  const long = `${"relleno ".repeat(80)}aquí aparece la palabra préstamo importante ${"más ".repeat(80)}`;
  const snip = snippetAround(long, "préstamo", 120);
  assert.ok(snip.includes("préstamo") && snip.startsWith("…"));
});

test("neuronas con sus conexiones y línea de tiempo", () => {
  const n = searchNeurons(neurons, { query: "tienda" });
  assert.equal(n.length, 2);
  assert.ok(n.find((x) => x.id === "n_trab").past);
  assert.deepEqual(n.find((x) => x.id === "n_lucas").connectedTo, ["Trabajo en la tienda"]);
  const tl = memoryTimeline(memories, { query: "trabajo", by: "year" });
  assert.deepEqual(tl.map((b) => [b.period, b.count]), [["2023", 1], ["2024", 1]]);
  assert.equal(readMemory(memories, "m3").title, "Deudas");
  assert.equal(readMemory(memories, "nope"), null);
});

test("herramientas de Carl: esquema, ejecución y resumen", () => {
  assert.deepEqual(CARL_TOOLS.map((t) => t.name), ["buscar_memorias", "leer_memoria", "buscar_neuronas", "linea_de_tiempo"]);
  for (const t of CARL_TOOLS) assert.equal(t.input_schema.type, "object");
  const out = runCarlTool("buscar_memorias", { consulta: "deuda", limite: 50 }, { memories, neurons });
  const parsed = JSON.parse(out.content);
  assert.equal(parsed.resultados[0].id, "m3");
  assert.equal(out.summary.count, 1);
  assert.deepEqual(out.summary.ids, ["m3"]);
  const none = JSON.parse(runCarlTool("buscar_memorias", { consulta: "zzz" }, { memories }).content);
  assert.ok(none.nota);
  const tl = JSON.parse(runCarlTool("linea_de_tiempo", { tema: "trabajo", agrupar: "year", desde: "no-es-fecha" }, { memories }).content);
  assert.equal(tl.total, 2, "una fecha inválida se ignora");
  const bad = runCarlTool("otra", {}, {});
  assert.ok(bad.isError);
  assert.match(describeToolCall("buscar_memorias", { consulta: "x", desde: "2023-01-01" }), /“x” \(2023-01-01\)/);
});

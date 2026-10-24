import assert from "node:assert";

const memoryStorage = {};
global.localStorage = {
  getItem: (key) => memoryStorage[key] || null,
  setItem: (key, val) => { memoryStorage[key] = String(val); },
  removeItem: (key) => { delete memoryStorage[key]; },
  clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
};
global.window = global;

// Mock dayStore data via localStorage
const testDays = [
  {
    id: "day_1",
    date: "2026-03-01",
    summary: "Día tranquilo de lectura y caminata por el parque.",
    dominantEmotion: "joy",
    dominantThemes: ["lectura", "descanso"],
  },
  {
    id: "day_2",
    date: "2026-02-28",
    summary: "Trabajo en proyecto personal de software.",
    dominantEmotion: "neutral",
    dominantThemes: ["proyectos"],
  },
];
localStorage.setItem("memorycarl_days_v1", JSON.stringify(testDays));

import {
  buildRecentDaysPromptBlock,
  getContinuityPromptStats,
} from "../src/chat/recentContext.js";

import { upsertLifeFact } from "../src/chat/lifeFacts.js";
import { openThread } from "../src/chat/openThreads.js";

console.log("=== Corriendo pruebas de recentContext.js y métricas de 4 capas ===");

// 1. Inyectar un hecho y un hilo para verificar las 4 capas
upsertLifeFact({ text: "Trabaja en desarrollo de software", category: "trabajo" });
openThread({ topic: "Revisión de métricas" });

const block = buildRecentDaysPromptBlock({ limitDays: 2 });
assert.ok(block.blockText.includes("ÚLTIMOS DÍAS"));
assert.ok(block.blockText.includes("2026-03-01"));
assert.ok(block.blockText.includes("Día tranquilo de lectura"));
assert.strictEqual(block.dayCount, 2);

// 2. Probar resumen unificado de caracteres por capa
const stats = getContinuityPromptStats("hola carl", [
  { core: { concept: "Programación", domain: "work", summary: "Gusto por el código" } },
]);

assert.ok(stats.layers.capa1_hechosVigentes.chars > 0);
assert.ok(stats.layers.capa2_hilosAbiertos.chars > 0);
assert.ok(stats.layers.capa3_diasRecientes.chars > 0);
assert.ok(stats.layers.capa4_neuronasYMemorias.chars > 0);

assert.ok(stats.totalChars > 100);

console.log("Stats de capas en prompt:", JSON.stringify(stats.layers, null, 2));
console.log("✅ Pruebas de recentContext.js y métricas de 4 capas completadas con éxito.");

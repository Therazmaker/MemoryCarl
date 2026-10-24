import assert from "node:assert";

const memoryStorage = {};
global.localStorage = {
  getItem: (key) => memoryStorage[key] || null,
  setItem: (key, val) => { memoryStorage[key] = String(val); },
  removeItem: (key) => { delete memoryStorage[key]; },
  clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
};
global.window = global;

import {
  OPEN_THREADS_KEY,
  openThread,
  resolveThread,
  deleteThread,
  getOpenThreads,
  buildOpenThreadsPromptBlock,
  hasPressuringTone,
} from "../src/chat/openThreads.js";

console.log("=== Corriendo pruebas de openThreads.js y guardia de tono ===");

localStorage.clear();

// 1. Abrir e hilos
const t1 = openThread({ topic: "Buscando trabajo", note: "en LinkedIn" });
assert.ok(t1);
assert.strictEqual(t1.topic, "Buscando trabajo");
assert.strictEqual(t1.status, "open");

const activeList1 = getOpenThreads({ status: "open" });
assert.strictEqual(activeList1.length, 1);

// 2. Resolver hilo
resolveThread("Buscando trabajo");
const activeList2 = getOpenThreads({ status: "open" });
assert.strictEqual(activeList2.length, 0);

const resolvedList = getOpenThreads({ status: "resolved" });
assert.strictEqual(resolvedList.length, 1);

// 3. Hilo vencido y formateo de prompt
localStorage.clear();
openThread({ topic: "Entrevista de trabajo", dueDate: "2020-01-01" });
openThread({ topic: "Esperando respuesta de cliente", dueDate: "2026-12-31" });

const promptBlock = buildOpenThreadsPromptBlock();
assert.ok(promptBlock.blockText.includes("HILOS ABIERTOS"));
assert.ok(promptBlock.blockText.includes("tenía fecha tope 2020-01-01 (ya pasó, sin resolver)"));
assert.strictEqual(promptBlock.hasOverdueThread, true);

// 4. Detección de tono de presión
assert.strictEqual(hasPressuringTone("Deberías responder la entrevista de una vez"), true);
assert.strictEqual(hasPressuringTone("No has hecho la tarea que tenías pendiente"), true);
assert.strictEqual(hasPressuringTone("Ya es hora de que busques empleo"), true);
assert.strictEqual(hasPressuringTone("Tienes que llamar al médico hoy"), true);

assert.strictEqual(hasPressuringTone("¿Cómo te fue en la entrevista que tenías pendiente?"), false);
assert.strictEqual(hasPressuringTone("Cuéntame si necesitas ayuda con algo hoy"), false);

console.log("✅ Pruebas de openThreads.js y guardia de tono completadas con éxito.");

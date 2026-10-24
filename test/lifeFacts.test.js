import assert from "node:assert";
import {
  LIFE_FACTS_KEY,
  VALID_CATEGORIES,
  calculateDurationString,
  sanitizeLifeFact,
  loadLifeFacts,
  saveLifeFacts,
  upsertLifeFact,
  endLifeFact,
  confirmPendingLifeFact,
  discardPendingLifeFact,
  getLifeFacts,
  matchesCategoryKeywords,
  buildLifeFactsPromptBlock,
  getLastInjectedSituationBlock,
} from "../src/chat/lifeFacts.js";

// Mock localStorage for Node test environment
const memoryStorage = {};
global.localStorage = {
  getItem: (key) => memoryStorage[key] || null,
  setItem: (key, val) => { memoryStorage[key] = String(val); },
  removeItem: (key) => { delete memoryStorage[key]; },
  clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
};

console.log("=== Corriendo pruebas de lifeFacts.js ===");

// 1. Duraciones formateadas
const dToday = calculateDurationString(new Date().toISOString().split("T")[0]);
assert.ok(dToday.includes("desde hoy"));

const date3WeeksAgo = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().split("T")[0];
const d3Weeks = calculateDurationString(date3WeeksAgo);
assert.ok(d3Weeks.includes("desde hace 3 semanas"));

// 2. Sanitización y validación
const invalidFact = sanitizeLifeFact({ text: "" });
assert.strictEqual(invalidFact, null);

const validFact = sanitizeLifeFact({ text: "Dejó su trabajo", category: "trabajo", since: "2026-01-01" });
assert.ok(validFact);
assert.strictEqual(validFact.category, "trabajo");
assert.strictEqual(validFact.status, "active");

// 3. Upsert y contradicciones
localStorage.clear();
const f1 = upsertLifeFact({ text: "Está desempleado", category: "trabajo", since: "2026-02-01" });
assert.strictEqual(f1.status, "active");

const activeFacts1 = getLifeFacts({ status: "active" });
assert.strictEqual(activeFacts1.length, 1);

// Usuario dice "conseguí trabajo nuevo"
const f2 = upsertLifeFact({ text: "Trabaja como desarrollador", category: "trabajo", since: new Date().toISOString().split("T")[0] });
assert.strictEqual(f2.status, "active");

// El hecho anterior f1 debe haber pasado a ended
const allFacts = getLifeFacts({ status: "all" });
assert.strictEqual(allFacts.length, 2);
const endedF1 = allFacts.find((f) => f.text === "Está desempleado");
assert.strictEqual(endedF1.status, "ended");
assert.ok(endedF1.until);

// 4. Finalización explícita
endLifeFact("desarrollador");
const activeFacts2 = getLifeFacts({ status: "active" });
assert.strictEqual(activeFacts2.length, 0);

// 5. Disparadores condicionales (salud y dinero)
assert.strictEqual(matchesCategoryKeywords("tengo mucha ansiedad hoy", "salud"), true);
assert.strictEqual(matchesCategoryKeywords("hola como estás", "salud"), false);
assert.strictEqual(matchesCategoryKeywords("cuánto dinero me queda en el banco", "dinero"), true);

// 6. Armado del bloque [SITUACIÓN ACTUAL]
localStorage.clear();
upsertLifeFact({ text: "Vive en Lima", category: "vivienda" });
upsertLifeFact({ text: "Tiene una deuda con el banco", category: "dinero" });

// Sin palabras clave de dinero -> no debe incluir la deuda
const block1 = buildLifeFactsPromptBlock("hola carl cómo estás");
assert.ok(block1.blockText.includes("VIVIENDA"));
assert.ok(!block1.blockText.includes("DINERO"));

// Con palabra clave de dinero -> sí incluye la deuda
const block2 = buildLifeFactsPromptBlock("estoy preocupado por mi deuda");
assert.ok(block2.blockText.includes("DINERO"));

// Comprobar estadísticas de caracteres
const stats = getLastInjectedSituationBlock();
assert.strictEqual(stats.factCount, 2);
assert.ok(stats.charCount > 50);

console.log("✅ Todas las pruebas de lifeFacts.js pasaron correctamente.");

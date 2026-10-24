import assert from "node:assert";

const memoryStorage = {};
global.localStorage = {
  getItem: (key) => memoryStorage[key] || null,
  setItem: (key, val) => { memoryStorage[key] = String(val); },
  removeItem: (key) => { delete memoryStorage[key]; },
  clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
};
global.window = global;

const {
  LIFE_FACTS_KEY,
  loadLifeFacts,
  upsertLifeFact,
  getLifeFacts,
  buildLifeFactsPromptBlock,
  getLastInjectedSituationBlock,
  endLifeFact,
  calculateDurationString,
} = await import("../src/chat/lifeFacts.js");

console.log("=== Corriendo pruebas de aceptación para Fase 1 (lifeFacts.js) ===");

localStorage.clear();

// 1. Decir "hoy renuncié a mi trabajo". Se crea hecho de trabajo con since=hoy.
const todayStr = new Date().toISOString().split("T")[0];
const fact1 = upsertLifeFact({
  text: "Renunció a su trabajo y no tiene empleo",
  category: "trabajo",
  since: todayStr,
  source: "user_said",
});

assert.ok(fact1);
assert.strictEqual(fact1.category, "trabajo");
assert.strictEqual(fact1.since, todayStr);
assert.strictEqual(fact1.status, "active");

const factsActive1 = getLifeFacts({ status: "active" });
assert.strictEqual(factsActive1.length, 1);
assert.strictEqual(factsActive1[0].text, "Renunció a su trabajo y no tiene empleo");

// 2. Al día siguiente decir "hola": se inyecta en el bloque [SITUACIÓN ACTUAL], pero el modelo lo tiene de fondo.
const blockHola = buildLifeFactsPromptBlock("hola");
assert.ok(blockHola.blockText.includes("SITUACIÓN ACTUAL"));
assert.ok(blockHola.blockText.includes("Renunció a su trabajo"));

// 3. Decir "estoy ansioso con la plata": activa disparador de dinero y mantiene el hecho de trabajo.
const blockDinero = buildLifeFactsPromptBlock("estoy ansioso con la plata");
assert.ok(blockDinero.blockText.includes("TRABAJO"));

// 4. Decir "ya conseguí trabajo": el hecho viejo pasa a status 'ended' con until=hoy, nace el nuevo hecho de trabajo activo.
const fact2 = upsertLifeFact({
  text: "Consegui trabajo nuevo",
  category: "trabajo",
  since: todayStr,
  source: "user_said",
});

assert.ok(fact2);
assert.strictEqual(fact2.status, "active");

const allFactsAfterChange = getLifeFacts({ status: "all" });
assert.strictEqual(allFactsAfterChange.length, 2);

const oldFact = allFactsAfterChange.find((f) => f.id === fact1.id);
assert.strictEqual(oldFact.status, "ended");
assert.strictEqual(oldFact.until, todayStr);

const newFact = allFactsAfterChange.find((f) => f.id === fact2.id);
assert.strictEqual(newFact.status, "active");

// 5. El bloque inyectado refleja solo los hechos vigentes activos
const blockFinal = buildLifeFactsPromptBlock("hola carl");
assert.ok(blockFinal.blockText.includes("Consegui trabajo nuevo"));
assert.ok(!blockFinal.blockText.includes("Renunció a su trabajo"));

// 6. Verificar helper de consola global
assert.ok(Array.isArray(window.__getLifeFacts()));
const lastInjected = window.__getLastInjectedSituationBlock();
assert.ok(lastInjected.charCount > 0);

console.log("✅ Pruebas de aceptación para Fase 1 completadas con éxito.");

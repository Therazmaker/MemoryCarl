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
  renderNowTab,
} from "../src/chat/neurochat-ui.js";

import {
  upsertLifeFact,
  getLifeFacts,
} from "../src/chat/lifeFacts.js";

console.log("=== Corriendo pruebas de la pestaña 🧭 Ahora (neurochat-ui.js) ===");

localStorage.clear();

// Crear hechos de prueba (uno pendiente y uno activo)
upsertLifeFact({
  text: "¿Te quedaste sin empleo?",
  category: "trabajo",
  pendingConfirm: true,
  source: "model_proposed",
});

upsertLifeFact({
  text: "Vive en departamento propio",
  category: "vivienda",
  since: "2025-01-01",
  source: "user_said",
});

const html = renderNowTab();

assert.ok(html.includes("Situación Actual & Hechos Vigentes"));
assert.ok(html.includes("Hechos propuestos por Carl para revalidar"));
assert.ok(html.includes("¿Te quedaste sin empleo?"));
assert.ok(html.includes("Vive en departamento propio"));
assert.ok(html.includes("Confirmar"));
assert.ok(html.includes("Descartar"));

console.log("✅ Pruebas de la pestaña 🧭 Ahora completadas correctamente.");

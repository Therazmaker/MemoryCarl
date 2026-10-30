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

assert.ok(html.includes("Tu momento"));
assert.ok(html.includes("Carl cree que"));
assert.ok(html.includes("¿Te quedaste sin empleo?"));
assert.ok(html.includes("Vive en departamento propio"));
assert.ok(html.includes("Sí, es así"));
assert.ok(html.includes("Línea de vida"));

// Una etapa terminada aparece en la línea de vida con su rango de fechas
upsertLifeFact({ text: "Vive con sus padres", category: "vivienda", since: "2024-01-01" });
const html2 = renderNowTab();
assert.ok(html2.includes("Vive con sus padres"));
assert.ok(html2.includes("Sigue vigente"));
assert.strictEqual(getLifeFacts({ status: "active" }).length, 1);

console.log("✅ Pruebas de la pestaña 🧭 Ahora completadas correctamente.");

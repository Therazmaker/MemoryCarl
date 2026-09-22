/**
 * mealBundles.js — Motor de Agrupación de Comidas y Porciones Caseras para MemoryCarl
 * Transforma tickets de compras o ingredientes en "Comidas Completas" con contador de porciones,
 * calcula el costo real fraccional por plato y compara el ahorro frente a comer en la calle.
 */

export const MEAL_BUNDLE_LS_KEY = "memorycarl_meal_bundles_v1";

export const DEFAULT_STREET_COSTS = {
  desayuno: 8.00,  // Costo promedio desayuno en la calle en Soles
  almuerzo: 15.00, // Menú ejecutivo típico
  cena: 12.00,
  snack: 5.00
};

/**
 * Carga los meal bundles guardados en localStorage.
 */
export function loadMealBundles() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MEAL_BUNDLE_LS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Guarda los meal bundles en localStorage.
 */
export function saveMealBundles(bundles) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MEAL_BUNDLE_LS_KEY, JSON.stringify(bundles));
  } catch (_e) {}
}

/**
 * Crea o registra un nuevo Meal Bundle (ej. "Pollo con Arroz para 4 días").
 * @param {object} params
 * @param {string} params.name - Nombre de la comida (ej. "Almuerzo: Pollo con Arroz y Plátano")
 * @param {string} params.mealType - 'desayuno' | 'almuerzo' | 'cena' | 'snack'
 * @param {number} params.totalCost - Costo total en Soles de los ingredientes usados
 * @param {number} params.portions - Cuántos platos rinde (default: 4)
 * @param {Array<{name: string, qty?: number, unit?: string, cost?: number}>} params.ingredients - Lista de ingredientes
 * @param {string} [params.notes] - Notas adicionales
 */
export function createMealBundle({
  name,
  mealType = "almuerzo",
  totalCost,
  portions = 4,
  ingredients = [],
  notes = ""
}) {
  const bundles = loadMealBundles();
  const cleanPortions = Math.max(1, Number(portions) || 1);
  const cleanCost = Math.max(0, Number(totalCost) || 0);
  const costPerPortion = Number((cleanCost / cleanPortions).toFixed(2));
  const streetReference = DEFAULT_STREET_COSTS[mealType] || 15.00;
  const savingsPerPortion = Math.max(0, Number((streetReference - costPerPortion).toFixed(2)));

  const newBundle = {
    id: `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || "Comida Casera").trim(),
    mealType,
    totalCost: cleanCost,
    portionsTotal: cleanPortions,
    portionsRemaining: cleanPortions,
    costPerPortion,
    streetReferenceCost: streetReference,
    savingsPerPortion,
    ingredients: Array.isArray(ingredients) ? ingredients : [],
    createdAt: new Date().toISOString(),
    lastConsumedAt: null,
    status: "active", // active | completed
    notes: String(notes || "").trim()
  };

  bundles.unshift(newBundle);
  saveMealBundles(bundles);
  return newBundle;
}

/**
 * Registra que se consumió una porción de un Meal Bundle.
 * Descuenta 1 porción del inventario de comida casera y actualiza fecha.
 * @returns {{ bundle: object|null, savingsToday: number, remaining: number }}
 */
export function consumeMealPortion(bundleId) {
  const bundles = loadMealBundles();
  const bundle = bundles.find(b => b.id === bundleId);
  if (!bundle || bundle.portionsRemaining <= 0) {
    return { bundle: null, savingsToday: 0, remaining: 0 };
  }

  bundle.portionsRemaining = Math.max(0, bundle.portionsRemaining - 1);
  bundle.lastConsumedAt = new Date().toISOString();

  if (bundle.portionsRemaining === 0) {
    bundle.status = "completed";
  }

  saveMealBundles(bundles);
  return {
    bundle,
    savingsToday: bundle.savingsPerPortion,
    remaining: bundle.portionsRemaining
  };
}

/**
 * Obtiene el resumen de comidas caseras disponibles actualmente en casa.
 * Utilizado por el Daily Flow y Ollama para saber qué hay listo.
 */
export function getActiveMealInventory() {
  const bundles = loadMealBundles().filter(b => b.status === "active" && b.portionsRemaining > 0);
  
  const summary = {
    totalActiveBundles: bundles.length,
    byMealType: {
      desayuno: { portions: 0, items: [] },
      almuerzo: { portions: 0, items: [] },
      cena: { portions: 0, items: [] },
      snack: { portions: 0, items: [] }
    },
    totalPortionsAvailable: 0,
    totalPotentialSavings: 0
  };

  bundles.forEach(b => {
    const type = summary.byMealType[b.mealType] ? b.mealType : "almuerzo";
    summary.byMealType[type].portions += b.portionsRemaining;
    summary.byMealType[type].items.push({
      id: b.id,
      name: b.name,
      portionsRemaining: b.portionsRemaining,
      costPerPortion: b.costPerPortion,
      savingsPerPortion: b.savingsPerPortion
    });
    summary.totalPortionsAvailable += b.portionsRemaining;
    summary.totalPotentialSavings += (b.savingsPerPortion * b.portionsRemaining);
  });

  summary.totalPotentialSavings = Number(summary.totalPotentialSavings.toFixed(2));
  return summary;
}

/**
 * Formatea el inventario de comidas caseras para el prompt de Ollama.
 */
export function formatMealInventoryForAiPrompt() {
  const inv = getActiveMealInventory();
  if (inv.totalPortionsAvailable === 0) {
    return "  (No hay comidas caseras preparadas actualmente en casa. Se requerirá cocinar o comprar fuera)";
  }

  const lines = [];
  Object.entries(inv.byMealType).forEach(([type, data]) => {
    if (data.portions > 0) {
      const itemsStr = data.items.map(i => `${i.name} (${i.portionsRemaining} porción/es a S/ ${i.costPerPortion.toFixed(2)})`).join(", ");
      lines.push(`  - ${type.toUpperCase()}: ${data.portions} porción(es) disponible(s) [${itemsStr}]`);
    }
  });

  lines.push(`  * Ahorro total acumulable si se consumen estas porciones en vez de comer en la calle: S/ ${inv.totalPotentialSavings.toFixed(2)}`);
  return lines.join("\n");
}

/**
 * Actualiza un meal bundle existente.
 */
export function updateMealBundle(bundleId, patch) {
  const bundles = loadMealBundles();
  const idx = bundles.findIndex(b => b.id === bundleId);
  if (idx === -1) return null;
  const current = bundles[idx];
  const next = { ...current, ...patch };

  if (patch.portionsTotal !== undefined || patch.totalCost !== undefined) {
    const totalCost = Number(next.totalCost) || 0;
    const portionsTotal = Math.max(1, Number(next.portionsTotal) || 1);
    next.costPerPortion = Number((totalCost / portionsTotal).toFixed(2));
    const street = DEFAULT_STREET_COSTS[next.mealType] || 15.00;
    next.savingsPerPortion = Math.max(0, Number((street - next.costPerPortion).toFixed(2)));
  }

  if (next.portionsRemaining <= 0) next.status = "completed";
  else if (next.status === "completed" && next.portionsRemaining > 0) next.status = "active";

  bundles[idx] = next;
  saveMealBundles(bundles);
  return next;
}

/**
 * Elimina un meal bundle.
 */
export function deleteMealBundle(bundleId) {
  const bundles = loadMealBundles().filter(b => b.id !== bundleId);
  saveMealBundles(bundles);
  return true;
}

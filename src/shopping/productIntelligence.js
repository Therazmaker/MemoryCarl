/**
 * productIntelligence.js — Metadatos y utilidades inteligentes para productos en MemoryCarl
 * Soporta evaluación hedónica (satisfacción vs costo), contexto de consumo y seguimiento de último consumo.
 */

export const PRODUCT_TIERS = {
  BASE: "base_diario",       // Consumo cotidiano de rutina (ej. Volt, Pan, Arroz)
  GUSTO: "gusto_medio",      // Gusto intermedio (ej. Pepsi, Empanada)
  PREMIUM: "premio_premium"  // Recompensa especial cuando hay holgura (ej. Monster, Menú especial)
};

export const PRODUCT_CONTEXTS = {
  OFICINA: "oficina",
  CASA_DESAYUNO: "desayuno_casa",
  CASA_ALMUERZO: "almuerzo_casa",
  CASA_CENA: "cena_casa",
  CALLE_RAPIDA: "calle_rapida"
};

/**
 * Normaliza y garantiza que un producto tenga los campos de inteligencia IA.
 * Si no los tiene, deduce valores por defecto razonables según categoría o nombre.
 */
export function enrichProductData(p) {
  if (!p || typeof p !== "object") return p;

  const name = String(p.name || "").toLowerCase();
  const cat = String(p.category || "").toLowerCase();

  // Deducción inteligente inicial si no están definidos
  let defaultTier = PRODUCT_TIERS.BASE;
  let defaultContext = PRODUCT_CONTEXTS.CASA_ALMUERZO;
  let defaultRating = 3; // 1 a 5

  if (name.includes("monster") || name.includes("red bull")) {
    defaultTier = PRODUCT_TIERS.PREMIUM;
    defaultRating = 5;
    defaultContext = PRODUCT_CONTEXTS.OFICINA;
  } else if (name.includes("volt") || name.includes("café") || name.includes("cafe")) {
    defaultTier = PRODUCT_TIERS.BASE;
    defaultRating = 3;
    defaultContext = PRODUCT_CONTEXTS.OFICINA;
  } else if (name.includes("pepsi") || name.includes("coca") || name.includes("gaseosa")) {
    defaultTier = PRODUCT_TIERS.GUSTO;
    defaultRating = 4;
    defaultContext = PRODUCT_CONTEXTS.OFICINA;
  } else if (name.includes("empanada") || name.includes("perro") || name.includes("bomba") || name.includes("keke")) {
    defaultTier = PRODUCT_TIERS.GUSTO;
    defaultRating = 4;
    defaultContext = PRODUCT_CONTEXTS.CALLE_RAPIDA;
  } else if (name.includes("huevo") || name.includes("pan") || name.includes("platano") || name.includes("plátano")) {
    defaultTier = PRODUCT_TIERS.BASE;
    defaultRating = 3;
    defaultContext = PRODUCT_CONTEXTS.CASA_DESAYUNO;
  }

  return {
    ...p,
    rating: Number(p.rating ?? defaultRating), // 1 a 5 estrellas
    tier: p.tier || defaultTier, // base_diario | gusto_medio | premio_premium
    context: p.context || defaultContext, // oficina | desayuno_casa | almuerzo_casa | cena_casa | calle_rapida
    substituteOf: Array.isArray(p.substituteOf) ? p.substituteOf : (p.substituteOf ? [p.substituteOf] : []),
    lastConsumedAt: p.lastConsumedAt || null, // ISO string 'YYYY-MM-DD'
    isIngredient: typeof p.isIngredient === "boolean" ? p.isIngredient : (cat.includes("mercado") || cat.includes("despensa") || cat.includes("cocina")),
  };
}

/**
 * Normaliza toda la lista de productos de state.products.
 */
export function enrichAllProducts(products = []) {
  if (!Array.isArray(products)) return [];
  return products.map(enrichProductData);
}

/**
 * Calcula cuántos días han pasado desde el último consumo de un producto.
 * Retorna null si nunca se ha registrado.
 */
export function getDaysSinceLastConsumed(product, now = new Date()) {
  if (!product?.lastConsumedAt) return null;
  const d = new Date(product.lastConsumedAt);
  if (isNaN(d.getTime())) return null;
  const diffMs = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Formato amigable para inyectar en el contexto de Ollama / LLM.
 */
export function formatProductForAiPrompt(p, now = new Date()) {
  const days = getDaysSinceLastConsumed(p, now);
  const daysText = days === null ? "sin registro reciente" : `consumido hace ${days} día(s)`;
  const stars = "★".repeat(Math.max(1, Math.min(5, p.rating || 3))) + "☆".repeat(5 - Math.max(1, Math.min(5, p.rating || 3)));
  return `- ${p.name} [S/ ${Number(p.price || 0).toFixed(2)} / ${p.unit || "u"}] | Gusto: ${stars} (${p.tier}) | Contexto: ${p.context} | Último consumo: ${daysText}`;
}

/**
 * lifeFacts.js — Almacén y orquestador de Hechos Vigentes (Capa 1 de NeuroChat)
 * MemoryCarl / NeuroChat
 *
 * Mantiene la memoria de situación de vida vigente del usuario (trabajo, vivienda,
 * dinero, salud, proyectos, relaciones) con fechas reales y duraciones calculadas por código.
 */

export const LIFE_FACTS_KEY = "memorycarl_life_facts";

export const VALID_CATEGORIES = [
  "trabajo",
  "dinero",
  "vivienda",
  "relaciones",
  "salud",
  "proyecto",
  "otro",
];

const SPANISH_MONTH_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export const KEYWORD_TRIGGERS = {
  dinero: [
    "plata", "dinero", "deuda", "pagar", "sueldo", "gasto", "banco", "comprar",
    "soles", "financier", "cuenta", "presupuesto", "gastado", "cobrar", "económ",
    "econom", "tarjeta", "préstamo", "prestamo", "costo", "caro", "barato",
  ],
  salud: [
    "dormir", "cansancio", "ansiedad", "médico", "medico", "dolor", "salud",
    "enfermo", "estrés", "estres", "cabeza", "pastilla", "remedio", "hospital",
    "clínica", "clinica", "psicól", "psicol", "sueño", "sueno", "físic",
    "fisic", "saludable", "agotad", "insomnio", "síntoma", "sintoma",
  ],
};

// Guarda las estadísticas del último bloque inyectado para consulta y depuración
let lastInjectedBlockStats = {
  blockText: "",
  charCount: 0,
  factCount: 0,
  details: [],
};

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function parseDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calcula la duración formateada en español desde una fecha 'YYYY-MM-DD' hasta hoy.
 * @param {string} sinceStr - Fecha en formato YYYY-MM-DD
 * @returns {string} Duración formateada, ej: "desde hace 3 semanas (2 oct)"
 */
export function calculateDurationString(sinceStr) {
  const sinceDate = parseDateStr(sinceStr);
  if (!sinceDate) return "fecha no especificada";

  const todayDate = parseDateStr(getTodayStr());
  const diffMs = todayDate.getTime() - sinceDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dayNum = sinceDate.getDate();
  const monthName = SPANISH_MONTH_SHORT[sinceDate.getMonth()];
  const yearNum = sinceDate.getFullYear();
  const currentYear = todayDate.getFullYear();

  const formattedDate = yearNum !== currentYear
    ? `${dayNum} ${monthName} ${yearNum}`
    : `${dayNum} ${monthName}`;

  if (diffDays <= 0) {
    return `desde hoy (${formattedDate})`;
  } else if (diffDays < 7) {
    return `desde hace ${diffDays} día${diffDays > 1 ? "s" : ""} (${formattedDate})`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `desde hace ${weeks} semana${weeks > 1 ? "s" : ""} (${formattedDate})`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `desde hace ${months} mes${months > 1 ? "es" : ""} (${formattedDate})`;
  } else {
    const years = Math.floor(diffDays / 365);
    return `desde hace ${years} año${years > 1 ? "s" : ""} (${formattedDate})`;
  }
}

/**
 * Carga todos los hechos de vida desde localStorage.
 * @returns {Array} Array de objetos facts
 */
export function loadLifeFacts() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LIFE_FACTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Guarda el array de hechos de vida en localStorage y notifica sync.
 * @param {Array} facts
 */
export function saveLifeFacts(facts) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LIFE_FACTS_KEY, JSON.stringify(facts));
    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase(false);
    }
  } catch (_e) {
    console.warn("[lifeFacts] Error guardando hechos en localStorage:", _e);
  }
}

/**
 * Sanitiza y valida un hecho de vida individual.
 * @param {object} fact
 * @returns {object|null} Fact verificado o null si no es válido
 */
export function sanitizeLifeFact(fact) {
  if (!fact || typeof fact !== "object") return null;

  const text = String(fact.text || "").trim();
  if (!text || text.length > 200) return null;

  const rawCategory = String(fact.category || "otro").toLowerCase().trim();
  const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : "otro";

  const status = fact.status === "ended" ? "ended" : "active";

  const todayStr = getTodayStr();
  const since = parseDateStr(fact.since) ? fact.since : todayStr;
  const until = status === "ended" ? (parseDateStr(fact.until) ? fact.until : todayStr) : null;
  const lastConfirmed = parseDateStr(fact.lastConfirmed) ? fact.lastConfirmed : todayStr;

  const allowedSources = ["user_said", "model_proposed", "day_entry"];
  const source = allowedSources.includes(fact.source) ? fact.source : "user_said";

  const id = fact.id || `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pendingConfirm = Boolean(fact.pendingConfirm);

  return {
    id,
    text,
    category,
    status,
    since,
    until,
    lastConfirmed,
    source,
    pendingConfirm,
  };
}

/**
 * Agrega o actualiza un hecho de vida vigente.
 * Si entra un nuevo hecho activo en una categoría que contradice o reemplaza un hecho anterior,
 * el hecho previo pasa a status "ended" con until = hoy.
 *
 * @param {object} factInput
 * @returns {object|null} hecho creado/actualizado
 */
export function upsertLifeFact(factInput) {
  const sanitized = sanitizeLifeFact(factInput);
  if (!sanitized) return null;

  const facts = loadLifeFacts();
  const todayStr = getTodayStr();

  // Buscar si ya existe por ID o texto idéntico/similar (case insensitive)
  const existingIdx = facts.findIndex(
    (f) => f.id === sanitized.id || f.text.toLowerCase() === sanitized.text.toLowerCase()
  );

  if (existingIdx !== -1) {
    // Si existía como pendiente y ahora viene confirmado, se actualiza
    facts[existingIdx] = {
      ...facts[existingIdx],
      ...sanitized,
      lastConfirmed: todayStr,
    };
    saveLifeFacts(facts);
    return facts[existingIdx];
  }

  // Manejo de contradicción / reemplazo en la misma categoría si es un nuevo hecho activo
  if (sanitized.status === "active" && !sanitized.pendingConfirm) {
    facts.forEach((existingFact) => {
      if (
        existingFact.category === sanitized.category &&
        existingFact.status === "active" &&
        !existingFact.pendingConfirm
      ) {
        // Finalizar el hecho antiguo para mantener historial
        existingFact.status = "ended";
        existingFact.until = todayStr;
      }
    });
  }

  facts.push(sanitized);
  saveLifeFacts(facts);
  return sanitized;
}

/**
 * Marca un hecho como finalizado (`status: "ended"`).
 * @param {string} idOrMatchText - ID exacto o fragmento de texto del hecho
 * @returns {boolean} true si se encontró y finalizó
 */
export function endLifeFact(idOrMatchText) {
  if (!idOrMatchText) return false;
  const matchStr = String(idOrMatchText).toLowerCase().trim();
  const facts = loadLifeFacts();
  const todayStr = getTodayStr();

  let found = false;
  facts.forEach((f) => {
    if (
      f.status === "active" &&
      (f.id === idOrMatchText || f.text.toLowerCase().includes(matchStr))
    ) {
      f.status = "ended";
      f.until = todayStr;
      found = true;
    }
  });

  if (found) {
    saveLifeFacts(facts);
  }
  return found;
}

/**
 * Confirma un hecho que estaba en `pendingConfirm`.
 * Pasa a `pendingConfirm: false`, `status: "active"`, `lastConfirmed: hoy`.
 * @param {string} id
 * @returns {object|null}
 */
export function confirmPendingLifeFact(id) {
  const facts = loadLifeFacts();
  const fact = facts.find((f) => f.id === id);
  if (!fact) return null;

  fact.pendingConfirm = false;
  fact.status = "active";
  fact.lastConfirmed = getTodayStr();

  // Finalizar otros hechos activos enfrentados en la misma categoría
  facts.forEach((f) => {
    if (f.id !== id && f.category === fact.category && f.status === "active" && !f.pendingConfirm) {
      f.status = "ended";
      f.until = getTodayStr();
    }
  });

  saveLifeFacts(facts);
  return fact;
}

/**
 * Descarta un hecho pendiente (lo elimina).
 * @param {string} id
 * @returns {boolean}
 */
export function discardPendingLifeFact(id) {
  const facts = loadLifeFacts();
  const idx = facts.findIndex((f) => f.id === id);
  if (idx === -1) return false;

  facts.splice(idx, 1);
  saveLifeFacts(facts);
  return true;
}

/**
 * Borra un hecho por su ID (activo o terminado).
 * @param {string} id
 * @returns {boolean}
 */
export function deleteLifeFact(id) {
  const facts = loadLifeFacts();
  const idx = facts.findIndex((f) => f.id === id);
  if (idx === -1) return false;

  facts.splice(idx, 1);
  saveLifeFacts(facts);
  return true;
}

/**
 * Evalúa si el mensaje del usuario contiene palabras clave de una categoría condicional.
 * @param {string} userInput
 * @param {string} category - "dinero" | "salud"
 * @returns {boolean}
 */
export function matchesCategoryKeywords(userInput = "", category) {
  const lower = String(userInput || "").toLowerCase();
  const keywords = KEYWORD_TRIGGERS[category] || [];
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Retorna la lista de hechos almacenados según filtros.
 * @param {object} options - { status: "active"|"ended"|"pending"|"all", category?: string }
 * @returns {Array}
 */
export function getLifeFacts(options = {}) {
  const facts = loadLifeFacts();
  let result = [...facts];

  if (options.status === "active") {
    result = result.filter((f) => f.status === "active" && !f.pendingConfirm);
  } else if (options.status === "pending") {
    result = result.filter((f) => f.pendingConfirm);
  } else if (options.status === "ended") {
    result = result.filter((f) => f.status === "ended");
  }

  if (options.category) {
    result = result.filter((f) => f.category === options.category);
  }

  return result;
}

/**
 * Construye el bloque de texto [SITUACIÓN ACTUAL] para inyección en el prompt de sistema del LLM.
 *
 * Reglas de inyección:
 * - Máximo ~12 hechos activos (ordenados por lastConfirmed descendente).
 * - hechos de salud y dinero solo se inyectan si el mensaje actual contiene palabras clave.
 * - trabajo, vivienda, relaciones, proyectos, otro se inyectan siempre.
 * - Hechos con 45+ días sin revalidar incluyen "(por revalidar)".
 * - No incluye facts en pendingConfirm (esos solo se muestran en UI).
 *
 * @param {string} userInput - Mensaje actual del usuario
 * @returns {{ blockText: string, charCount: number, factCount: number, details: Array }}
 */
export function buildLifeFactsPromptBlock(userInput = "") {
  const allFacts = loadLifeFacts();
  const todayStr = getTodayStr();
  const todayMs = parseDateStr(todayStr).getTime();

  // Filtrar activos confirmados
  const activeFacts = allFacts.filter((f) => f.status === "active" && !f.pendingConfirm);

  // Evaluar disparadores condicionales para dinero y salud
  const matchMoney = matchesCategoryKeywords(userInput, "dinero");
  const matchHealth = matchesCategoryKeywords(userInput, "salud");

  const filteredFacts = activeFacts.filter((fact) => {
    if (fact.category === "dinero") return matchMoney;
    if (fact.category === "salud") return matchHealth;
    return true; // trabajo, vivienda, relaciones, proyecto, otro -> SIEMPRE
  });

  // Ordenar por lastConfirmed más reciente
  filteredFacts.sort((a, b) => {
    const dA = parseDateStr(a.lastConfirmed)?.getTime() || 0;
    const dB = parseDateStr(b.lastConfirmed)?.getTime() || 0;
    return dB - dA;
  });

  // Limitar a máximo 12 hechos
  const selectedFacts = filteredFacts.slice(0, 12);

  if (selectedFacts.length === 0) {
    lastInjectedBlockStats = {
      blockText: "",
      charCount: 0,
      factCount: 0,
      details: [],
    };
    return lastInjectedBlockStats;
  }

  const factLines = selectedFacts.map((fact) => {
    const duration = calculateDurationString(fact.since);
    const lastConfMs = parseDateStr(fact.lastConfirmed)?.getTime() || todayMs;
    const daysUnconfirmed = Math.floor((todayMs - lastConfMs) / (1000 * 60 * 60 * 24));
    const revalidateTag = daysUnconfirmed >= 45 ? " [por revalidar]" : "";

    return `- [${fact.category.toUpperCase()}] ${fact.text} (${duration})${revalidateTag}`;
  });

  const blockText = `\n\n## SITUACIÓN ACTUAL (HECHOS VIGENTES DE SU VIDA)\nEsta es la situación real y vigente del usuario. Úsala como contexto de fondo. No la recites ni la menciones si no viene al caso. Si el mensaje la toca, respóndele con ella presente. Si el usuario dice algo que cambia un hecho, regístralo.\n${factLines.join("\n")}`;

  lastInjectedBlockStats = {
    blockText,
    charCount: blockText.length,
    factCount: selectedFacts.length,
    details: selectedFacts.map((f) => ({ id: f.id, text: f.text, category: f.category, since: f.since })),
  };

  return lastInjectedBlockStats;
}

/**
 * Retorna las estadísticas del último bloque inyectado para inspección en consola.
 */
export function getLastInjectedSituationBlock() {
  return lastInjectedBlockStats;
}

// Helper expuesto globalmente en window para inspección fácil por consola
if (typeof window !== "undefined") {
  window.__getLifeFacts = () => getLifeFacts({ status: "all" });
  window.__getLastInjectedSituationBlock = () => getLastInjectedSituationBlock();
}

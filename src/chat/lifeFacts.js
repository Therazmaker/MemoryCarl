/**
 * lifeFacts.js — Almacén y orquestador de Hechos Vigentes (Capa 1 de NeuroChat)
 * MemoryCarl / NeuroChat
 *
 * Mantiene la memoria de situación de vida vigente del usuario (trabajo, vivienda,
 * dinero, salud, proyectos, relaciones) con fechas reales y duraciones calculadas por código.
 */

import { todayLocalStr } from "./lifeDates.js";

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

/** Nombre e icono de cada área de vida (para la UI y los avisos) */
export const AREA_META = {
  trabajo:    { label: "Trabajo",    icon: "💼", color: "#60a5fa" },
  dinero:     { label: "Dinero",     icon: "💰", color: "#fbbf24" },
  vivienda:   { label: "Vivienda",   icon: "🏠", color: "#fb923c" },
  relaciones: { label: "Relaciones", icon: "❤️", color: "#f472b6" },
  salud:      { label: "Salud",      icon: "🩺", color: "#34d399" },
  proyecto:   { label: "Proyectos",  icon: "🚀", color: "#a78bfa" },
  otro:       { label: "Otros",      icon: "✨", color: "#94a3b8" },
};

/**
 * Áreas donde normalmente hay una sola situación vigente a la vez:
 * una etapa nueva reemplaza a la anterior si no se indica otra cosa.
 * En el resto (relaciones, salud, proyectos…) pueden convivir varias.
 */
export const EXCLUSIVE_CATEGORIES = ["trabajo", "vivienda"];

// Palabras que delatan el área de un texto libre (sin tildes, en minúsculas)
const AREA_KEYWORDS = {
  trabajo: ["trabaj", "emple", "chamba", "entrevista", "jefe", "oficina", "sueldo", "contrat", "renunci", "despid", "cv", "curriculum", "linkedin", "postul", "freelance", "cliente"],
  vivienda: ["casa", "depa", "departamento", "alquiler", "mudanz", "mudar", "cuarto", "vivienda", "inquilin", "hipoteca"],
  dinero: ["deuda", "dinero", "plata", "ahorr", "prestamo", "pagar", "banco", "tarjeta", "presupuesto", "soles"],
  salud: ["salud", "medic", "doctor", "dentist", "terapia", "psicolog", "dolor", "gym", "gimnasio", "dieta", "enferm", "ansiedad", "dormir", "examen"],
  relaciones: ["novi", "pareja", "esposa", "esposo", "amig", "familia", "mama", "papa", "herman", "hij", "relacion"],
  proyecto: ["proyecto", "app", "curso", "estudi", "aprender", "negocio", "emprend", "lanzar", "tesis"],
};

/** Quita tildes y pasa a minúsculas, para comparar textos. */
export function normalizeText(str = "") {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Deduce el área de vida de un texto libre. Devuelve "otro" si no hay pistas.
 * @param {string} text
 * @returns {string}
 */
export function inferArea(text = "") {
  const lower = normalizeText(text);
  if (!lower) return "otro";
  for (const [area, words] of Object.entries(AREA_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) return area;
  }
  return "otro";
}

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
  return todayLocalStr();
}

function copy(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

// Registra un cambio con su estado anterior y posterior, para poder deshacerlo
function recordChange(changes, kind, before, after) {
  if (!Array.isArray(changes)) return;
  changes.push({ store: "fact", kind, id: (after || before).id, before: copy(before), after: copy(after) });
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

  if (diffDays < 0) {
    return `a partir del ${formattedDate}`;
  } else if (diffDays === 0) {
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
 * Duración entre dos fechas YYYY-MM-DD en texto corto: "3 días", "2 semanas", "5 meses", "1 año".
 * @param {string} fromStr
 * @param {string} [toStr] - por defecto hoy
 * @returns {string}
 */
export function formatSpan(fromStr, toStr = getTodayStr()) {
  const from = parseDateStr(fromStr);
  const to = parseDateStr(toStr);
  if (!from || !to) return "";
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
  if (days === 0) return "menos de un día";
  if (days < 7) return `${days} día${days > 1 ? "s" : ""}`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} semana${w > 1 ? "s" : ""}`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} mes${m > 1 ? "es" : ""}`;
  }
  const y = Math.floor(days / 365);
  const rest = Math.floor((days % 365) / 30);
  return `${y} año${y > 1 ? "s" : ""}${rest ? ` y ${rest} mes${rest > 1 ? "es" : ""}` : ""}`;
}

/**
 * Fecha corta en español: "9 oct" o "9 oct 2025" si no es del año actual.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatShortDate(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${SPANISH_MONTH_SHORT[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
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
  const endNote = fact.endNote ? String(fact.endNote).trim().slice(0, 200) : "";

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
    ...(endNote ? { endNote } : {}),
  };
}

/**
 * Busca hechos por ID exacto o, si no hay ID, por texto (sin tildes ni mayúsculas).
 * @param {Array} facts
 * @param {string} idOrMatch
 * @param {(f: object) => boolean} [filter]
 * @returns {Array}
 */
function findFacts(facts, idOrMatch, filter = () => true) {
  if (!idOrMatch) return [];
  const byId = facts.filter((f) => f.id === idOrMatch && filter(f));
  if (byId.length) return byId;
  const match = normalizeText(idOrMatch);
  if (!match) return [];
  return facts.filter((f) => filter(f) && normalizeText(f.text).includes(match));
}

/**
 * Agrega o actualiza un hecho de vida (una "etapa").
 *
 * Reemplazo de etapas:
 * - `replaces` (id o texto, o lista) termina explícitamente esas etapas.
 * - Sin `replaces`, en áreas exclusivas (trabajo, vivienda) la etapa nueva termina
 *   a las activas de la misma área. En las demás áreas conviven.
 * La etapa reemplazada termina en la fecha de inicio de la nueva.
 *
 * @param {object} factInput
 * @param {{ changes?: Array }} [opts] - si se pasa `changes`, se registran los cambios (para deshacer)
 * @returns {object|null} hecho creado/actualizado
 */
export function upsertLifeFact(factInput, opts = {}) {
  const sanitized = sanitizeLifeFact(factInput);
  if (!sanitized) return null;

  const facts = loadLifeFacts();
  const todayStr = getTodayStr();

  // Buscar si ya existe por ID o texto idéntico (case insensitive)
  const existingIdx = facts.findIndex(
    (f) => f.id === sanitized.id || normalizeText(f.text) === normalizeText(sanitized.text)
  );

  if (existingIdx !== -1) {
    const before = copy(facts[existingIdx]);
    // Solo se pisan los campos que vienen en la entrada
    const patch = {};
    for (const key of ["text", "category", "status", "since", "until", "pendingConfirm", "source", "endNote"]) {
      if (factInput[key] !== undefined) patch[key] = sanitized[key];
    }
    if (patch.status === "active") patch.until = null;
    facts[existingIdx] = { ...facts[existingIdx], ...patch, lastConfirmed: todayStr };
    const after = facts[existingIdx];
    const kind = before.status === "active" && after.status === "ended" ? "fact_ended"
      : before.status === "ended" && after.status === "active" ? "fact_reactivated"
      : "fact_updated";
    recordChange(opts.changes, kind, before, after);
    saveLifeFacts(facts);
    return facts[existingIdx];
  }

  if (sanitized.status === "active" && !sanitized.pendingConfirm) {
    const isLive = (f) => f.status === "active" && !f.pendingConfirm;
    const replaces = [].concat(factInput.replaces || []).filter(Boolean);
    let toEnd = [];
    if (replaces.length) {
      toEnd = replaces.flatMap((r) => findFacts(facts, String(r), isLive));
    } else if (EXCLUSIVE_CATEGORIES.includes(sanitized.category)) {
      const sameArea = facts.filter((f) => isLive(f) && f.category === sanitized.category);
      const newer = sameArea.filter((f) => f.since > sanitized.since);
      if (newer.length) {
        // Etapa del pasado: queda terminada justo donde empieza la vigente
        sanitized.status = "ended";
        sanitized.until = newer.map((f) => f.since).sort()[0];
      } else {
        toEnd = sameArea;
      }
    }
    const until = sanitized.since <= todayStr ? sanitized.since : todayStr;
    for (const f of new Set(toEnd)) {
      const before = copy(f);
      f.status = "ended";
      f.until = until >= f.since ? until : todayStr;
      f.replacedBy = sanitized.id;
      recordChange(opts.changes, "fact_ended", before, f);
    }
  }

  facts.push(sanitized);
  recordChange(opts.changes, "fact_started", null, sanitized);
  saveLifeFacts(facts);
  return sanitized;
}

/**
 * Marca un hecho como finalizado (`status: "ended"`).
 * @param {string} idOrMatchText - ID exacto o fragmento de texto del hecho
 * @param {{ changes?: Array, until?: string, endNote?: string }} [opts]
 * @returns {boolean} true si se encontró y finalizó
 */
export function endLifeFact(idOrMatchText, opts = {}) {
  const facts = loadLifeFacts();
  const targets = findFacts(facts, idOrMatchText, (f) => f.status === "active");
  if (!targets.length) return false;

  const todayStr = getTodayStr();
  const until = parseDateStr(opts.until) && opts.until <= todayStr ? opts.until : todayStr;
  for (const f of targets) {
    const before = copy(f);
    f.status = "ended";
    f.until = until >= f.since ? until : todayStr;
    if (opts.endNote) f.endNote = String(opts.endNote).trim().slice(0, 200);
    recordChange(opts.changes, "fact_ended", before, f);
  }
  saveLifeFacts(facts);
  return true;
}

/**
 * Edita campos de un hecho existente (texto, área, fechas).
 * @param {string} id
 * @param {{ text?: string, category?: string, since?: string, until?: string }} patch
 * @param {{ changes?: Array }} [opts]
 * @returns {object|null}
 */
export function updateLifeFact(id, patch = {}, opts = {}) {
  const facts = loadLifeFacts();
  const idx = facts.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const before = copy(facts[idx]);
  const merged = sanitizeLifeFact({ ...facts[idx], ...patch, id });
  if (!merged) return null;
  facts[idx] = { ...facts[idx], ...merged, lastConfirmed: getTodayStr() };
  recordChange(opts.changes, "fact_updated", before, facts[idx]);
  saveLifeFacts(facts);
  return facts[idx];
}

/**
 * Vuelve a activar un hecho terminado.
 * @param {string} id
 * @param {{ changes?: Array }} [opts]
 * @returns {object|null}
 */
export function reactivateLifeFact(id, opts = {}) {
  const facts = loadLifeFacts();
  const fact = facts.find((f) => f.id === id);
  if (!fact) return null;
  const before = copy(fact);
  fact.status = "active";
  fact.until = null;
  delete fact.replacedBy;
  fact.lastConfirmed = getTodayStr();
  recordChange(opts.changes, "fact_reactivated", before, fact);
  saveLifeFacts(facts);
  return fact;
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

  // En áreas exclusivas, la etapa confirmada reemplaza a las activas de la misma área
  if (EXCLUSIVE_CATEGORIES.includes(fact.category)) {
    facts.forEach((f) => {
      if (f.id !== id && f.category === fact.category && f.status === "active" && !f.pendingConfirm) {
        f.status = "ended";
        f.until = getTodayStr();
        f.replacedBy = id;
      }
    });
  }

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

    return `- [${fact.category.toUpperCase()}] id=${fact.id} · ${fact.text} (${duration})${revalidateTag}`;
  });

  const blockText = `\n\n## SITUACIÓN ACTUAL (HECHOS VIGENTES DE SU VIDA)\nEsta es la situación real y vigente del usuario. Úsala como contexto de fondo. No la recites ni la menciones si no viene al caso. Si el mensaje la toca, respóndele con ella presente. Si el usuario dice algo que cambia o termina uno de estos hechos, usa su id en upsertLifeFact.replaces o en endLifeFact.\n${factLines.join("\n")}`;

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

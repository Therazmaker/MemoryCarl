/**
 * daySchemas.js — Esquemas y validación del Daily Memory Engine
 * MemoryCarl
 *
 * Exporta:
 *   createDay(date)
 *   validateDay(day)
 *   sanitizeDay(day)
 *   DAY_STATUSES
 *   VALID_EMOTIONS
 *   VALID_IMPORTANCES
 */

export const DAY_STATUSES = ["open", "closed"];
export const VALID_EMOTIONS = [
  "joy", "sadness", "anger", "fear", "surprise", "disgust",
  "curiosity", "pride", "shame", "love", "neutral", "mixed",
  // legacy spanish keys (kept for compatibility with dayAnalyzer.js)
  "alegría", "tristeza", "ansiedad", "enojo", "calma",
];
export const VALID_IMPORTANCES = ["low", "medium", "high"];

// ---- Helpers internos ----

function nowIso() {
  return new Date().toISOString();
}

function generateDayId(date) {
  return `day_${date}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- API pública ----

/**
 * Crea un objeto día vacío para la fecha dada (YYYY-MM-DD).
 * Si no se provee fecha, usa hoy.
 *
 * @param {string} [date]
 * @returns {object}
 */
export function createDay(date) {
  const safeDate =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10);
  const now = nowIso();
  return {
    id: generateDayId(safeDate),
    date: safeDate,
    status: "open",
    rawChat: [],
    memoryIds: [],
    linkedNeurons: [],
    summary: "",
    dominantEmotion: "neutral",
    dominantThemes: [],
    insights: [],
    geminiProcessed: false,
    geminiLastProcessedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    isMilestone: false,
    meta: {
      title: "",
      notes: "",
      importance: "medium",
    },
    _previousVersion: null,
  };
}

/**
 * Valida un objeto día.
 * Retorna { valid: true } si es válido, o { valid: false, errors: [...] } si no.
 *
 * @param {any} day
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateDay(day) {
  const errors = [];

  if (!day || typeof day !== "object") {
    return { valid: false, errors: ["day debe ser un objeto"] };
  }
  if (typeof day.id !== "string" || !day.id.startsWith("day_")) {
    errors.push("id inválido (debe ser string que empieza con 'day_')");
  }
  if (typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
    errors.push("date inválida (debe ser YYYY-MM-DD)");
  }
  if (!DAY_STATUSES.includes(day.status)) {
    errors.push(`status inválido (debe ser: ${DAY_STATUSES.join(", ")})`);
  }
  if (!Array.isArray(day.rawChat)) {
    errors.push("rawChat debe ser un array");
  }
  if (!Array.isArray(day.linkedNeurons)) {
    errors.push("linkedNeurons debe ser un array");
  }
  if (day.dominantEmotion !== undefined && !VALID_EMOTIONS.includes(day.dominantEmotion)) {
    errors.push(`dominantEmotion inválida (valor: '${day.dominantEmotion}')`);
  }
  if (day.meta?.importance !== undefined && !VALID_IMPORTANCES.includes(day.meta.importance)) {
    errors.push(`meta.importance inválida (debe ser: ${VALID_IMPORTANCES.join(", ")})`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Sanitiza un objeto día, corrigiendo o eliminando campos inválidos de forma defensiva.
 * Retorna un nuevo objeto saneado (no muta el original).
 *
 * @param {any} day
 * @returns {object}
 */
export function sanitizeDay(day) {
  if (!day || typeof day !== "object") return createDay();

  const now = nowIso();

  // Fecha
  const safeDate =
    typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
      ? day.date
      : new Date().toISOString().slice(0, 10);

  // ID
  const safeId =
    typeof day.id === "string" && day.id.startsWith("day_")
      ? day.id
      : generateDayId(safeDate);

  // Status
  const safeStatus = DAY_STATUSES.includes(day.status) ? day.status : "open";

  // Emoción
  const safeEmotion = VALID_EMOTIONS.includes(day.dominantEmotion)
    ? day.dominantEmotion
    : "neutral";

  // Arrays
  const safeRawChat = Array.isArray(day.rawChat)
    ? day.rawChat.filter((m) => m && typeof m === "object")
    : [];
  const safeMemoryIds = Array.isArray(day.memoryIds)
    ? day.memoryIds.filter((id) => typeof id === "string" && id)
    : Array.isArray(day.memories) // backward compat
    ? day.memories.filter((id) => typeof id === "string" && id)
    : [];
  const safeLinkedNeurons = Array.isArray(day.linkedNeurons)
    ? day.linkedNeurons.filter((id) => typeof id === "string" && id)
    : [];
  const safeDominantThemes = Array.isArray(day.dominantThemes)
    ? day.dominantThemes.map(String).filter(Boolean)
    : [];
  const safeInsights = Array.isArray(day.insights)
    ? day.insights.map(String).filter(Boolean)
    : [];

  // Meta
  const rawMeta = day.meta && typeof day.meta === "object" ? day.meta : {};
  const safeImportance = VALID_IMPORTANCES.includes(rawMeta.importance)
    ? rawMeta.importance
    : "medium";
  const safeMeta = {
    title: typeof rawMeta.title === "string" ? rawMeta.title : "",
    notes: typeof rawMeta.notes === "string" ? rawMeta.notes : "",
    importance: safeImportance,
  };

  return {
    id: safeId,
    date: safeDate,
    status: safeStatus,
    rawChat: safeRawChat,
    memoryIds: safeMemoryIds,
    linkedNeurons: safeLinkedNeurons,
    summary: typeof day.summary === "string" ? day.summary : "",
    dominantEmotion: safeEmotion,
    dominantThemes: safeDominantThemes,
    insights: safeInsights,
    geminiProcessed: Boolean(day.geminiProcessed),
    geminiLastProcessedAt: day.geminiLastProcessedAt ?? null,
    createdAt: typeof day.createdAt === "string" ? day.createdAt : now,
    updatedAt: typeof day.updatedAt === "string" ? day.updatedAt : now,
    closedAt: day.closedAt ?? null,
    isMilestone: Boolean(day.isMilestone),
    meta: safeMeta,
    _previousVersion: day._previousVersion ?? null,
  };
}

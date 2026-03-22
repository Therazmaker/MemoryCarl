/**
 * dayStore.js — Almacenamiento del Daily Memory Engine
 * MemoryCarl
 *
 * Gestiona los "días" como unidades cognitivas diarias (snapshots).
 *
 * Exporta:
 *   getCurrentDay()
 *   getDayByDate(date)
 *   appendToCurrentDay(message)
 *   closeDay(date)
 *   updateDay(day)
 *   getAllDays()
 *   linkDayToNeurons(dayId, neuronIds)
 *   rollbackDay(dayId)
 *   applyDayRefinement(day, refinementResponse)
 */

const DAY_STORE_KEY = "memorycarl_days_v1";

// ---- Helpers internos ----

function loadDays() {
  try {
    const raw = localStorage.getItem(DAY_STORE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveDays(days) {
  try {
    localStorage.setItem(DAY_STORE_KEY, JSON.stringify(days));
  } catch (_e) {
    // noop — almacenamiento lleno o no disponible
  }
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function generateDayId(date) {
  return `day_${date}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildEmptyDay(date) {
  const now = new Date().toISOString();
  return {
    id: generateDayId(date),
    date,
    rawChat: [],
    memories: [],
    summary: "",
    dominantEmotion: "neutral",
    dominantThemes: [],
    linkedNeurons: [],
    insights: [],
    status: "open",
    geminiProcessed: false,
    createdAt: now,
    updatedAt: now,
    _previousVersion: null,
  };
}

// ---- API pública ----

/**
 * Retorna el día actual (hoy). Si no existe, lo crea automáticamente.
 */
export function getCurrentDay() {
  const date = getTodayDate();
  const days = loadDays();
  let day = days.find((d) => d.date === date && d.status === "open");
  if (!day) {
    day = buildEmptyDay(date);
    days.push(day);
    saveDays(days);
  }
  return day;
}

/**
 * Retorna el día correspondiente a la fecha YYYY-MM-DD, o null si no existe.
 */
export function getDayByDate(date) {
  const days = loadDays();
  return days.find((d) => d.date === date) || null;
}

/**
 * Agrega un mensaje al rawChat del día actual.
 * Si no existe un día abierto para hoy, lo crea.
 */
export function appendToCurrentDay(message) {
  const date = getTodayDate();
  const days = loadDays();
  const idx = days.findIndex((d) => d.date === date && d.status === "open");
  if (idx === -1) {
    const day = buildEmptyDay(date);
    day.rawChat.push(message);
    day.updatedAt = new Date().toISOString();
    days.push(day);
    saveDays(days);
    return days[days.length - 1];
  }
  days[idx].rawChat.push(message);
  days[idx].updatedAt = new Date().toISOString();
  saveDays(days);
  return days[idx];
}

/**
 * Cierra el día con la fecha dada (status → "closed").
 */
export function closeDay(date) {
  const days = loadDays();
  const idx = days.findIndex((d) => d.date === date);
  if (idx === -1) return null;
  days[idx].status = "closed";
  days[idx].updatedAt = new Date().toISOString();
  saveDays(days);
  return days[idx];
}

/**
 * Reemplaza un día en el store, guardando la versión anterior en _previousVersion.
 * Permite rollback simple de un nivel.
 */
export function updateDay(day) {
  const days = loadDays();
  const idx = days.findIndex((d) => d.id === day.id);
  if (idx === -1) return null;
  const previous = { ...days[idx] };
  delete previous._previousVersion;
  days[idx] = {
    ...day,
    _previousVersion: previous,
    updatedAt: new Date().toISOString(),
  };
  saveDays(days);
  return days[idx];
}

/**
 * Retorna todos los días almacenados.
 */
export function getAllDays() {
  return loadDays();
}

/**
 * Vincula un conjunto de IDs de neuronas al día indicado (union, no reemplazo).
 */
export function linkDayToNeurons(dayId, neuronIds) {
  if (!Array.isArray(neuronIds) || neuronIds.length === 0) return null;
  const days = loadDays();
  const idx = days.findIndex((d) => d.id === dayId);
  if (idx === -1) return null;
  const existing = new Set(days[idx].linkedNeurons || []);
  for (const id of neuronIds) {
    if (id) existing.add(id);
  }
  days[idx].linkedNeurons = Array.from(existing);
  days[idx].updatedAt = new Date().toISOString();
  saveDays(days);
  return days[idx];
}

/**
 * Restaura la versión anterior del día (rollback de un nivel).
 * Retorna el día restaurado o null si no hay versión anterior.
 */
export function rollbackDay(dayId) {
  const days = loadDays();
  const idx = days.findIndex((d) => d.id === dayId);
  if (idx === -1) return null;
  const prev = days[idx]._previousVersion;
  if (!prev) return null;
  days[idx] = { ...prev, _previousVersion: null, updatedAt: new Date().toISOString() };
  saveDays(days);
  return days[idx];
}

/**
 * Aplica el resultado de refinamiento de Gemini al día.
 *
 * refinementResponse = {
 *   improvedSummary, correctedEmotion, refinedThemes,
 *   neuronAdjustments: { merge:[], update:[], remove:[], create:[] },
 *   insights
 * }
 *
 * Retorna el día actualizado. Si el refinement está vacío o es inválido,
 * retorna el día sin cambios (sin romper el estado).
 */
export function applyDayRefinement(day, refinementResponse) {
  if (!day || !refinementResponse) return day;
  try {
    const updated = { ...day };

    if (refinementResponse.improvedSummary) {
      updated.summary = String(refinementResponse.improvedSummary);
    }
    if (refinementResponse.correctedEmotion) {
      updated.dominantEmotion = String(refinementResponse.correctedEmotion);
    }
    if (Array.isArray(refinementResponse.refinedThemes) && refinementResponse.refinedThemes.length > 0) {
      updated.dominantThemes = refinementResponse.refinedThemes.map(String);
    }
    if (Array.isArray(refinementResponse.insights) && refinementResponse.insights.length > 0) {
      updated.insights = refinementResponse.insights.map(String);
    }
    updated.geminiProcessed = true;
    return updateDay(updated) || updated;
  } catch (_err) {
    // No romper el estado si falla la aplicación
    return day;
  }
}

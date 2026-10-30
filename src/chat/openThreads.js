/**
 * openThreads.js — Almacén y gestor de Hilos Abiertos (Capa 2 de NeuroChat)
 * MemoryCarl / NeuroChat
 *
 * Administra hilos o pendientes en curso (ej: "buscando trabajo", "entrevista el jueves 29", "esperando respuesta de X").
 */

import { todayLocalStr, stampUpdatedAt } from "./lifeDates.js";
import { markAppStateChanged } from "../services/syncOutbox.js";
import { VALID_CATEGORIES, inferArea, normalizeText } from "./lifeFacts.js";

export const OPEN_THREADS_KEY = "memorycarl_open_threads";

// Hilos que se cierran solos cuando empieza una etapa nueva en su área
// (ej. "buscando trabajo" al conseguir trabajo)
const SEARCH_TOPIC_PATTERN = /(busc|busqued|consegu|encontr|postul|esperando respuesta|entrevista)/;

const PROHIBITED_TONE_PATTERNS = [
  /deber[íi][as]?/iu,
  /no has hecho/iu,
  /ya es hora/iu,
  /tienes que/iu,
  /\bdebes\b/iu,
  /es hora de que/iu,
];

function getTodayStr() {
  return todayLocalStr();
}

function copy(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

function recordChange(changes, kind, before, after) {
  if (!Array.isArray(changes)) return;
  changes.push({ store: "thread", kind, id: (after || before).id, before: copy(before), after: copy(after) });
}

function normalizeCategory(category, topic) {
  const raw = String(category || "").toLowerCase().trim();
  return VALID_CATEGORIES.includes(raw) ? raw : inferArea(topic);
}

/** true si el hilo es una búsqueda o espera que se resuelve al empezar una etapa nueva en su área */
export function isSearchThread(thread) {
  return SEARCH_TOPIC_PATTERN.test(normalizeText(thread?.topic));
}

/**
 * Carga todos los hilos abiertos desde localStorage.
 * @returns {Array}
 */
export function loadOpenThreads() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(OPEN_THREADS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Hilos antiguos sin área: se deduce del texto
    return parsed.map((t) => (t && !t.category ? { ...t, category: normalizeCategory(null, t.topic) } : t));
  } catch (_e) {
    return [];
  }
}

/**
 * Guarda el array de hilos en localStorage y dispara sincronización con Supabase.
 * @param {Array} threads
 */
export function saveOpenThreads(threads) {
  try {
    if (typeof localStorage === "undefined") return;
    stampUpdatedAt(threads, loadOpenThreads());
    localStorage.setItem(OPEN_THREADS_KEY, JSON.stringify(threads));
    markAppStateChanged();
    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase(false);
    }
  } catch (_e) {
    console.warn("[openThreads] Error guardando hilos en localStorage:", _e);
  }
}

/**
 * Abre o crea un nuevo hilo abierto.
 * @param {object} threadData - { topic, dueDate?, note? }
 * @returns {object|null}
 */
export function openThread(threadData, opts = {}) {
  if (!threadData || typeof threadData !== "object") return null;
  const topic = String(threadData.topic || "").trim();
  if (!topic || topic.length > 200) return null;

  const threads = loadOpenThreads();
  const todayStr = getTodayStr();

  // Si ya existe un hilo abierto idéntico o similar, se actualiza
  const existingIdx = threads.findIndex(
    (t) => t.status === "open" && normalizeText(t.topic) === normalizeText(topic)
  );

  if (existingIdx !== -1) {
    const before = copy(threads[existingIdx]);
    threads[existingIdx].lastMentioned = todayStr;
    if (threadData.dueDate) threads[existingIdx].dueDate = threadData.dueDate;
    if (threadData.note) threads[existingIdx].note = threadData.note;
    if (threadData.category) threads[existingIdx].category = normalizeCategory(threadData.category, topic);
    // Volver a mencionar un hilo no es un cambio que valga la pena avisar
    const after = threads[existingIdx];
    if (after.dueDate !== before.dueDate || after.note !== before.note || after.category !== before.category) {
      recordChange(opts.changes, "thread_updated", before, after);
    }
    saveOpenThreads(threads);
    return threads[existingIdx];
  }

  const id = threadData.id || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newThread = {
    id,
    topic,
    status: "open",
    openedAt: threadData.openedAt || todayStr,
    lastMentioned: todayStr,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(threadData.dueDate || "") ? threadData.dueDate : null,
    note: threadData.note || "",
    category: normalizeCategory(threadData.category, topic),
  };

  threads.push(newThread);
  recordChange(opts.changes, "thread_opened", null, newThread);
  saveOpenThreads(threads);
  return newThread;
}

/**
 * Resuelve o cierra un hilo abierto (`status: "resolved"`).
 * @param {string} idOrMatch - ID exacto o fragmento del topic
 * @returns {boolean} true si se encontró y resolvió
 */
export function resolveThread(idOrMatch, opts = {}) {
  if (!idOrMatch) return false;
  const threads = loadOpenThreads();
  // ID exacto primero; si no, por texto sin tildes ni mayúsculas
  let targets = threads.filter((t) => t.status === "open" && t.id === idOrMatch);
  if (!targets.length) {
    const matchStr = normalizeText(idOrMatch);
    targets = matchStr ? threads.filter((t) => t.status === "open" && normalizeText(t.topic).includes(matchStr)) : [];
  }
  const found = targets.length > 0;

  for (const t of targets) {
    const before = copy(t);
    t.status = "resolved";
    t.resolvedAt = getTodayStr();
    if (opts.resolution) t.resolution = String(opts.resolution).slice(0, 200);
    recordChange(opts.changes, "thread_resolved", before, t);
  }

  if (found) {
    saveOpenThreads(threads);
  }
  return found;
}

/**
 * Borra un hilo por su ID.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteThread(id) {
  const threads = loadOpenThreads();
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return false;

  threads.splice(idx, 1);
  saveOpenThreads(threads);
  return true;
}

/**
 * Retorna hilos según filtros.
 * @param {object} options - { status: "open"|"resolved"|"all" }
 * @returns {Array}
 */
export function getOpenThreads(options = {}) {
  const threads = loadOpenThreads();
  const status = options.status || "open";

  if (status === "all") return threads;
  return threads.filter((t) => t.status === status);
}

/**
 * Genera el bloque de texto [HILOS ABIERTOS] para inyección en el prompt de sistema del LLM.
 *
 * Reglas:
 * - Máximo 5 hilos abiertos.
 * - Si un hilo tiene dueDate < hoy y no está resuelto, se pasa con indicación de fecha vencida.
 * - Máximo UN seguimiento por conversación para hilos vencidos.
 *
 * @returns {{ blockText: string, hasOverdueThread: boolean, charCount: number, threadCount: number }}
 */
export function buildOpenThreadsPromptBlock() {
  const threads = getOpenThreads({ status: "open" });
  if (!threads.length) {
    return { blockText: "", hasOverdueThread: false, charCount: 0, threadCount: 0 };
  }

  const todayStr = getTodayStr();
  let overdueInjectedCount = 0;
  let hasOverdueThread = false;

  // Ordenar por fecha de vencimiento si existe, o por lastMentioned
  const sorted = [...threads].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.lastMentioned.localeCompare(a.lastMentioned);
  });

  const selected = sorted.slice(0, 5);

  const lines = selected.map((t) => {
    const area = String(t.category || "otro").toUpperCase();
    const isOverdue = t.dueDate && t.dueDate < todayStr;
    if (isOverdue) {
      if (overdueInjectedCount < 1) {
        overdueInjectedCount++;
        hasOverdueThread = true;
        return `- [HILO PENDIENTE · ${area}] id=${t.id} · "${t.topic}" tenía fecha tope ${t.dueDate} (ya pasó, sin resolver).`;
      } else {
        // Ignorar vencimiento extra para no sobrecargar el prompt (máximo 1 seguimiento)
        return `- [HILO ABIERTO · ${area}] id=${t.id} · "${t.topic}" (abierto el ${t.openedAt}).`;
      }
    }
    const dueStr = t.dueDate ? ` (fecha tope: ${t.dueDate})` : "";
    return `- [HILO ABIERTO · ${area}] id=${t.id} · "${t.topic}"${dueStr}.`;
  });

  const blockText = `\n\n## HILOS ABIERTOS (TEMAS PENDIENTES O EN CURSO)\nEstos son temas en curso del usuario. Mantenlos presentes de forma curiosa e informativa. PROHIBIDO presionar o sermonearlas ("deberías", "tienes que", "ya es hora"). Si el usuario cuenta que uno se cumplió o ya no aplica, ciérralo con resolveThread usando su id.\n${lines.join("\n")}`;

  return {
    blockText,
    hasOverdueThread,
    charCount: blockText.length,
    threadCount: selected.length,
  };
}

/**
 * Evalúa si la respuesta del asistente contiene tono prohibitivo o de presión ("deberías", "no has hecho", "ya es hora", "tienes que").
 *
 * @param {string} responseText
 * @returns {boolean} true si se detecta tono de presión
 */
export function hasPressuringTone(responseText = "") {
  if (!responseText || typeof responseText !== "string") return false;
  return PROHIBITED_TONE_PATTERNS.some((pattern) => pattern.test(responseText));
}

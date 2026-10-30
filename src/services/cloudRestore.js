/**
 * cloudRestore.js — Restaurar desde Supabase sin pisar los datos locales
 * MemoryCarl / NeuroChat
 *
 * El backend guarda versiones recortadas: las neuronas sin su estructura (core, conexiones),
 * los días sin los mensajes del chat y el historial sin fechas. Estas utilidades convierten
 * esas filas al formato de la app y solo AÑADEN lo que falta en el teléfono, nunca reemplazan.
 */

import { todayLocalStr } from "../chat/lifeDates.js";

/** Neurona del backend (plana) → neurona de la app. Si ya tiene `core`, se devuelve tal cual. */
export function cloudNeuronToLocal(row) {
  if (!row || typeof row !== "object") return null;
  // Columna `data`: la neurona completa tal como estaba en el teléfono
  if (row.data && typeof row.data === "object" && row.data.core) return { ...row.data, id: row.data.id || row.id };
  if (row.core && typeof row.core === "object") return row;
  if (!row.concept) return row;
  return {
    id: row.id,
    type: row.type || "memory",
    core: { concept: row.concept, domain: row.domain || "general", summary: row.summary || "" },
    triggers: Array.isArray(row.triggers) ? row.triggers : [],
    connections: Array.isArray(row.connections) ? row.connections : [],
    weight: typeof row.weight === "number" ? Math.min(1, row.weight) : 0.5,
    emotion: row.emotion || "neutral",
    temporal: row.temporal && typeof row.temporal === "object" ? row.temporal : undefined,
    updatedAt: row.updated_at || undefined,
  };
}

/** Memoria del backend → memoria de la app. */
export function cloudMemoryToLocal(row) {
  if (!row || typeof row !== "object") return null;
  if (row.data && typeof row.data === "object" && typeof row.data.text === "string") return { ...row.data, id: row.data.id || row.id };
  if (typeof row.text === "string") return row;
  const { text_content, linked_neurons, ...rest } = row;
  return { ...rest, text: text_content || row.snippet || "", linkedNeurons: Array.isArray(linked_neurons) ? linked_neurons : [] };
}

/** Día del backend (solo resumen) → día de la app, sin mensajes. */
export function cloudDayToLocal(row) {
  if (!row?.date) return null;
  // Columna `data`: el día completo, con su chat
  if (row.data && typeof row.data === "object" && Array.isArray(row.data.rawChat)) {
    return { ...row.data, date: row.data.date || row.date };
  }
  const now = new Date().toISOString();
  return {
    id: row.id || `day_${row.date}`,
    date: row.date,
    rawChat: Array.isArray(row.rawChat) ? row.rawChat : [],
    memories: Array.isArray(row.memories) ? row.memories : [],
    summary: row.summary || "",
    dominantEmotion: row.dominantEmotion || row.dominant_emotion || "neutral",
    dominantThemes: row.dominantThemes || row.dominant_themes || [],
    linkedNeurons: row.linkedNeurons || [],
    insights: Array.isArray(row.insights) ? row.insights : [],
    isMilestone: Boolean(row.isMilestone ?? row.is_milestone),
    status: row.date < todayLocalStr() ? "closed" : "open",
    geminiProcessed: false,
    createdAt: row.created_at || now,
    updatedAt: row.updated_at || now,
    _previousVersion: null,
  };
}

/** Mensaje del backend → mensaje de la app. */
export function cloudChatToLocal(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.ts === "number") return row;
  // La hora original viaja en meta.ts; created_at es la hora de subida
  const ts = Number(row.meta?.ts) || Date.parse(row.created_at || "") || Date.now();
  return { role: row.role || "user", content: row.content || "", ts, messageId: row.message_id || row.messageId || row.id };
}

/**
 * Añade a `local` los elementos de `cloud` cuyo id no existe en local.
 * @returns {{ list: Array, added: number }}
 */
export function addMissingById(local = [], cloud = [], convert = (x) => x) {
  const ids = new Set(local.map((x) => x?.id).filter(Boolean));
  const list = [...local];
  let added = 0;
  for (const row of cloud) {
    const item = convert(row);
    if (item?.id && !ids.has(item.id)) {
      list.push(item);
      ids.add(item.id);
      added++;
    }
  }
  return { list, added };
}

/**
 * Actualiza neuronas locales con la versión de la nube cuando la nube es más reciente
 * (subida desde otro dispositivo después de la última edición local). Solo se toman los
 * campos que guarda el backend; conexiones, embeddings y evolución locales se conservan.
 * @returns {{ list: Array, updated: number }}
 */
export function refreshNeuronsFromCloud(local = [], cloud = []) {
  const byId = new Map(cloud.filter((r) => r?.id).map((r) => [r.id, r]));
  let updated = 0;
  const list = local.map((n) => {
    const row = byId.get(n?.id);
    const cloudAt = Date.parse(row?.data?.updatedAt || row?.updated_at || "") || 0;
    const localAt = Date.parse(n?.updatedAt || "") || 0;
    if (!row || !cloudAt || cloudAt <= localAt) return n;
    // Con `data` la nube trae la neurona completa: se toma entera conservando el embedding local
    if (row.data?.core) {
      const full = { ...row.data, id: n.id, embedding: n.embedding };
      if (JSON.stringify(full) === JSON.stringify(n)) return n;
      updated++;
      return full;
    }
    const c = cloudNeuronToLocal(row);
    const next = {
      ...n,
      core: { ...(n.core || {}), ...(c.core || {}) },
      triggers: Array.isArray(c.triggers) ? c.triggers : n.triggers,
      emotion: c.emotion || n.emotion,
      weight: typeof c.weight === "number" ? c.weight : n.weight,
      ...(c.temporal ? { temporal: c.temporal } : {}),
      updatedAt: row.updated_at,
    };
    if (JSON.stringify(next) === JSON.stringify(n)) return n;
    updated++;
    return next;
  });
  return { list, updated };
}

/**
 * Fusiona días de la nube por fecha: añade los que faltan y, en los existentes,
 * solo completa el resumen/temas si en el teléfono están vacíos. Nunca toca rawChat.
 * @returns {{ list: Array, changed: boolean }}
 */
export function mergeCloudDays(localDays = [], cloudDays = []) {
  const list = [...localDays];
  let changed = false;
  for (const row of cloudDays) {
    const cloudDay = cloudDayToLocal(row);
    if (!cloudDay) continue;
    const idx = list.findIndex((d) => d.date === cloudDay.date);
    if (idx === -1) {
      list.push(cloudDay);
      changed = true;
      continue;
    }
    const day = list[idx];
    let next = day;
    // Mensajes: se unen los de ambos lados (nunca se pierde ninguno)
    const cloudChat = Array.isArray(cloudDay.rawChat) ? cloudDay.rawChat : [];
    if (cloudChat.length) {
      const keyOf = (m) => `${m.role}|${m.ts}`;
      const seen = new Set((day.rawChat || []).map(keyOf));
      const extra = cloudChat.filter((m) => m && !seen.has(keyOf(m)));
      if (extra.length) next = { ...next, rawChat: [...(day.rawChat || []), ...extra].sort((a, b) => (a.ts || 0) - (b.ts || 0)) };
    }
    // Resumen, emoción, temas…: gana la versión modificada más recientemente
    const cloudNewer = String(cloudDay.updatedAt || "") > String(day.updatedAt || "") && Array.isArray(row?.data?.rawChat);
    if (cloudNewer) {
      const { rawChat, ...meta } = cloudDay;
      next = { ...next, ...meta, rawChat: next.rawChat };
    } else if (!day.summary && cloudDay.summary) {
      next = { ...next, summary: cloudDay.summary, dominantEmotion: day.dominantEmotion !== "neutral" ? day.dominantEmotion : cloudDay.dominantEmotion, dominantThemes: day.dominantThemes?.length ? day.dominantThemes : cloudDay.dominantThemes };
    }
    if (next !== day) {
      list[idx] = next;
      changed = true;
    }
  }
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { list, changed };
}

function localDateOf(ts) {
  return todayLocalStr(new Date(ts));
}

/**
 * Rellena el rawChat de cada día con los mensajes del historial completo que falten.
 * Crea el día si no existe.
 * @param {Array} days
 * @param {Array} messages - historial del chat ({ role, content, ts, messageId })
 * @param {(date: string) => object} buildDay - crea un día vacío para una fecha
 * @returns {{ list: Array, added: number }}
 */
export function repairDaysFromChat(days = [], messages = [], buildDay) {
  const list = [...days];
  const keyOf = (m) => `${m.role}|${m.ts}`;
  let added = 0;
  const byDate = new Map();
  for (const m of messages) {
    if (!m || typeof m.ts !== "number" || !m.content || !["user", "assistant"].includes(m.role)) continue;
    const date = localDateOf(m.ts);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(m);
  }
  for (const [date, msgs] of byDate) {
    let idx = list.findIndex((d) => d.date === date);
    if (idx === -1) {
      list.push({ ...buildDay(date), status: date < todayLocalStr() ? "closed" : "open" });
      idx = list.length - 1;
    }
    const day = list[idx];
    const raw = Array.isArray(day.rawChat) ? [...day.rawChat] : [];
    const seen = new Set(raw.map(keyOf));
    let changedDay = false;
    for (const m of msgs) {
      if (seen.has(keyOf(m))) continue;
      raw.push(m);
      seen.add(keyOf(m));
      added++;
      changedDay = true;
    }
    if (changedDay) list[idx] = { ...day, rawChat: raw.sort((a, b) => (a.ts || 0) - (b.ts || 0)), updatedAt: new Date().toISOString() };
  }
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { list, added };
}

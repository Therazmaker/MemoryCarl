/**
 * lifeChanges.js — Aplica, describe y deshace cambios en la situación de vida
 * MemoryCarl / NeuroChat
 *
 * Une las dos capas de continuidad (hechos/etapas e hilos abiertos):
 * - applyLifeActions: ejecuta las acciones que propone la IA y devuelve la lista de cambios.
 * - reconcileThreadsWithFacts: cierra los hilos de búsqueda cuando empieza una etapa nueva
 *   en su área (ej. "buscando trabajo" al conseguir trabajo).
 * - undoLifeChanges: revierte una lista de cambios usando el estado anterior guardado.
 */

import { loadLifeFacts, saveLifeFacts, upsertLifeFact, endLifeFact, AREA_META } from "./lifeFacts.js";
import { loadOpenThreads, saveOpenThreads, openThread, resolveThread, isSearchThread } from "./openThreads.js";

/**
 * Cierra los hilos de búsqueda/espera abiertos antes de que empezara una etapa activa
 * de su misma área.
 * @param {{ changes?: Array, facts?: Array }} [opts] - `facts` limita la revisión a esas etapas
 * @returns {Array} cambios realizados
 */
export function reconcileThreadsWithFacts(opts = {}) {
  const changes = opts.changes || [];
  const facts = (opts.facts || loadLifeFacts()).filter((f) => f.status === "active" && !f.pendingConfirm);
  if (!facts.length) return changes;

  for (const thread of loadOpenThreads().filter((t) => t.status === "open" && isSearchThread(t))) {
    const stage = facts.find((f) => f.category === thread.category && f.since >= thread.openedAt);
    if (stage) resolveThread(thread.id, { changes, resolution: `Empezó: ${stage.text}` });
  }
  return changes;
}

/**
 * Ejecuta las acciones de situación de vida propuestas por la IA.
 * Acciones: upsertLifeFact, endLifeFact, openThread, resolveThread.
 * @param {Array} actions
 * @returns {Array} cambios realizados (para mostrarlos y poder deshacerlos)
 */
export function applyLifeActions(actions = []) {
  const changes = [];
  if (!Array.isArray(actions)) return changes;

  for (const action of actions) {
    try {
      if (action?.type === "upsertLifeFact" && action.fact) {
        upsertLifeFact({ ...action.fact, source: "model_proposed" }, { changes });
      } else if (action?.type === "endLifeFact" && (action.id || action.match)) {
        endLifeFact(action.id || action.match, { changes, until: action.until, endNote: action.note });
      } else if (action?.type === "openThread" && action.thread) {
        openThread(action.thread, { changes });
      } else if (action?.type === "resolveThread" && (action.id || action.match)) {
        resolveThread(action.id || action.match, { changes });
      }
    } catch (err) {
      console.warn("[lifeChanges] Error aplicando acción:", action?.type, err);
    }
  }

  // Red de seguridad: si empezó una etapa y la IA no cerró la búsqueda de esa área, se cierra aquí
  const startedFacts = changes.filter((c) => c.kind === "fact_started" && c.after?.status === "active").map((c) => c.after);
  if (startedFacts.length) reconcileThreadsWithFacts({ changes, facts: startedFacts });

  return changes;
}

/**
 * Revierte una lista de cambios (en orden inverso), restaurando el estado anterior de cada elemento.
 * @param {Array} changes
 * @returns {number} cuántos cambios se revirtieron
 */
export function undoLifeChanges(changes = []) {
  if (!Array.isArray(changes) || !changes.length) return 0;
  const facts = loadLifeFacts();
  const threads = loadOpenThreads();
  let count = 0;

  for (const change of [...changes].reverse()) {
    const list = change.store === "thread" ? threads : facts;
    const idx = list.findIndex((x) => x.id === change.id);
    if (!change.before) {
      if (idx !== -1) list.splice(idx, 1);
    } else if (idx !== -1) {
      list[idx] = change.before;
    } else {
      list.push(change.before);
    }
    count++;
  }

  if (changes.some((c) => c.store !== "thread")) saveLifeFacts(facts);
  if (changes.some((c) => c.store === "thread")) saveOpenThreads(threads);
  return count;
}

/**
 * Texto corto de un cambio para mostrarlo al usuario.
 * @param {object} change
 * @returns {{ icon: string, text: string }}
 */
export function describeLifeChange(change) {
  const item = change.after || change.before || {};
  const area = AREA_META[item.category] || AREA_META.otro;
  switch (change.kind) {
    case "fact_started":     return { icon: area.icon, text: `Nueva etapa en ${area.label}: ${item.text}` };
    case "fact_ended":       return { icon: "🏁", text: `Terminó: ${item.text}` };
    case "fact_reactivated": return { icon: "↩", text: `Sigue vigente: ${item.text}` };
    case "fact_updated":     return { icon: "✏️", text: `Actualicé: ${item.text}` };
    case "thread_opened":    return { icon: "📌", text: `Nuevo tema en curso: ${item.topic}` };
    case "thread_resolved":  return { icon: "✅", text: `Cerré: ${item.topic}` };
    case "thread_updated":   return { icon: "📌", text: `Sigue en curso: ${item.topic}` };
    default:                 return { icon: "•", text: item.text || item.topic || "Cambio" };
  }
}

/**
 * Fusiona la copia local con la de la nube elemento a elemento (por id),
 * quedándose con la versión modificada más recientemente. Lo que solo existe
 * en un lado se conserva.
 * @param {Array} local
 * @param {Array} cloud
 * @returns {Array}
 */
export function mergeLifeLists(local = [], cloud = []) {
  const merged = new Map();
  for (const item of Array.isArray(cloud) ? cloud : []) if (item?.id) merged.set(item.id, item);
  for (const item of Array.isArray(local) ? local : []) {
    if (!item?.id) continue;
    const other = merged.get(item.id);
    if (!other || String(item.updatedAt || "") >= String(other.updatedAt || "")) merged.set(item.id, item);
  }
  return [...merged.values()];
}

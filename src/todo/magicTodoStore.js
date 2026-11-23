/**
 * magicTodoStore.js — Lo que el Magic ToDo guarda aparte de las tareas
 * MemoryCarl
 *
 * Las tareas viven en state.reminders. Aquí van:
 * - history: las tareas cumplidas (de aquí aprende)
 * - prefs: nivel de detalle y si desglosa al agregar
 * Se sube a Supabase como módulo "magic_todo" y se une por id al bajar.
 */

import { markAppStateChanged } from "../services/syncOutbox.js";
import { mergeHistory } from "./magicTodoEngine.js";

export const MAGIC_TODO_KEY = "memorycarl_magic_todo_v1";

export function loadMagic() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MAGIC_TODO_KEY) : null;
    const j = raw ? JSON.parse(raw) : {};
    return {
      history: Array.isArray(j.history) ? j.history : [],
      prefs: { detail: 2, autoBreak: true, ...(j.prefs || {}) },
    };
  } catch (_e) {
    return { history: [], prefs: { detail: 2, autoBreak: true } };
  }
}

export function saveMagic(data) {
  try {
    localStorage.setItem(MAGIC_TODO_KEY, JSON.stringify({ history: data.history || [], prefs: data.prefs || {} }));
    markAppStateChanged();
  } catch (_e) {
    console.warn("[magicTodo] No se pudo guardar.");
  }
}

/** Guarda (o reemplaza) una tarea cumplida en el historial. */
export function addToHistory(entry) {
  const d = loadMagic();
  const now = Date.now();
  d.history = [{ ...entry, updatedAt: now }, ...d.history.filter((h) => h.id !== entry.id)];
  saveMagic(d);
  return d;
}

/** La quita del historial (queda marcada para que la nube no la devuelva). */
export function removeFromHistory(id) {
  const d = loadMagic();
  const h = d.history.find((x) => x.id === id);
  if (!h) return d;
  h.deleted = true;
  h.updatedAt = Date.now();
  saveMagic(d);
  return d;
}

export function setPrefs(patch) {
  const d = loadMagic();
  d.prefs = { ...d.prefs, ...patch };
  saveMagic(d);
  return d.prefs;
}

/** Lo que se sube a la nube (nada si el historial está vacío). */
export function magicPayload() {
  const d = loadMagic();
  return d.history.length ? { history: d.history, prefs: d.prefs } : null;
}

/** Une con la copia de la nube. */
export function mergeMagicFromCloud(cloud) {
  if (!cloud || !Array.isArray(cloud.history)) return false;
  const d = loadMagic();
  const r = mergeHistory(d.history, cloud.history);
  if (!r.changed) return false;
  d.history = r.list;
  saveMagic(d);
  return true;
}

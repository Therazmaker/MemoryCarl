/**
 * corrections.js — Correcciones del usuario ("esto no es así")
 * MemoryCarl / NeuroChat
 *
 * Cada vez que el usuario corrige a Carl (desde un hecho de vida, desde una respuesta o
 * diciéndoselo en el chat) queda anotado aquí. Las correcciones van siempre en el contexto
 * para que no repita el mismo error.
 */

import { stampUpdatedAt } from "./lifeDates.js";
import { markAppStateChanged } from "../services/syncOutbox.js";

export const CORRECTIONS_KEY = "memorycarl_corrections_v1";
const MAX_IN_PROMPT = 20;

export function loadCorrections() {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => c && c.id) : [];
  } catch (_e) {
    return [];
  }
}

export function saveCorrections(list) {
  try {
    if (typeof localStorage === "undefined") return;
    stampUpdatedAt(list, loadCorrections());
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(list));
    markAppStateChanged();
    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase(false);
    }
  } catch (_e) {
    console.warn("[corrections] No se pudo guardar:", _e);
  }
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Anota una corrección. `wrong` es lo que Carl dijo o creyó; `right`, lo cierto.
 * @param {{ wrong?: string, right?: string, source?: string }} input
 * @returns {object|null}
 */
export function addCorrection(input = {}) {
  const wrong = String(input.wrong || "").trim().slice(0, 240);
  const right = String(input.right || "").trim().slice(0, 240);
  if (!wrong && !right) return null;
  const list = loadCorrections();
  const dup = list.find((c) => !c.deleted && norm(c.wrong) === norm(wrong) && norm(c.right) === norm(right));
  if (dup) return dup;
  const c = {
    id: `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    wrong,
    right,
    source: input.source || "user",
    createdAt: new Date().toISOString(),
  };
  list.push(c);
  saveCorrections(list);
  return c;
}

export function deleteCorrection(id) {
  const list = loadCorrections();
  const c = list.find((x) => x.id === id);
  if (!c) return false;
  c.deleted = true;
  saveCorrections(list);
  return true;
}

/** Bloque del prompt con las últimas correcciones (las más recientes primero). */
export function buildCorrectionsBlock(list = loadCorrections()) {
  const live = list.filter((c) => !c.deleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, MAX_IN_PROMPT);
  if (!live.length) return "";
  const lines = live.map((c) => {
    if (c.wrong && c.right) return `- NO es cierto: "${c.wrong}". Lo cierto: ${c.right}`;
    if (c.wrong) return `- NO es cierto: "${c.wrong}"`;
    return `- Lo cierto: ${c.right}`;
  });
  return `\n\n## CORRECCIONES QUE TE HIZO EL USUARIO\nYa te equivocaste en esto y te lo corrigió. Lo que dice aquí manda sobre cualquier otro dato (neuronas, memorias, días). No repitas estos errores.\n${lines.join("\n")}`;
}

/** Une con la copia de la nube (por id; gana el más reciente). */
export function mergeCorrections(local = [], cloud = []) {
  const map = new Map((local || []).filter((c) => c?.id).map((c) => [c.id, c]));
  let changed = false;
  for (const c of cloud || []) {
    if (!c?.id) continue;
    const l = map.get(c.id);
    if (!l || String(c.updatedAt || "") > String(l.updatedAt || "")) {
      map.set(c.id, c);
      changed = true;
    }
  }
  return { list: [...map.values()], changed };
}

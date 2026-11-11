/**
 * graphRepairEngine.js — "Reparar con Claude"
 * MemoryCarl / NeuroChat
 *
 * Flujo en dos pasos:
 *   1. proposeGraphRepair(): manda a Claude una versión compacta del grafo y recibe un plan
 *      con salida estructurada (JSON validado por esquema), en streaming para no cortarse.
 *      El plan se valida localmente. No se cambia nada todavía.
 *   2. applyGraphRepair(plan): guarda una copia, aplica todo de una sola vez y registra
 *      los borrados para los otros dispositivos. undoLastGraphRepair() vuelve atrás.
 */

import { getAllNeurons, replaceAllNeurons } from "./neuronStore.js";
import { RepairError, friendlyApiError, readMessageStream } from "./claudeStream.js";

// Compatibilidad: el parser tolerante sigue disponible para quien lo importe desde aquí
export { safeParseJSON } from "./claudeStream.js";
import { getAllMemories, replaceAllMemories } from "../memory/memoryStore.js";
import { getClaudeSettings, isClaudeConfigured } from "../services/claudeClient.js";
import { applyNeuronTombstones } from "../services/cloudRestore.js";
import { loadTombstones, saveTombstones, addTombstones, withoutTombstones } from "./neuronTombstones.js";
import {
  buildRepairInput, validateRepairPlan, applyRepairPlan, planIsEmpty,
  REPAIR_PLAN_SCHEMA, REPAIR_SYSTEM_PROMPT,
} from "./graphRepairPlan.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const REPAIR_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const IDLE_TIMEOUT_MS = 120_000;   // sin recibir nada del stream
const TOTAL_TIMEOUT_MS = 8 * 60_000;
const MAX_TOKENS = 32_000;
export const REPAIR_BACKUP_KEY = "memorycarl_neurograph_repair_backup_v1";

function buildRequest(input, { withFallback = true } = {}) {
  const body = {
    model: REPAIR_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: REPAIR_PLAN_SCHEMA },
    },
    system: [{ type: "text", text: REPAIR_SYSTEM_PROMPT }],
    messages: [{
      role: "user",
      content: `Grafo actual (${input.length} neuronas):\n${JSON.stringify(input)}\n\nPropón el plan de limpieza.`,
    }],
  };
  if (withFallback) body.fallbacks = "default";
  return body;
}

async function callClaude(input, { apiKey, onProgress, signal: outerSignal }) {
  const attempt = async (withFallback) => {
    const controller = new AbortController();
    let idleTimer = null;
    const bump = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort("idle"), IDLE_TIMEOUT_MS);
    };
    const totalTimer = setTimeout(() => controller.abort("total"), TOTAL_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort("user");
    outerSignal?.addEventListener?.("abort", onOuterAbort);
    bump();
    try {
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (withFallback) headers["anthropic-beta"] = FALLBACK_BETA;
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequest(input, { withFallback })),
        signal: controller.signal,
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json())?.error?.message || ""; } catch (_e) { /* sin cuerpo */ }
        // Si la cuenta no acepta el respaldo automático, se reintenta sin él
        if (withFallback && res.status === 400 && /fallback|beta/i.test(msg)) return { retryWithoutFallback: true };
        throw new RepairError(friendlyApiError(res.status, msg));
      }
      if (!res.body) throw new RepairError("El navegador no pudo leer la respuesta de Claude.");
      let lastShown = 0;
      return await readMessageStream(res.body, {
        signal: controller.signal,
        onActivity: (phase, chars) => {
          bump();
          const now = Date.now();
          if (now - lastShown < 400) return;
          lastShown = now;
          onProgress(phase === "writing" ? `Claude está escribiendo el plan… (${Math.round(chars / 100) / 10}k)` : "Claude está analizando el grafo…");
        },
      });
    } catch (err) {
      if (err instanceof RepairError) throw err;
      const reason = controller.signal.reason;
      if (reason === "user") throw new RepairError("Se canceló el análisis.");
      if (reason === "idle" || reason === "total") throw new RepairError("Claude tardó demasiado en responder. Intenta de nuevo en un momento.");
      if (err?.name === "TypeError") throw new RepairError("No se pudo conectar con Claude. Revisa tu conexión a internet.");
      throw new RepairError(err?.message || "Error inesperado al hablar con Claude.");
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      outerSignal?.removeEventListener?.("abort", onOuterAbort);
    }
  };

  let out = await attempt(true);
  if (out?.retryWithoutFallback) out = await attempt(false);
  return out;
}

/**
 * Paso 1: pide el plan. No modifica nada.
 * @returns {Promise<{ ok: boolean, plan?: object, warnings?: string[], neuronCount?: number, error?: string }>}
 */
export async function proposeGraphRepair({ onProgress = () => {}, signal } = {}) {
  try {
    if (!isClaudeConfigured()) {
      return { ok: false, error: "Falta la API key de Claude. Agrégala en Ajustes de NeuroChat." };
    }
    const settings = getClaudeSettings();
    const neurons = getAllNeurons({ includeDeleted: false });
    if (!neurons.length) return { ok: false, error: "No hay neuronas para revisar." };

    onProgress(`Preparando ${neurons.length} neuronas…`);
    const input = buildRepairInput(neurons);
    onProgress("Enviando el grafo a Claude…");
    const { text, stopReason } = await callClaude(input, { apiKey: settings.apiKey.trim(), onProgress, signal });

    if (stopReason === "refusal") return { ok: false, error: "Claude no quiso procesar este contenido. Prueba de nuevo más tarde." };
    if (stopReason === "max_tokens") return { ok: false, error: "El plan salió demasiado largo y quedó incompleto. Vuelve a intentarlo: Claude suele proponer menos cambios la segunda vez." };
    if (!text.trim()) return { ok: false, error: "Claude devolvió una respuesta vacía." };

    let raw;
    try { raw = JSON.parse(text); } catch (_e) { return { ok: false, error: "La respuesta de Claude no se pudo leer. Intenta de nuevo." }; }

    onProgress("Revisando el plan…");
    // Se valida contra el estado de AHORA (pudo cambiar mientras Claude pensaba)
    const current = getAllNeurons({ includeDeleted: false });
    const { plan, warnings } = validateRepairPlan(raw, current);
    return { ok: true, plan, warnings, neuronCount: current.length, empty: planIsEmpty(plan) };
  } catch (err) {
    console.error("[graphRepairEngine]", err);
    return { ok: false, error: err?.message || "Ocurrió un error inesperado." };
  }
}

/** Paso 2: aplica un plan validado, con copia para deshacer. */
export function applyGraphRepair(plan) {
  const neurons = getAllNeurons({ includeDeleted: true });
  const memories = getAllMemories();
  const tombsBefore = loadTombstones();
  const backup = { at: new Date().toISOString(), neurons, memories, tombstones: tombsBefore };
  try {
    localStorage.setItem(REPAIR_BACKUP_KEY, JSON.stringify(backup));
  } catch (_e) {
    return { ok: false, error: "No hay espacio para guardar la copia de seguridad; no se aplicó nada." };
  }

  // Las eliminadas (papelera) se conservan tal cual; la reparación solo toca las activas
  const trashed = neurons.filter((n) => n.deleted);
  const { neurons: repaired, removedIds, mergedInto, stats } = applyRepairPlan(neurons.filter((n) => !n.deleted), plan);
  const removedSet = new Set(removedIds);
  const nextNeurons = [...repaired, ...trashed.filter((n) => !removedSet.has(String(n.id)))];

  const memResult = applyNeuronTombstones([], memories, { ids: removedIds, mergedInto });

  replaceAllNeurons(nextNeurons);
  if (memResult.memoriesChanged) replaceAllMemories(memResult.memories);
  if (removedIds.length) addTombstones(removedIds, mergedInto);

  if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
    window.neurochatPushToSupabase(true);
  }
  return { ok: true, stats: { ...stats, memories: memResult.memoriesChanged || 0 }, removedIds };
}

export function getRepairBackupInfo() {
  try {
    const raw = localStorage.getItem(REPAIR_BACKUP_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    return b?.at ? { at: b.at, count: Array.isArray(b.neurons) ? b.neurons.length : 0 } : null;
  } catch (_e) {
    return null;
  }
}

/** Vuelve al estado anterior a la última reparación. */
export function undoLastGraphRepair() {
  let backup;
  try { backup = JSON.parse(localStorage.getItem(REPAIR_BACKUP_KEY) || "null"); } catch (_e) { backup = null; }
  if (!backup || !Array.isArray(backup.neurons)) return { ok: false, error: "No hay una reparación para deshacer." };

  const restoredIds = backup.neurons.map((n) => String(n.id));
  replaceAllNeurons(backup.neurons);
  if (Array.isArray(backup.memories)) replaceAllMemories(backup.memories);
  // Las neuronas recuperadas dejan de estar en el registro de borrados
  saveTombstones(withoutTombstones(loadTombstones() || backup.tombstones || {}, restoredIds));
  try { localStorage.removeItem(REPAIR_BACKUP_KEY); } catch (_e) { /* noop */ }

  if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
    window.neurochatPushToSupabase(true);
  }
  return { ok: true, count: backup.neurons.length };
}

// Compatibilidad con llamadas antiguas: pide el plan y lo aplica sin vista previa.
export async function repairGraphWithClaude(options = {}) {
  const res = await proposeGraphRepair(options);
  if (!res.ok) return res;
  if (res.empty) return { ok: true, summary: res.plan.summary || "El grafo ya está ordenado.", deletedCount: 0, mergedCount: 0, updatedCount: 0, connectionsCreatedCount: 0 };
  const applied = applyGraphRepair(res.plan);
  if (!applied.ok) return applied;
  return {
    ok: true,
    summary: res.plan.summary,
    deletedCount: applied.stats.deleted,
    mergedCount: applied.stats.merged,
    updatedCount: applied.stats.updated,
    connectionsCreatedCount: applied.stats.connected,
  };
}

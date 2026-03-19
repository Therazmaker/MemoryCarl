/**
 * trace.js — Trazabilidad ligera del proceso de NeuroChat
 * MemoryCarl
 *
 * Registra cada paso sin generar consola caótica.
 * En modo dev se imprimen logs más detallados.
 */

const DEV_MODE_KEY = "memorycarl_neurochat_dev";

/** ¿Está el modo dev activo? */
function isDevMode() {
  try { return localStorage.getItem(DEV_MODE_KEY) === "true"; } catch (_e) { return false; }
}

/**
 * Crea un nuevo trace para una sesión de procesamiento.
 * @param {string} [sessionId]
 * @returns {Trace}
 */
export function createTrace(sessionId) {
  return {
    sessionId:  sessionId || `trace_${Date.now()}`,
    startedAt:  Date.now(),
    steps:      [],
    timing:     {},
    coverage:   null,
    generated:  0,
    activated:  0,
    reply:      false,
  };
}

/**
 * Agrega un paso al trace.
 * @param {Trace} trace
 * @param {string} step — nombre del paso
 * @param {any} [meta] — datos adicionales (opcionales)
 */
export function addStep(trace, step, meta = null) {
  const entry = { step, ts: Date.now() - trace.startedAt };
  if (meta !== null && meta !== undefined) entry.meta = meta;
  trace.steps.push(entry);
  if (isDevMode()) {
    console.log(`[NeuroChat trace] ${step}`, meta ?? "");
  }
}

/**
 * Registra el tiempo de un bloque de procesamiento.
 * @param {Trace} trace
 * @param {string} label
 * @param {number} ms
 */
export function recordTiming(trace, label, ms) {
  trace.timing[label] = Math.round(ms);
}

/**
 * Finaliza el trace y devuelve el resumen.
 * @param {Trace} trace
 * @returns {TraceResult}
 */
export function finalizeTrace(trace) {
  const totalMs = Date.now() - trace.startedAt;
  trace.timing.total = totalMs;
  if (isDevMode()) {
    console.group("[NeuroChat trace] Resumen");
    console.log("Pasos:", trace.steps);
    console.log("Timing:", trace.timing);
    console.log("Coverage:", trace.coverage);
    console.log("Neuronas activadas:", trace.activated);
    console.log("Neuronas generadas:", trace.generated);
    console.groupEnd();
  }
  return {
    coverage:   trace.coverage,
    steps:      trace.steps,
    timing:     trace.timing,
    activated:  trace.activated,
    generated:  trace.generated,
    sessionId:  trace.sessionId,
  };
}

/**
 * Activa o desactiva el modo dev.
 * @param {boolean} on
 */
export function setDevMode(on) {
  try { localStorage.setItem(DEV_MODE_KEY, on ? "true" : "false"); } catch (_e) {}
  console.log(`[NeuroChat] Modo dev: ${on ? "ACTIVO" : "inactivo"}`);
}

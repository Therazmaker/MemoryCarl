/**
 * trace.js — Trazabilidad ligera del proceso de NeuroChat
 */

const DEV_MODE_KEY = "memorycarl_neurochat_dev";

function isDevMode() {
  try { return localStorage.getItem(DEV_MODE_KEY) === "true"; } catch (_e) { return false; }
}

export function createTrace(sessionId) {
  return {
    sessionId: sessionId || `trace_${Date.now()}`,
    startedAt: Date.now(),
    steps: [],
    timing: {},
    coverage: null,
    generated: 0,
    activated: 0,
    reply: false,
    totalNeurons: 0,
    bootstrapState: null,
    mode: "chat",
    classifier: null,
    premiumRulePath: null,
    activation: null,
    feedbackSummary: null,
    neuronSuggestionAnalysis: null,
    hasSuggestion: false,
    suggestionReasons: [],
    manualOverrideUsed: false,
    premiumForced: false,
    premiumForcedSuccess: false,
    premiumForcedFailure: null,
    generatedBy: "policy",
    selection: null,
    bridgeSuggestion: null,
  };
}

export function addStep(trace, step, meta = null) {
  const entry = { step, ts: Date.now() - trace.startedAt };
  if (meta !== null && meta !== undefined) entry.meta = meta;
  trace.steps.push(entry);
  if (isDevMode()) console.log(`[NeuroChat trace] ${step}`, meta ?? "");
}

export function recordTiming(trace, label, ms) {
  trace.timing[label] = Math.round(ms);
}

export function finalizeTrace(trace) {
  trace.timing.total = Date.now() - trace.startedAt;
  if (isDevMode()) {
    console.group("[NeuroChat trace] Resumen");
    console.log("Pasos:", trace.steps);
    console.log("Timing:", trace.timing);
    console.log("Coverage:", trace.coverage);
    console.log("Bootstrap:", trace.bootstrapState);
    console.log("Feedback summary:", trace.feedbackSummary);
    console.groupEnd();
  }
  return {
    coverage: trace.coverage,
    steps: trace.steps,
    timing: trace.timing,
    activated: trace.activated,
    generated: trace.generated,
    sessionId: trace.sessionId,
    totalNeurons: trace.totalNeurons,
    bootstrapState: trace.bootstrapState,
    mode: trace.mode,
    classifier: trace.classifier,
    premiumRulePath: trace.premiumRulePath,
    activation: trace.activation,
    feedbackSummary: trace.feedbackSummary,
    neuronSuggestionAnalysis: trace.neuronSuggestionAnalysis,
    hasSuggestion: trace.hasSuggestion,
    suggestionReasons: trace.suggestionReasons,
    manualOverrideUsed: trace.manualOverrideUsed,
    premiumForced: trace.premiumForced,
    premiumForcedSuccess: trace.premiumForcedSuccess,
    premiumForcedFailure: trace.premiumForcedFailure,
    generatedBy: trace.generatedBy,
    selection: trace.selection,
    bridgeSuggestion: trace.bridgeSuggestion,
  };
}

export function setDevMode(on) {
  try { localStorage.setItem(DEV_MODE_KEY, on ? "true" : "false"); } catch (_e) {}
  console.log(`[NeuroChat] Modo dev: ${on ? "ACTIVO" : "inactivo"}`);
}

/**
 * neurochat.js — Lógica de estado y sesión del módulo NeuroChat
 */

import { processNeuroInput } from "../neuro/neurocore.js";
import { getAllNeurons, saveNeuron, deleteNeuron } from "../neuro/neuronStore.js";
import { createNeuron } from "../neuro/schemas.js";
import { getMessageFeedbackMap, recordNeuronFeedback } from "../neuro/feedback.js";

const HISTORY_KEY = "memorycarl_neurochat_history";
const MAX_HISTORY = 50;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
}

function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); }
  catch (_e) {}
}

let _history = null;
const manualOverrideState = new Map();
function getHistory() {
  if (!_history) _history = loadHistory();
  return _history;
}

function appendMessage(role, content, meta = {}) {
  const msg = { role, content, ts: Date.now(), ...meta };
  getHistory().push(msg);
  saveHistory(getHistory());
  return msg;
}

function generateMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function sendMessage(userInput, options = {}) {
  const trimmed = (userInput || "").trim();
  if (!trimmed) throw new Error("Input vacío");
  const mode = options.mode || "chat";
  const interpretationMode = options.interpretationMode || "default";

  const messageId = generateMessageId();
  appendMessage("user", trimmed, { mode, interpretationMode, messageId });

  const result = await processNeuroInput(trimmed, {
    history: getHistory().slice(-10),
    mode,
    interpretationMode,
    premiumOptions: options.premiumOptions,
    messageId,
  });

  appendMessage("assistant", result.reply, {
    messageId,
    activated: result.activated.length,
    generated: result.generated.length,
    coverage: result.missingAnalysis.coverage,
    mode,
    interpretationMode,
    bootstrapLevel: result.bootstrapState?.level,
    premiumUsed: result.premiumDecision?.usePremium || false,
    generatedBy: result.generatedBy || "policy",
    manualOverrideUsed: Boolean(result.manualOverrideUsed),
  });

  return {
    ...result,
    messageId,
    feedbackForMessage: getMessageFeedbackMap(messageId),
  };
}

export async function forcePremiumGenerationForMessage(messageId, options = {}) {
  if (!messageId) throw new Error("messageId requerido");
  if (manualOverrideState.get(messageId) === "running") throw new Error("Override ya en progreso para este mensaje");
  if (manualOverrideState.get(messageId) === "done" && !options.allowRetry) {
    throw new Error("Override ya ejecutado para este mensaje");
  }

  const userMessage = [...getHistory()].reverse().find((m) => m.role === "user" && m.messageId === messageId);
  if (!userMessage) throw new Error("No se encontró el mensaje del usuario para forzar premium");

  manualOverrideState.set(messageId, "running");
  try {
    const result = await processNeuroInput(userMessage.content, {
      history: getHistory().slice(-10),
      mode: userMessage.mode || options.mode || "chat",
      interpretationMode: userMessage.interpretationMode || options.interpretationMode || "default",
      premiumOptions: options.premiumOptions,
      messageId,
      manualPremiumOverride: true,
      forceGeneration: true,
    });

    appendMessage("assistant", result.reply, {
      messageId,
      overrideOf: messageId,
      override: true,
      premiumUsed: Boolean(result.premiumForcedSuccess || result.premiumDecision?.usePremium),
      generatedBy: result.generatedBy || "manual_override",
      premiumForcedSuccess: Boolean(result.premiumForcedSuccess),
      mode: userMessage.mode || "chat",
      interpretationMode: userMessage.interpretationMode || "default",
      coverage: result.missingAnalysis?.coverage,
      activated: result.activated.length,
      generated: result.generated.length,
    });

    manualOverrideState.set(messageId, "done");
    return result;
  } catch (err) {
    manualOverrideState.delete(messageId);
    throw err;
  }
}

export function submitNeuronFeedback({ neuronId, feedback, messageId, inputPreview = "" }) {
  return recordNeuronFeedback({ neuronId, feedback, messageId, inputPreview });
}

export function getChatHistory() { return getHistory(); }
export function clearChatHistory() { _history = []; saveHistory([]); }
export function getNeurons() { return getAllNeurons(); }
export function addNeuron(data) { return saveNeuron(createNeuron(data)); }
export function removeNeuron(id) { return deleteNeuron(id); }

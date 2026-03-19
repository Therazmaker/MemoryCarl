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
  });

  return {
    ...result,
    messageId,
    feedbackForMessage: getMessageFeedbackMap(messageId),
  };
}

export function submitNeuronFeedback({ neuronId, feedback, messageId, inputPreview = "" }) {
  return recordNeuronFeedback({ neuronId, feedback, messageId, inputPreview });
}

export function getChatHistory() { return getHistory(); }
export function clearChatHistory() { _history = []; saveHistory([]); }
export function getNeurons() { return getAllNeurons(); }
export function addNeuron(data) { return saveNeuron(createNeuron(data)); }
export function removeNeuron(id) { return deleteNeuron(id); }

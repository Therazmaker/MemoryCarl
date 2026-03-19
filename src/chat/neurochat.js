/**
 * neurochat.js — Lógica de estado y sesión del módulo NeuroChat
 */

import { processNeuroInput } from "../neuro/neurocore.js";
import { getAllNeurons, saveNeuron, deleteNeuron } from "../neuro/neuronStore.js";
import { createNeuron } from "../neuro/schemas.js";

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

export async function sendMessage(userInput, options = {}) {
  const trimmed = (userInput || "").trim();
  if (!trimmed) throw new Error("Input vacío");
  const mode = options.mode || "chat";

  appendMessage("user", trimmed, { mode });

  const result = await processNeuroInput(trimmed, {
    history: getHistory().slice(-10),
    mode,
    premiumOptions: options.premiumOptions,
  });

  appendMessage("assistant", result.reply, {
    activated: result.activated.length,
    generated: result.generated.length,
    coverage: result.missingAnalysis.coverage,
    mode,
    bootstrapLevel: result.bootstrapState?.level,
    premiumUsed: result.premiumDecision?.usePremium || false,
  });

  return result;
}

export function getChatHistory() { return getHistory(); }
export function clearChatHistory() { _history = []; saveHistory([]); }
export function getNeurons() { return getAllNeurons(); }
export function addNeuron(data) { return saveNeuron(createNeuron(data)); }
export function removeNeuron(id) { return deleteNeuron(id); }

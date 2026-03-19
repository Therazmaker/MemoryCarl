/**
 * neurochat.js — Lógica de estado y sesión del módulo NeuroChat
 * MemoryCarl
 *
 * Gestiona el historial de conversación, llama al motor neurocore
 * y expone una API limpia para la UI.
 */

import { processNeuroInput } from "../neuro/neurocore.js";
import { getAllNeurons, saveNeuron, deleteNeuron } from "../neuro/neuronStore.js";
import { createNeuron } from "../neuro/schemas.js";

const HISTORY_KEY = "memorycarl_neurochat_history";
const MAX_HISTORY  = 50;

// ---- Historial de conversación ----

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

// ---- Sesión activa ----

let _history = null; // se inicializa lazy

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

// ---- API pública ----

/**
 * Envía un mensaje del usuario y devuelve la respuesta completa del sistema.
 *
 * @param {string} userInput
 * @returns {Promise<NeuroChatResult>}
 */
export async function sendMessage(userInput) {
  const trimmed = (userInput || "").trim();
  if (!trimmed) throw new Error("Input vacío");

  // Registrar mensaje del usuario
  appendMessage("user", trimmed);

  // Procesar con el motor
  const result = await processNeuroInput(trimmed, {
    history: getHistory().slice(-10),
  });

  // Registrar respuesta del sistema
  appendMessage("assistant", result.reply, {
    activated: result.activated.length,
    generated: result.generated.length,
    coverage:  result.missingAnalysis.coverage,
  });

  return result;
}

/**
 * Devuelve el historial completo de conversación.
 * @returns {ChatMessage[]}
 */
export function getChatHistory() {
  return getHistory();
}

/**
 * Limpia el historial de conversación.
 */
export function clearChatHistory() {
  _history = [];
  saveHistory([]);
}

/**
 * Devuelve todas las neuronas almacenadas.
 * @returns {Neuron[]}
 */
export function getNeurons() {
  return getAllNeurons();
}

/**
 * Crea y guarda una neurona manualmente.
 * @param {Partial<Neuron>} data
 * @returns {Neuron|null}
 */
export function addNeuron(data) {
  return saveNeuron(createNeuron(data));
}

/**
 * Elimina una neurona por ID.
 * @param {string} id
 * @returns {boolean}
 */
export function removeNeuron(id) {
  return deleteNeuron(id);
}

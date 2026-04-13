/**
 * neurochat.js — Lógica de estado y sesión del módulo NeuroChat
 */

import { processNeuroInput } from "../neuro/neurocore.js";
import { getAllNeurons, saveNeuron, deleteNeuron } from "../neuro/neuronStore.js";
import { neuroProbe } from "./neuroprobe.js";
import { createNeuron } from "../neuro/schemas.js";
import { getMessageFeedbackMap, recordNeuronFeedback, recordNeuronRemoval } from "../neuro/feedback.js";
import { saveMemory, getAllMemories, searchMemories, detectMemoryEmotion, extractMemoryTags, inferMemoryDate, getMemoriesByNeuron } from "../memory/memoryStore.js";
import { getInsightHistory } from "../neuro/insightHistory.js";
import { appendToCurrentDay, linkDayToNeurons, getCurrentDay } from "../day/dayStore.js";

const HISTORY_KEY = "memorycarl_neurochat_history";
const DB_NAME = "memorycarl_chat";
const DB_VERSION = 1;
const STORE_NAME = "messages";
const MAX_HISTORY_LS = 50;
const MAX_HISTORY_IDB = 5000;

let _db = null;
let _history = null;
const manualOverrideState = new Map();
let _seededFromLocalStorage = false;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
}

function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY_LS))); }
  catch (_e) {}
}

function getHistory() {
  if (!_history) _history = loadHistory();
  return _history;
}

async function openDb() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB no disponible");
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "ts" });
        store.createIndex("role", "role");
      }
    };
    req.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };
    req.onerror = (event) => reject(event.target.error);
  });
}

async function loadHistoryFromIdb() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function clearHistoryIdb() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (_err) {
    // noop
  }
}

async function saveMessageToIdb(msg) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(msg);

    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result <= MAX_HISTORY_IDB) return;
      let toDelete = countReq.result - MAX_HISTORY_IDB;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || toDelete <= 0) return;
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
    };
  } catch (err) {
    console.warn("[neurochat] IndexedDB write failed:", err);
  }
}

async function seedIdbFromLocalStorageIfNeeded() {
  if (_seededFromLocalStorage) return;
  _seededFromLocalStorage = true;
  try {
    const existing = await loadHistoryFromIdb();
    if (existing.length > 0) return;
    const local = loadHistory();
    if (!local.length) return;
    for (const msg of local) {
      await saveMessageToIdb(msg);
    }
  } catch (_err) {
    // noop
  }
}

function appendMessage(role, content, meta = {}) {
  const msg = { role, content, ts: Date.now(), ...meta };
  getHistory().push(msg);
  saveHistory(getHistory());
  void saveMessageToIdb(msg);
  return msg;
}

function generateMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function detectImportantMemoryInput(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return { suggestSave: false, score: 0, reasons: [] };
  const lower = raw.toLowerCase();
  let score = 0;
  const reasons = [];

  if (raw.length >= 90) {
    score += 0.2;
    reasons.push("mensaje largo");
  }
  const cues = ["hoy", "ayer", "cuando", "recuerdo", "me pasó", "importante", "aprendí", "decidí", "logré"];
  if (cues.some((cue) => lower.includes(cue))) {
    score += 0.45;
    reasons.push("narrativa autobiográfica");
  }
  if (detectMemoryEmotion(raw) !== "neutral") {
    score += 0.25;
    reasons.push("carga emocional");
  }
  if (/(cumplí|gradu|nací|primer|boda|hijo|hija|mud|trabajo nuevo)/i.test(raw)) {
    score += 0.3;
    reasons.push("evento hito");
  }
  return {
    suggestSave: score >= 0.55,
    score: Number(Math.min(1, score).toFixed(2)),
    reasons,
  };
}

export async function sendMessage(userInput, options = {}) {
  const trimmed = (userInput || "").trim();
  if (!trimmed) throw new Error("Input vacío");
  const mode = options.mode || "chat";
  const interpretationMode = options.interpretationMode || "default";

  const messageId = generateMessageId();
  const userMsg = appendMessage("user", trimmed, { mode, interpretationMode, messageId });

  // Guardar mensaje del usuario en el día actual
  try { appendToCurrentDay(userMsg); } catch (_e) {}

  const result = await processNeuroInput(trimmed, {
    history: getHistory().slice(-10),
    mode,
    interpretationMode,
    premiumOptions: options.premiumOptions,
    messageId,
  });

  const activatedNeuronIds = (result.activated || []).map((a) => a.neuron?.id).filter(Boolean);
  const assistantMsg = appendMessage("assistant", result.reply, {
    messageId,
    activated: result.activated.length,
    activatedNeuronIds,
    generated: result.generated.length,
    coverage: result.missingAnalysis.coverage,
    mode,
    interpretationMode,
    bootstrapLevel: result.bootstrapState?.level,
    premiumUsed: result.premiumDecision?.usePremium || false,
    generatedBy: result.generatedBy || "policy",
    manualOverrideUsed: Boolean(result.manualOverrideUsed),
    memoryRecall: (result.memoryRecall || []).map((entry) => ({
      id: entry.memory?.id,
      title: entry.memory?.title || "Memoria sin título",
      date: entry.memory?.date || entry.memory?.temporal?.date || "—",
      emotion: entry.memory?.emotion || "neutral",
      score: entry.score,
      insight: entry.insight,
      snippet: entry.snippet,
    })),
    memoryRecallIds: (result.memoryRecall || []).map((entry) => entry.memory?.id).filter(Boolean),
  });

  // Guardar respuesta del asistente en el día actual y vincular neuronas activadas
  try {
    appendToCurrentDay(assistantMsg);
    if (activatedNeuronIds.length > 0) {
      const day = getCurrentDay();
      if (day) linkDayToNeurons(day.id, activatedNeuronIds);
    }
  } catch (_e) {}

  return {
    ...result,
    messageId,
    memorySuggestion: result.memorySuggestion?.suggestSave
      ? result.memorySuggestion
      : detectImportantMemoryInput(trimmed),
    feedbackForMessage: getMessageFeedbackMap(messageId),
    probeQuestion: (() => {
      neuroProbe.observe({
        activated: result.activated || [],
        generated: result.generated || [],
        userInput: trimmed,
        history: getHistory().slice(-6),
      });
      return neuroProbe.getPendingQuestion();
    })(),
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

export function submitNeuronRemoval({ neuronId, messageId = null }) {
  return recordNeuronRemoval({ neuronId, messageId });
}

export async function getFullChatHistory() {
  const history = await loadHistoryFromIdb();
  if (history.length > 0) return history;
  return loadHistory();
}

export function getChatHistory() {
  void seedIdbFromLocalStorageIfNeeded();
  return getHistory();
}

export function clearChatHistory() {
  _history = [];
  saveHistory([]);
  void clearHistoryIdb();
}
export function getNeurons() { return getAllNeurons(); }
export function addNeuron(data) { return saveNeuron(createNeuron(data)); }
export function removeNeuron(id) { return deleteNeuron(id); }

export function saveMemoryFromMessage(messageId, options = {}) {
  const history = getHistory();
  const userMessage = [...history].reverse().find((m) => m.role === "user" && (!messageId || m.messageId === messageId));
  if (!userMessage) throw new Error("No se encontró un mensaje de usuario para guardar");
  const assistantMessage = [...history].reverse().find((m) => m.role === "assistant" && m.messageId === userMessage.messageId);
  const linkedNeurons = assistantMessage?.activatedNeuronIds || [];
  const text = userMessage.content || "";
  const memory = saveMemory({
    title: options.title || text.slice(0, 72),
    text,
    date: inferMemoryDate(text),
    emotion: detectMemoryEmotion(text),
    tags: extractMemoryTags(text),
    context: options.context || `neurochat:${userMessage.mode || "chat"}`,
    importance: options.importance || "medium",
    linkedNeurons,
    source: options.source || "chat",
    temporal: options.temporal || { stage: "present", date: inferMemoryDate(text), timeContext: "historical" },
    isMilestone: Boolean(options.isMilestone),
  });
  return memory;
}

export function getMemories(options = {}) {
  const q = String(options.query || "").trim();
  return q ? searchMemories(q, options.filters || {}) : getAllMemories({ filters: options.filters || {} });
}

export function getMemoryContextByNeuron(neuronId) {
  const memories = getMemoriesByNeuron(neuronId);
  const insightHistory = getInsightHistory({ maxHistory: 120 });
  return {
    neuronId,
    memories,
    insights: insightHistory.filter((i) => (i.basedOnNeurons || []).includes(neuronId)).slice(-10),
  };
}

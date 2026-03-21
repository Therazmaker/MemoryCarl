import {
  normalizeMemory as normalizeMemoryRecord,
  inferMemoryEmotion,
  inferMemoryImportance,
  extractSemanticTags,
  dedupeMemoryInsights,
  compressRelatedInsights,
  resolveLinkedNeuronDisplay,
  repairMemoryLinks,
  autoFixMemoryRecord,
  normalizeMemoryTags,
  dedupeMemoryTags,
  suggestMemoryMilestone,
} from "./memoryNormalizer.js";
import { getAllNeurons } from "../neuro/neuronStore.js";

const MEMORY_KEY = "memorycarl_memories_v1";

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : (parsed ?? fallback);
  } catch (_e) {
    return fallback;
  }
}

function readMemories() {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(MEMORY_KEY) || "[]", []);
}

function writeMemories(memories) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
}

function normalizeImportance(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeStage(value) {
  const stage = String(value || "").trim().toLowerCase();
  return stage || "unknown";
}

function uniqueStrings(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || "").trim()).filter(Boolean))];
}

function generateId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function normalizeTemporal(temporal = {}, fallbackDate) {
  if (!temporal || typeof temporal !== "object") {
    return { stage: "unknown", timeContext: "historical", date: fallbackDate || toIsoDate() };
  }
  return {
    stage: normalizeStage(temporal.stage),
    timeContext: String(temporal.timeContext || "historical").trim() || "historical",
    date: String(temporal.date || fallbackDate || toIsoDate()).trim() || toIsoDate(),
  };
}

function normalizeMemory(memory = {}, options = {}) {
  const text = String(memory.text || "").trim();
  const date = String(memory.date || inferMemoryDate(text)).trim() || toIsoDate();
  const createdAt = Number(memory.createdAt) || Date.now();
  const title = String(memory.title || text.slice(0, 72)).trim();
  const source = String(memory.source || "chat").trim() || "chat";
  const context = String(memory.context || "chat").trim() || "chat";
  const normalizedByRules = normalizeMemoryRecord({ ...memory, text, title }, { ...options, neurons: options.neurons || getAllNeurons() });

  return {
    id: memory.id || generateId(),
    date,
    title: title || "Memoria sin título",
    text,
    emotion: String(normalizedByRules.emotion || memory.emotion || "neutral").trim() || "neutral",
    context,
    importance: normalizeImportance(normalizedByRules.importance || memory.importance),
    tags: dedupeMemoryTags(normalizeMemoryTags(normalizedByRules.tags || memory.tags || [])),
    linkedNeurons: uniqueStrings(normalizedByRules.linkedNeurons || memory.linkedNeurons || []),
    linkedNeuronDisplay: Array.isArray(normalizedByRules.linkedNeuronDisplay) ? normalizedByRules.linkedNeuronDisplay : [],
    relatedInsights: compressRelatedInsights(memory.relatedInsights || []),
    source,
    temporal: normalizeTemporal(memory.temporal, date),
    createdAt,
    isMilestone: Boolean(normalizedByRules.isMilestone),
  };
}

function applyFilters(memories = [], filters = {}) {
  const emotion = String(filters.emotion || "").trim().toLowerCase();
  const importance = String(filters.importance || "").trim().toLowerCase();
  const stage = String(filters.stage || "").trim().toLowerCase();
  const tagList = uniqueStrings(filters.tags || []).map((t) => t.toLowerCase());
  const dateFrom = String(filters.dateFrom || "").trim();
  const dateTo = String(filters.dateTo || "").trim();

  return memories.filter((m) => {
    if (emotion && String(m.emotion || "").toLowerCase() !== emotion) return false;
    if (importance && String(m.importance || "").toLowerCase() !== importance) return false;
    if (stage && String(m.temporal?.stage || "").toLowerCase() !== stage) return false;
    if (tagList.length > 0) {
      const memoryTags = (m.tags || []).map((t) => String(t || "").toLowerCase());
      if (!tagList.every((t) => memoryTags.includes(t))) return false;
    }
    if (dateFrom && String(m.date || "") < dateFrom) return false;
    if (dateTo && String(m.date || "") > dateTo) return false;
    return true;
  });
}

export function detectMemoryEmotion(text = "") {
  return inferMemoryEmotion({ text });
}

export function extractMemoryTags(text = "") {
  return extractSemanticTags(text);
}

export function inferMemoryDate(text = "", now = new Date()) {
  const lower = String(text).toLowerCase();
  const d = new Date(now);
  if (lower.includes("antes de ayer")) {
    d.setDate(d.getDate() - 2);
    return toIsoDate(d);
  }
  if (lower.includes("ayer")) {
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }
  if (lower.includes("mañana")) {
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }
  return toIsoDate(d);
}

export function saveMemory(memory = {}, options = {}) {
  const memories = readMemories();
  const record = normalizeMemory(memory, options);

  if (!record.text) throw new Error("No se puede guardar una memoria vacía");

  const idx = memories.findIndex((m) => m.id === record.id);
  if (idx >= 0) memories[idx] = record;
  else memories.push(record);

  memories.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
  writeMemories(memories);
  return record;
}

export function updateMemory(memoryId, updates = {}, options = {}) {
  if (!memoryId) throw new Error("memoryId requerido");
  const memories = readMemories();
  const idx = memories.findIndex((m) => m.id === memoryId);
  if (idx < 0) throw new Error("Memoria no encontrada");
  const merged = normalizeMemory({
    ...memories[idx],
    ...updates,
    id: memoryId,
    createdAt: memories[idx].createdAt,
  }, options);
  if (!merged.text) throw new Error("No se puede guardar una memoria vacía");
  memories[idx] = merged;
  memories.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
  writeMemories(memories);
  return merged;
}

export function autoFixMemory(memoryId, options = {}) {
  const neurons = options.neurons || getAllNeurons();
  const memories = readMemories();
  const idx = memories.findIndex((m) => m.id === memoryId);
  if (idx < 0) throw new Error("Memoria no encontrada");
  const fixed = autoFixMemoryRecord(memories[idx], { ...options, neurons });
  const merged = normalizeMemory({ ...fixed, id: memoryId, createdAt: memories[idx].createdAt }, { ...options, neurons });
  memories[idx] = merged;
  writeMemories(memories);
  return merged;
}

export function deleteMemory(memoryId) {
  if (!memoryId) throw new Error("memoryId requerido");
  const memories = readMemories();
  const idx = memories.findIndex((m) => m.id === memoryId);
  if (idx < 0) return false;
  memories.splice(idx, 1);
  writeMemories(memories);
  return true;
}

export function getAllMemories(options = {}) {
  const base = readMemories();
  const filters = options.filters || {};
  const withFix = options.autoFix === true;
  const filtered = applyFilters(base, filters);
  if (!withFix) return filtered;
  const neurons = options.neurons || getAllNeurons();
  return filtered.map((m) => autoFixMemoryRecord(m, { neurons }));
}

export function searchMemories(query = "", filters = {}) {
  const q = String(query || "").toLowerCase().trim();
  const filtered = applyFilters(readMemories(), filters);
  if (!q) return filtered;
  return filtered.filter((m) => {
    const bucket = [m.title, m.text, m.context, m.emotion, m.date, m.importance, m.temporal?.stage, ...(m.tags || [])].join(" ").toLowerCase();
    return bucket.includes(q);
  });
}

export function linkMemoryToNeurons(memoryId, neuronIds = []) {
  if (!memoryId) throw new Error("memoryId requerido");
  const memories = readMemories();
  const idx = memories.findIndex((m) => m.id === memoryId);
  if (idx < 0) throw new Error("Memoria no encontrada");
  memories[idx].linkedNeurons = uniqueStrings([...(memories[idx].linkedNeurons || []), ...neuronIds]);
  memories[idx].linkedNeuronDisplay = resolveLinkedNeuronDisplay(memories[idx], getAllNeurons());
  writeMemories(memories);
  return memories[idx];
}

export function unlinkNeuronFromMemories(neuronId) {
  if (!neuronId) return 0;
  const memories = readMemories();
  let changed = 0;
  const allNeurons = getAllNeurons();
  for (let i = 0; i < memories.length; i++) {
    const nextLinked = (memories[i].linkedNeurons || []).filter((id) => id !== neuronId);
    if (nextLinked.length !== (memories[i].linkedNeurons || []).length) {
      memories[i] = {
        ...memories[i],
        linkedNeurons: nextLinked,
        linkedNeuronDisplay: resolveLinkedNeuronDisplay({ ...memories[i], linkedNeurons: nextLinked }, allNeurons),
      };
      changed++;
    }
  }
  if (changed > 0) writeMemories(memories);
  return changed;
}

export function repairAllMemoryLinks(neurons = getAllNeurons()) {
  const memories = readMemories();
  const fixed = memories.map((m) => {
    const repaired = repairMemoryLinks(m, neurons);
    return {
      ...repaired,
      linkedNeuronDisplay: resolveLinkedNeuronDisplay(repaired, neurons),
      relatedInsights: dedupeMemoryInsights(m.relatedInsights || []),
    };
  });
  writeMemories(fixed);
  return fixed;
}

export function getMemoriesByNeuron(neuronId) {
  if (!neuronId) return [];
  return readMemories().filter((m) => (m.linkedNeurons || []).includes(neuronId));
}

export {
  normalizeMemoryRecord as normalizeMemory,
  inferMemoryEmotion,
  inferMemoryImportance,
  extractSemanticTags,
  dedupeMemoryInsights,
  compressRelatedInsights,
  resolveLinkedNeuronDisplay,
  repairMemoryLinks,
  autoFixMemoryRecord,
  normalizeMemoryTags,
  dedupeMemoryTags,
  suggestMemoryMilestone,
};

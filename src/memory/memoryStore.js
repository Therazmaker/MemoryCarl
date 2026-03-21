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

function normalizeMemory(memory = {}) {
  const text = String(memory.text || "").trim();
  const date = String(memory.date || inferMemoryDate(text)).trim() || toIsoDate();
  const createdAt = Number(memory.createdAt) || Date.now();
  const title = String(memory.title || text.slice(0, 72)).trim();
  const source = String(memory.source || "chat").trim() || "chat";
  const context = String(memory.context || "chat").trim() || "chat";

  return {
    id: memory.id || generateId(),
    date,
    title: title || "Memoria sin título",
    text,
    emotion: String(memory.emotion || detectMemoryEmotion(text)).trim() || "neutral",
    context,
    importance: normalizeImportance(memory.importance),
    tags: uniqueStrings(memory.tags || extractMemoryTags(text)),
    linkedNeurons: uniqueStrings(memory.linkedNeurons || []),
    source,
    temporal: normalizeTemporal(memory.temporal, date),
    createdAt,
    isMilestone: Boolean(memory.isMilestone),
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
  const lower = String(text).toLowerCase();
  const rules = [
    { emotion: "joy", words: ["feliz", "alegre", "emocionado", "agradecido", "orgulloso"] },
    { emotion: "sadness", words: ["triste", "llor", "deprim", "vacío", "nostalgia"] },
    { emotion: "anger", words: ["enoj", "furia", "rabia", "molest", "odio"] },
    { emotion: "fear", words: ["miedo", "ansiedad", "pánico", "nervios", "asust"] },
    { emotion: "surprise", words: ["sorpr", "increíble", "inesperado", "wow"] },
    { emotion: "love", words: ["amor", "te quiero", "abrazo", "cariño"] },
  ];

  for (const rule of rules) {
    if (rule.words.some((w) => lower.includes(w))) return rule.emotion;
  }
  return "neutral";
}

export function extractMemoryTags(text = "") {
  const words = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  const stop = new Set(["para", "porque", "aunque", "sobre", "desde", "hasta", "donde", "cuando", "estaba", "estuve", "tengo", "tenía", "ayer", "hoy"]);
  return [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 8);
}

export function inferMemoryDate(text = "", now = new Date()) {
  const lower = String(text).toLowerCase();
  const d = new Date(now);
  if (lower.includes("ayer")) {
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }
  if (lower.includes("antes de ayer")) {
    d.setDate(d.getDate() - 2);
    return toIsoDate(d);
  }
  if (lower.includes("mañana")) {
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }
  return toIsoDate(d);
}

export function saveMemory(memory = {}) {
  const memories = readMemories();
  const record = normalizeMemory(memory);

  if (!record.text) throw new Error("No se puede guardar una memoria vacía");

  const idx = memories.findIndex((m) => m.id === record.id);
  if (idx >= 0) memories[idx] = record;
  else memories.push(record);

  memories.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
  writeMemories(memories);
  return record;
}

export function updateMemory(memoryId, updates = {}) {
  if (!memoryId) throw new Error("memoryId requerido");
  const memories = readMemories();
  const idx = memories.findIndex((m) => m.id === memoryId);
  if (idx < 0) throw new Error("Memoria no encontrada");
  const merged = normalizeMemory({
    ...memories[idx],
    ...updates,
    id: memoryId,
    createdAt: memories[idx].createdAt,
  });
  if (!merged.text) throw new Error("No se puede guardar una memoria vacía");
  memories[idx] = merged;
  memories.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
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
  return applyFilters(base, options.filters || {});
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
  writeMemories(memories);
  return memories[idx];
}

export function getMemoriesByNeuron(neuronId) {
  if (!neuronId) return [];
  return readMemories().filter((m) => (m.linkedNeurons || []).includes(neuronId));
}

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

function uniqueStrings(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || "").trim()).filter(Boolean))];
}

function generateId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
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
  const record = {
    id: memory.id || generateId(),
    date: memory.date || inferMemoryDate(memory.text || ""),
    text: String(memory.text || "").trim(),
    emotion: String(memory.emotion || detectMemoryEmotion(memory.text || "")).trim() || "neutral",
    context: String(memory.context || "chat").trim(),
    importance: normalizeImportance(memory.importance),
    tags: uniqueStrings(memory.tags || extractMemoryTags(memory.text || "")),
    linkedNeurons: uniqueStrings(memory.linkedNeurons || []),
    createdAt: Number(memory.createdAt) || Date.now(),
  };

  if (!record.text) throw new Error("No se puede guardar una memoria vacía");

  const idx = memories.findIndex((m) => m.id === record.id);
  if (idx >= 0) memories[idx] = record;
  else memories.push(record);

  memories.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
  writeMemories(memories);
  return record;
}

export function getAllMemories() {
  return readMemories();
}

export function searchMemories(query = "") {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return getAllMemories();
  return readMemories().filter((m) => {
    const bucket = [m.text, m.context, m.emotion, m.date, ...(m.tags || [])].join(" ").toLowerCase();
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

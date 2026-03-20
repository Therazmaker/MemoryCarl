/**
 * responsePatterns.js — Aprendizaje local de patrones de respuesta reutilizables
 * NeuroChat / MemoryCarl
 */

const RESPONSE_PATTERNS_KEY = "memorycarl_neurochat_response_patterns";
const MAX_PATTERNS = 120;
const BLOCK_ORDER = ["validacion", "conexion", "interpretacion", "insight"];

function generatePatternId() {
  return `rsp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function tokenizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 50);
}

function cleanPhrase(phrase) {
  return String(phrase || "").replace(/\s+/g, " ").trim();
}

function normalizeTopics(topics = []) {
  const seen = new Set();
  return topics
    .map((t) => cleanPhrase(t).toLowerCase())
    .filter((t) => t.length >= 3)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .slice(0, 10);
}

function detectInputType(input = "") {
  const text = String(input || "").toLowerCase();
  if (/(que\s+hago|deberia|debo|elijo|decido|decision|opcion)/.test(text)) return "decision";
  if (/\?|\bpor que\b|\bcomo\b|\bque\b|\bcuando\b/.test(text)) return "pregunta";
  if (/(siento|me siento|triste|ansioso|feliz|miedo|rabia|enojo|frustrad|emocion)/.test(text)) return "emocional";
  return "reflexivo";
}

function detectEmotion(input = "", neurons = []) {
  const lower = String(input || "").toLowerCase();
  if (/(triste|deprim|ansios|miedo|agob|mal)/.test(lower)) return "sadness";
  if (/(enoj|rabia|molest)/.test(lower)) return "anger";
  if (/(feliz|alegr|content|orgull)/.test(lower)) return "joy";
  const scored = (neurons || []).map((n) => n?.neuron || n).filter(Boolean);
  const counts = scored.reduce((acc, n) => {
    const k = String(n.emotion || "neutral");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best?.[0] || "neutral";
}

function detectTopicsFromNeurons(neurons = []) {
  const bag = [];
  for (const row of neurons) {
    const n = row?.neuron || row;
    if (!n) continue;
    if (n.core?.concept) bag.push(n.core.concept);
    if (n.core?.domain) bag.push(n.core.domain);
    for (const t of n.triggers || []) bag.push(t);
  }
  return normalizeTopics(bag);
}

function splitResponseIntoSentences(response = "") {
  return String(response || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => cleanPhrase(s))
    .filter(Boolean)
    .slice(0, 12);
}

function classifySentence(sentence = "") {
  const lower = sentence.toLowerCase();
  if (/(entiendo|es normal|te escucho|lamento|gracias por compartir|valido)/.test(lower)) return "validacion";
  if (/(tambien|cuando pasa|suele pasar|a veces|nos pasa|en esos casos)/.test(lower)) return "conexion";
  if (/(puede significar|parece que|interpreto|podria estar|quizas)/.test(lower)) return "interpretacion";
  if (/(te propongo|paso|hoy|prueba|accion|siguiente|clave|insight|recuerda)/.test(lower)) return "insight";
  return "interpretacion";
}

function inferStructure(sentences = []) {
  const byBlock = {
    validacion: [],
    conexion: [],
    interpretacion: [],
    insight: [],
  };
  for (const sentence of sentences) {
    byBlock[classifySentence(sentence)].push(sentence);
  }
  const structure = BLOCK_ORDER.filter((k) => byBlock[k].length > 0);
  return { structure, byBlock };
}

function filterReusablePhrases(byBlock = {}) {
  const out = {};
  for (const key of BLOCK_ORDER) {
    const unique = [];
    const seen = new Set();
    const phrases = byBlock[key] || [];
    for (const raw of phrases) {
      const phrase = cleanPhrase(raw);
      if (phrase.length < 12 || phrase.length > 180) continue;
      if (/\b(ayer|hoy|mañana|domingo|lunes|martes|miércoles|jueves|viernes|sábado)\b/i.test(phrase)) continue;
      if (/\b(mi hermano|tu jefe|tu pareja|juan|maria)\b/i.test(phrase)) continue;
      const norm = phrase.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      unique.push(phrase);
      if (unique.length >= 4) break;
    }
    if (unique.length > 0) out[key] = unique;
  }
  return out;
}

function inferStyle(response = "", inputType = "reflexivo") {
  const text = String(response || "");
  const sentenceCount = splitResponseIntoSentences(text).length || 1;
  const tone = /(entiendo|acompaño|gracias por compartir|te escucho)/i.test(text) ? "empatico" : "neutral";
  const directness = /(te propongo|haz|prueba|paso)/i.test(text) ? "alta" : "media";
  const depth = sentenceCount >= 4 || inputType === "reflexivo" ? "profunda" : "media";
  return { tone, depth, directness, sentenceCount };
}

function defaultPattern() {
  return {
    id: generatePatternId(),
    type: "response_pattern",
    context: {
      input_type: "reflexivo",
      topics: [],
      emotion: "neutral",
    },
    structure: [],
    phrases: {},
    style: {},
    source: {},
  };
}

export function extractResponsePattern({ input, neurons = [], response }) {
  const base = defaultPattern();
  const sentences = splitResponseIntoSentences(response);
  const { structure, byBlock } = inferStructure(sentences);
  const phrases = filterReusablePhrases(byBlock);
  const topics = detectTopicsFromNeurons(neurons);
  const inputType = detectInputType(input);

  return {
    ...base,
    context: {
      input_type: inputType,
      topics,
      emotion: detectEmotion(input, neurons),
    },
    structure: structure.length ? structure : ["interpretacion"],
    phrases,
    style: inferStyle(response, inputType),
    source: {
      provider: "gemini",
      learnedAt: new Date().toISOString(),
      inputPreview: cleanPhrase(input).slice(0, 120),
    },
  };
}

function readPatterns() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RESPONSE_PATTERNS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function writePatterns(patterns) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RESPONSE_PATTERNS_KEY, JSON.stringify(patterns.slice(-MAX_PATTERNS)));
  } catch (e) {
    console.warn("[responsePatterns] No se pudo guardar patterns", e);
  }
}

function jaccard(a = [], b = []) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  const intersect = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size || 1;
  return intersect / union;
}

function similarityScore(a, b) {
  const topicScore = jaccard(a.context?.topics || [], b.context?.topics || []);
  const emotionScore = a.context?.emotion === b.context?.emotion ? 1 : 0;
  const inputTypeScore = a.context?.input_type === b.context?.input_type ? 1 : 0;
  return (topicScore * 0.6) + (emotionScore * 0.2) + (inputTypeScore * 0.2);
}

function isDuplicate(candidate, existing) {
  if (!candidate || !existing) return false;
  const near = similarityScore(candidate, existing) >= 0.88;
  if (!near) return false;
  const cBlocks = JSON.stringify(candidate.structure || []);
  const eBlocks = JSON.stringify(existing.structure || []);
  return cBlocks === eBlocks;
}

export function saveResponsePattern(pattern) {
  if (!pattern || pattern.type !== "response_pattern") return null;
  const all = readPatterns();
  if (all.some((p) => isDuplicate(pattern, p))) return null;
  all.push(pattern);
  writePatterns(all);
  return pattern;
}

export function getAllPatterns() {
  return readPatterns();
}

export function findMatchingPattern({ inputType, topics = [], emotion }) {
  const query = {
    context: {
      input_type: inputType || "reflexivo",
      topics: normalizeTopics(topics),
      emotion: emotion || "neutral",
    },
  };

  return readPatterns()
    .map((p) => ({ pattern: p, score: similarityScore(query, p) }))
    .sort((a, b) => b.score - a.score);
}

function inferQuery(input, neurons = []) {
  return {
    inputType: detectInputType(input),
    topics: detectTopicsFromNeurons(neurons).concat(tokenizeText(input).slice(0, 6)),
    emotion: detectEmotion(input, neurons),
  };
}

export function findBestPattern(input, neurons = []) {
  const query = inferQuery(input, neurons);
  const ranked = findMatchingPattern(query);
  const best = ranked[0] || null;
  if (!best) return null;
  return {
    ...best,
    query,
    isGoodMatch: best.score >= 0.55,
  };
}

function pickRandom(list = [], avoid = "") {
  if (!Array.isArray(list) || list.length === 0) return "";
  const cleanAvoid = cleanPhrase(avoid).toLowerCase();
  const filtered = list.filter((p) => cleanPhrase(p).toLowerCase() !== cleanAvoid);
  const source = filtered.length ? filtered : list;
  return source[Math.floor(Math.random() * source.length)] || "";
}

export function buildResponseFromPattern(pattern, input = "") {
  if (!pattern || pattern.type !== "response_pattern") return "";
  const built = [];
  let prev = "";

  for (const block of pattern.structure || []) {
    const phrase = pickRandom(pattern.phrases?.[block] || [], prev);
    if (!phrase) continue;
    built.push(phrase);
    prev = phrase;
  }

  if (built.length === 0) return "";
  const suffix = pattern.style?.directness === "alta"
    ? "Si quieres, lo convertimos en un plan de 1 paso ahora."
    : "Si te sirve, puedo profundizar en esto contigo.";

  const response = `${built.join(" ")} ${suffix}`.trim();
  if (cleanPhrase(response).toLowerCase() === cleanPhrase(input).toLowerCase()) return `${response} ¿Cómo lo estás viviendo tú?`;
  return response;
}

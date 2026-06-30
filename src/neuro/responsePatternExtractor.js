const CONTEXTUAL_WORDS_REGEX = /\b(hoy|esta vez|en este momento)\b/gi;

function normalizeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeSentence(sentence = "") {
  return String(sentence || "").replace(/\s+/g, " ").trim();
}

export function detectInputType(input = "") {
  const text = normalizeText(input);
  if (text.includes("?")) return "question";
  if (/(me senti|hoy|tuve)/.test(text)) return "emotional_reflective";
  if (/(debo|que hago)/.test(text)) return "decision";
  return "general_reflection";
}

export function extractTopics(neurons = []) {
  const seen = new Set();
  const topics = [];

  for (const row of neurons || []) {
    const neuron = row?.neuron || row;
    const concept = String(neuron?.core?.concept || "").trim().toLowerCase();
    if (!concept || seen.has(concept)) continue;
    seen.add(concept);
    topics.push(concept);
  }

  return topics;
}

export function detectEmotion(input = "") {
  const text = normalizeText(input);
  if (/(gusto|bien)/.test(text)) return "positive_soft";
  if (/(mal|frustrado)/.test(text)) return "negative";
  return "neutral";
}

export function splitSentences(response = "") {
  return String(response || "")
    .split(/[\.\n]+/)
    .map((chunk) => sanitizeSentence(chunk))
    .filter(Boolean);
}

export function classifySentence(sentence = "") {
  const text = normalizeText(sentence);
  const trimmed = text.trim();

  if (trimmed.startsWith("suena") || trimmed.startsWith("parece")) return "validation";
  if (/(se conecta|va en linea|esto conecta)/.test(text)) return "connection";
  if (/(esto refleja|hay un proceso|esto muestra)/.test(text)) return "interpretation";
  if (/(probablemente|es posible|puede ser)/.test(text)) return "insight";
  return "generic";
}

export function groupByStructure(sentences = []) {
  const grouped = {
    validation: [],
    connection: [],
    interpretation: [],
    insight: [],
    generic: [],
  };

  for (const sentence of sentences || []) {
    const clean = sanitizeSentence(sentence);
    if (!clean) continue;
    grouped[classifySentence(clean)].push(clean);
  }

  return grouped;
}

export function cleanPhrase(phrase = "") {
  const cleaned = sanitizeSentence(String(phrase || "").replace(CONTEXTUAL_WORDS_REGEX, " "));
  if (cleaned.length < 10) return "";
  return cleaned;
}

function isTooSpecific(phrase = "") {
  const text = normalizeText(phrase);
  if (/\d/.test(text)) return true;
  if (/(mi\s+|tu\s+|esta\s+semana|ayer|manana)/.test(text)) return true;
  return false;
}

export function extractReusablePhrases(grouped = {}) {
  const categories = ["validation", "connection", "interpretation", "insight", "generic"];
  const phrases = {};

  for (const category of categories) {
    const seen = new Set();
    const selected = [];
    for (const rawPhrase of grouped[category] || []) {
      const cleaned = cleanPhrase(rawPhrase);
      if (!cleaned || isTooSpecific(cleaned)) continue;
      const normalized = normalizeText(cleaned);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      selected.push(cleaned);
      if (selected.length >= 5) break;
    }
    if (selected.length > 0) phrases[category] = selected;
  }

  return phrases;
}

export function detectStyle(response = "") {
  const text = sanitizeSentence(response);
  const length = text.length;
  const sentenceCount = splitSentences(text).length;

  let depth = "medium";
  if (length < 120 || sentenceCount <= 2) depth = "light";
  if (length > 260 || sentenceCount >= 4) depth = "deep";

  let directness = "medium";
  if (/(haz|deberias|te recomiendo|paso)/i.test(text)) directness = "high";
  if (/(podria|quizas|tal vez|si quieres)/i.test(text)) directness = "low";

  return {
    tone: "reflective",
    depth,
    directness,
  };
}

function buildStructure(grouped = {}) {
  const order = ["validation", "connection", "interpretation", "insight", "generic"];
  return order.filter((key) => (grouped[key] || []).length > 0);
}

function hasUsefulPhrases(phrases = {}) {
  return ["validation", "connection", "interpretation", "insight", "generic"].some(
    (key) => Array.isArray(phrases[key]) && phrases[key].length > 0,
  );
}

export function extractResponsePattern({ input, neurons = [], response } = {}) {
  const safeResponse = String(response || "");
  if (safeResponse.trim().length < 20) return null;

  const sentences = splitSentences(safeResponse);
  const grouped = groupByStructure(sentences);
  const reusable = extractReusablePhrases(grouped);
  const structure = buildStructure(grouped);

  if (!hasUsefulPhrases(reusable)) return null;
  if (structure.length === 0) return null;

  const timestamp = Date.now();

  return {
    id: `rsp_${timestamp}`,
    type: "response_pattern",
    context: {
      input_type: detectInputType(input),
      topics: extractTopics(neurons),
      emotion: detectEmotion(input),
    },
    structure,
    phrases: {
      validation: reusable.validation || [],
      connection: reusable.connection || [],
      interpretation: reusable.interpretation || [],
      insight: reusable.insight || [],
    },
    style: detectStyle(safeResponse),
    source: {
      kind: "generated_from_gemini",
      timestamp,
    },
  };
}

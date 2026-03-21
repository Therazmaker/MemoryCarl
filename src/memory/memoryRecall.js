const WEIGHTS = {
  neuronOverlap: 0.4,
  tagOverlap: 0.2,
  emotionSimilarity: 0.2,
  semanticSimilarity: 0.2,
};

export const MEMORY_RECALL_THRESHOLD = 0.65;
export const MEMORY_RECALL_MAX = 3;

function uniqueLowerTokens(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean))];
}

function tokenize(text = "") {
  return uniqueLowerTokens(String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3));
}

function overlapRatio(listA = [], listB = []) {
  const a = uniqueLowerTokens(listA);
  const b = uniqueLowerTokens(listB);
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const shared = a.filter((v) => bSet.has(v)).length;
  return shared / Math.max(1, Math.min(a.length, b.length));
}

function detectEmotionFromText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return "neutral";

  const emotionLexicon = {
    joy: ["feliz", "alegre", "content", "emocionad", "agradecid", "logre", "orgullo"],
    sadness: ["triste", "llor", "vacio", "perdi", "duelo", "deprim"],
    fear: ["miedo", "ansiedad", "ansioso", "nerv", "preocup", "panico"],
    anger: ["enoj", "rabia", "furia", "molest", "frustr"],
    love: ["amor", "amar", "cari", "afecto", "ternura"],
    shame: ["culpa", "verguenza", "avergonz", "arrepent"],
    curiosity: ["curios", "pregunt", "explor", "descubr"],
    pride: ["orgullo", "orgullos", "logro", "avance", "super"],
  };

  for (const [emotion, tokens] of Object.entries(emotionLexicon)) {
    if (tokens.some((token) => t.includes(token))) return emotion;
  }
  return "neutral";
}

function emotionSimilarity(memoryEmotion = "neutral", inputEmotion = "neutral") {
  const m = String(memoryEmotion || "neutral").toLowerCase();
  const i = String(inputEmotion || "neutral").toLowerCase();
  if (!m || !i) return 0;
  if (m === i) return 1;
  const neighbors = {
    fear: ["sadness", "anger"],
    sadness: ["fear", "shame"],
    anger: ["fear"],
    joy: ["pride", "love"],
    pride: ["joy"],
    love: ["joy"],
    shame: ["sadness"],
    curiosity: ["neutral"],
    neutral: ["curiosity"],
  };
  if ((neighbors[m] || []).includes(i) || (neighbors[i] || []).includes(m)) return 0.45;
  return 0;
}

function buildInputContext(input = "", activatedNeurons = [], options = {}) {
  const normalizedActivated = Array.isArray(activatedNeurons) ? activatedNeurons : [];
  const neuronIds = normalizedActivated
    .map((item) => item?.neuron?.id || item?.id)
    .filter(Boolean);
  const neuronTags = normalizedActivated
    .flatMap((item) => item?.neuron?.triggers || item?.triggers || [])
    .filter(Boolean);

  const explicitTags = Array.isArray(options.inputTags) ? options.inputTags : [];
  const inputTokens = tokenize(input);

  return {
    text: String(input || ""),
    inputTokens,
    inputEmotion: options.inputEmotion || detectEmotionFromText(input),
    activeNeuronIds: uniqueLowerTokens(neuronIds),
    activeTags: uniqueLowerTokens([...explicitTags, ...inputTokens, ...neuronTags]),
    recentMemoryIds: uniqueLowerTokens(options.recentMemoryIds || []),
  };
}

export function computeMemoryRelevanceScore(memory = {}, inputContext = {}) {
  const memoryNeuronIds = uniqueLowerTokens(memory.linkedNeurons || []);
  const memoryTags = uniqueLowerTokens([...(memory.tags || []), ...tokenize(memory.title || ""), ...tokenize(memory.text || "")]);
  const memoryTokens = uniqueLowerTokens([...(memoryTags || []), ...tokenize(memory.context || "")]);

  const neuronOverlapScore = overlapRatio(memoryNeuronIds, inputContext.activeNeuronIds || []);
  const tagOverlapScore = overlapRatio(memoryTags, inputContext.activeTags || []);
  const semanticSimilarityScore = overlapRatio(memoryTokens, inputContext.inputTokens || []);
  const emotionSimilarityScore = emotionSimilarity(memory.emotion, inputContext.inputEmotion);

  const weighted =
    neuronOverlapScore * WEIGHTS.neuronOverlap +
    tagOverlapScore * WEIGHTS.tagOverlap +
    emotionSimilarityScore * WEIGHTS.emotionSimilarity +
    semanticSimilarityScore * WEIGHTS.semanticSimilarity;

  const hasNeurons = (inputContext.activeNeuronIds || []).length > 0;
  const fallbackBoost = !hasNeurons && tagOverlapScore > 0.25 ? 0.22 : 0;
  const repeatPenalty = (inputContext.recentMemoryIds || []).includes(String(memory.id || "").toLowerCase()) ? 0.25 : 0;

  const finalScore = Math.max(0, Math.min(1, weighted + fallbackBoost - repeatPenalty));

  return {
    score: Number(finalScore.toFixed(3)),
    signals: {
      neuronOverlap: Number(neuronOverlapScore.toFixed(3)),
      tagOverlap: Number(tagOverlapScore.toFixed(3)),
      emotionSimilarity: Number(emotionSimilarityScore.toFixed(3)),
      semanticSimilarity: Number(semanticSimilarityScore.toFixed(3)),
      fallbackBoost: Number(fallbackBoost.toFixed(3)),
      repeatPenalty: Number(repeatPenalty.toFixed(3)),
    },
  };
}

export function rankMemories(memories = [], inputContext = {}) {
  return (Array.isArray(memories) ? memories : [])
    .map((memory) => {
      const relevance = computeMemoryRelevanceScore(memory, inputContext);
      return {
        memory,
        score: relevance.score,
        signals: relevance.signals,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function generateMemoryInsight(memory = {}, context = {}) {
  const highlights = [];
  if ((context.signals?.neuronOverlap || 0) >= 0.5) highlights.push("se activaron neuronas parecidas");
  if ((context.signals?.tagOverlap || 0) >= 0.35) highlights.push("coinciden temas clave");
  if ((context.signals?.emotionSimilarity || 0) >= 0.45) highlights.push("la emoción es similar");
  if ((context.signals?.semanticSimilarity || 0) >= 0.35) highlights.push("el lenguaje del momento se parece");

  if (highlights.length === 0) {
    return `Hay una conexión parcial con "${memory.title || "esta memoria"}"; conviene validar si el patrón sigue vigente.`;
  }

  return `Se repite un patrón donde ${highlights.join(", ")}. Puede ayudarte revisar qué te funcionó en ese momento.`;
}

export function buildMemoryRecallSnippet(memory = {}, context = {}) {
  const date = memory.date || memory.temporal?.date || "fecha desconocida";
  const title = memory.title || "Memoria sin título";
  const emotion = memory.emotion || "neutral";
  const insight = generateMemoryInsight(memory, context);

  return `Esto se parece a un momento anterior:\n\n🕒 ${date} — ${title}\nSentías: ${emotion}\n\nPatrón:\n${insight}`;
}

export function findRelevantMemories(input, memories = [], activatedNeurons = [], options = {}) {
  const inputContext = buildInputContext(input, activatedNeurons, options);
  const threshold = Number(options.threshold ?? MEMORY_RECALL_THRESHOLD);
  const maxResults = Number(options.maxResults ?? MEMORY_RECALL_MAX);

  const ranked = rankMemories(memories, inputContext)
    .filter((entry) => entry.score >= threshold)
    .slice(0, Math.max(1, maxResults))
    .map((entry) => ({
      ...entry,
      snippet: buildMemoryRecallSnippet(entry.memory, entry),
      insight: generateMemoryInsight(entry.memory, entry),
    }));

  return {
    threshold,
    inputContext,
    ranked,
  };
}

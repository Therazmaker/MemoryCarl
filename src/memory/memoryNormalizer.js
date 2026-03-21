const EMOTIONS = new Set(["joy", "sadness", "anger", "fear", "surprise", "disgust", "curiosity", "pride", "shame", "love", "neutral", "mixed"]);

const STOP_WORDS = new Set([
  "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero", "porque", "por", "para", "sin", "con", "del", "al",
  "hoy", "ayer", "mañana", "primer", "primero", "días", "dia", "bien", "estabamos", "estábamos", "esta", "está", "fue", "era", "ser",
  "me", "mi", "mis", "tu", "tus", "su", "sus", "nos", "yo", "se", "lo", "le", "les", "que", "como", "más", "mas", "muy", "ya",
]);

const PHRASE_TAGS = [
  { pattern: /primer día sin trabajo|perd[ií] el trabajo|desemple[oa]/i, tag: "transición laboral" },
  { pattern: /no me puedo relajar|ansios|incertidumbre|inestable/i, tag: "incertidumbre" },
  { pattern: /no (sal[ií]o|sali[oó]) como esperaba|frustraci[oó]n|no avanzo|bloqueado/i, tag: "frustración" },
  { pattern: /no est[aá]bamos alineados|desalineaci[oó]n|conflicto/i, tag: "desalineación" },
  { pattern: /presi[oó]n|estr[eé]s|tensi[oó]n/i, tag: "presión" },
  { pattern: /renunci[eé]|me fui|nuevo comienzo|inicio/i, tag: "cambio" },
];

function asText(memory = {}) {
  return [memory.title, memory.text, memory.context, ...(memory.tags || [])].filter(Boolean).join(" ").trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean))];
}

function normalizeToken(token = "") {
  return String(token || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim();
}

function emotionScoreRules() {
  return {
    joy: [/feliz/i, /alegr/i, /agradecid/i, /mejor[oó]/i, /logr[eé]/i, /avance/i, /alivio/i],
    sadness: [/triste/i, /mal momento/i, /vac[ií]o/i, /duelo/i, /sin trabajo/i, /perd[ií] el trabajo/i, /llor/i],
    anger: [/enoj/i, /rabia/i, /furia/i, /frustraci[oó]n/i, /no sali[oó] como esperaba/i, /harto/i],
    fear: [/ansios/i, /miedo/i, /no me puedo relajar/i, /inestable/i, /incertidumbre/i, /p[aá]nico/i],
    surprise: [/sorpr/i, /inesperad/i, /wow/i],
    disgust: [/asco/i, /repugna/i],
    curiosity: [/curios/i, /explorar/i, /investigar/i, /quiero entender/i],
    pride: [/orgull/i, /lo logre/i, /cumpl[ií]/i],
    shame: [/verg[üu]enza/i, /culpa/i, /fall[eé]/i],
    love: [/amor/i, /te quiero/i, /cari[nñ]o/i, /afecto/i],
  };
}

export function inferMemoryEmotion(memory = {}, _options = {}) {
  const text = asText(memory);
  const normalized = normalizeToken(text);
  if (!normalized) return "neutral";

  const scores = {};
  const rules = emotionScoreRules();
  for (const [emotion, patterns] of Object.entries(rules)) {
    scores[emotion] = patterns.reduce((acc, pattern) => acc + (pattern.test(text) ? 1 : 0), 0);
  }

  if (/no me puedo relajar|ansios|inestable|miedo/i.test(text)) scores.fear += 2;
  if (/sin trabajo|perd[ií] el trabajo|primer d[ií]a sin trabajo/i.test(text)) scores.sadness += 2;
  if (/no sali[oó] como esperaba|no avanz|frustraci[oó]n|tensi[oó]n/i.test(text)) scores.anger += 2;

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) return "neutral";
  if (ranked.length > 1 && ranked[0][1] <= ranked[1][1] + 1) return "mixed";
  return EMOTIONS.has(ranked[0][0]) ? ranked[0][0] : "neutral";
}

export function suggestMemoryMilestone(memory = {}, _options = {}) {
  const text = asText(memory);
  if (!text) return false;
  return /(primer d[ií]a|inicio|[uú]ltimo d[ií]a|me fui|renunci[eé]|perd[ií] el trabajo|nuevo comienzo|ruptura|mudanza)/i.test(text);
}

export function inferMemoryImportance(memory = {}, _options = {}) {
  const text = asText(memory);
  if (!text) return "medium";
  const emotion = inferMemoryEmotion(memory);

  const highSignals = [
    /(cambio de etapa|nuevo comienzo|transici[oó]n|hito|primer d[ií]a|[uú]ltimo d[ií]a)/i,
    /(perd[ií] el trabajo|sin trabajo|renunci[eé]|despedido)/i,
    /(ruptura|conflicto|pelea|no est[aá]bamos alineados)/i,
    /\b(fergis|hermano|trabajo|dinero)\b/i,
  ];

  const highBySignal = highSignals.some((pattern) => pattern.test(text));
  const highByEmotion = emotion === "mixed" || ["sadness", "fear", "anger", "love", "pride", "shame"].includes(emotion);
  if (highBySignal || (highByEmotion && text.length > 45) || suggestMemoryMilestone(memory)) return "high";

  if (text.length < 35 && emotion === "neutral") return "low";
  return "medium";
}

export function normalizeMemoryTags(tags = []) {
  return uniqueStrings(tags)
    .map((tag) => String(tag || "").trim().toLowerCase())
    .map((tag) => tag.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .map((tag) => tag.replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim())
    .filter((tag) => tag && !STOP_WORDS.has(tag) && tag.length >= 3);
}

export function dedupeMemoryTags(tags = []) {
  const canonicalMap = new Map();
  for (const tag of normalizeMemoryTags(tags)) {
    const canonical = tag.replace(/s$/, "");
    if (!canonicalMap.has(canonical)) canonicalMap.set(canonical, tag);
  }
  return [...canonicalMap.values()];
}

export function extractSemanticTags(input, options = {}) {
  const text = typeof input === "string" ? input : asText(input || {});
  const lower = normalizeToken(text);
  if (!lower) return [];

  const tags = [];
  for (const { pattern, tag } of PHRASE_TAGS) {
    if (pattern.test(text)) tags.push(tag);
  }

  const lexicon = ["trabajo", "cambio", "incertidumbre", "frustracion", "presion", "ansiedad", "desalineacion", "fergis", "hermano", "dinero", "relacion"];
  for (const word of lexicon) {
    if (lower.includes(word)) tags.push(word.replace("frustracion", "frustración").replace("desalineacion", "desalineación"));
  }

  const rawWords = lower.split(/\s+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  tags.push(...rawWords.slice(0, 8));

  const min = options.min ?? 4;
  const max = options.max ?? 8;
  const deduped = dedupeMemoryTags(tags);
  return deduped.slice(0, Math.max(min, max));
}

function normalizeInsightText(value) {
  return normalizeToken(value).replace(/\s+/g, " ").trim();
}

export function dedupeMemoryInsights(insights = [], _options = {}) {
  const seen = new Set();
  return (Array.isArray(insights) ? insights : []).filter((insight) => {
    const baseText = normalizeInsightText(insight?.summary || insight?.title || insight?.text || "");
    const key = [String(insight?.type || ""), baseText].join("::");
    if (!baseText || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compressRelatedInsights(insights = []) {
  const groups = new Map();
  for (const insight of dedupeMemoryInsights(insights)) {
    const baseText = normalizeInsightText(insight?.summary || insight?.title || insight?.text || "");
    const pattern = baseText.split(" ").slice(0, 8).join(" ");
    const key = `${insight?.type || "generic"}::${pattern}`;
    if (!groups.has(key)) groups.set(key, insight);
  }
  return [...groups.values()];
}

export function resolveLinkedNeuronDisplay(memory = {}, neurons = []) {
  const neuronMap = new Map((Array.isArray(neurons) ? neurons : []).map((n) => [n.id, n]));
  return uniqueStrings(memory.linkedNeurons || []).map((id) => {
    const neuron = neuronMap.get(id);
    if (!neuron) return { id, concept: "neurona no encontrada", type: "unknown", missing: true };
    return {
      id,
      concept: neuron.core?.concept || id,
      type: neuron.type || "memory",
      domain: neuron.core?.domain || "general",
      missing: false,
    };
  });
}

export function repairMemoryLinks(memory = {}, neurons = []) {
  const validIds = new Set((Array.isArray(neurons) ? neurons : []).map((n) => n.id));
  const repaired = uniqueStrings(memory.linkedNeurons || []).filter((id) => validIds.has(id));
  return {
    ...memory,
    linkedNeurons: repaired,
  };
}

export function normalizeMemory(memory = {}, options = {}) {
  const tags = extractSemanticTags(memory, options);
  const emotion = inferMemoryEmotion(memory, options);
  const importance = inferMemoryImportance({ ...memory, emotion }, options);
  const milestoneSuggested = suggestMemoryMilestone(memory, options);
  return {
    ...memory,
    emotion,
    importance,
    tags,
    isMilestone: memory.isMilestone ?? milestoneSuggested,
    linkedNeurons: uniqueStrings(memory.linkedNeurons || []),
    linkedNeuronDisplay: options.neurons ? resolveLinkedNeuronDisplay(memory, options.neurons) : memory.linkedNeuronDisplay || [],
  };
}

export function autoFixMemoryRecord(memory = {}, options = {}) {
  const normalized = normalizeMemory(memory, options);
  const repaired = repairMemoryLinks(normalized, options.neurons || []);
  return {
    ...repaired,
    relatedInsights: compressRelatedInsights(memory.relatedInsights || []),
  };
}

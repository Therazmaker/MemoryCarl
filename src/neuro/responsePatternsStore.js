const RESPONSE_PATTERNS_KEY = "memorycarl_response_patterns_v2";
const MAX_PATTERNS = 180;

function readStorage() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RESPONSE_PATTERNS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeStorage(patterns = []) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RESPONSE_PATTERNS_KEY, JSON.stringify(patterns.slice(-MAX_PATTERNS)));
  } catch (error) {
    console.warn("[responsePatternsStore] save failed", error);
  }
}

function normalizeList(items = []) {
  return [...new Set((items || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizePhrasesByCategory(phrases = {}) {
  const keys = ["validation", "connection", "interpretation", "insight"];
  return keys.reduce((acc, key) => {
    acc[key] = normalizeList(phrases[key] || []);
    return acc;
  }, {});
}

function buildFingerprint(pattern) {
  const structure = JSON.stringify(pattern?.structure || []);
  const phrases = JSON.stringify(normalizePhrasesByCategory(pattern?.phrases || {}));
  return `${structure}::${phrases}`;
}

export function dedupePattern(pattern) {
  if (!pattern || pattern.type !== "response_pattern") return true;
  const all = readStorage();
  const candidate = buildFingerprint(pattern);
  return all.some((existing) => buildFingerprint(existing) === candidate);
}

export function savePattern(pattern) {
  if (!pattern || pattern.type !== "response_pattern") return null;
  if (!Array.isArray(pattern.structure) || pattern.structure.length === 0) return null;
  if (dedupePattern(pattern)) return null;

  const all = readStorage();
  all.push(pattern);
  writeStorage(all);
  return pattern;
}

export function getAllPatterns() {
  return readStorage();
}

function contextScore(pattern, context = {}) {
  const inputTypeScore = pattern?.context?.input_type === context.input_type ? 0.35 : 0;
  const emotionScore = pattern?.context?.emotion === context.emotion ? 0.25 : 0;

  const patternTopics = new Set(normalizeList(pattern?.context?.topics || []));
  const queryTopics = normalizeList(context.topics || []);
  let topicMatches = 0;
  for (const topic of queryTopics) {
    if (patternTopics.has(topic)) topicMatches += 1;
  }
  const topicScore = queryTopics.length ? (topicMatches / queryTopics.length) * 0.4 : 0;

  return inputTypeScore + emotionScore + topicScore;
}

export function findMatchingPatterns(context = {}) {
  const query = {
    input_type: String(context.input_type || "general_reflection"),
    topics: normalizeList(context.topics || []),
    emotion: String(context.emotion || "neutral"),
  };

  return readStorage()
    .map((pattern) => ({ pattern, score: Number(contextScore(pattern, query).toFixed(3)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

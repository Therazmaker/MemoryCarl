/**
 * dayAnalyzer.js — Análisis automático de días cognitivos
 * MemoryCarl
 *
 * Exporta:
 *   summarizeDay(day)
 *   inferDayEmotion(day)
 *   extractDayThemes(day)
 *   aggregateActivatedNeurons(day)
 */

// ---- Configuración interna ----

const EMOTION_KEYWORDS = {
  alegría:  ["feliz", "bien", "genial", "excelente", "contento", "logré", "éxito", "alegre", "emocionado"],
  tristeza: ["triste", "mal", "deprimido", "lloré", "difícil", "perdí", "dolor", "pena", "llorando"],
  ansiedad: ["ansioso", "nervioso", "preocupado", "estrés", "miedo", "angustia", "ansiedad", "estresado"],
  enojo:    ["enojado", "molesto", "frustrado", "rabia", "furioso", "irritado", "harto", "bronca"],
  calma:    ["tranquilo", "paz", "relajado", "sereno", "equilibrado", "descansado"],
};

const SPANISH_STOPWORDS = new Set([
  "de", "la", "el", "y", "en", "que", "a", "es", "un", "una", "los", "me",
  "se", "mi", "te", "no", "lo", "le", "si", "pero", "con", "por", "para",
  "del", "al", "este", "esta", "esto", "hay", "más", "bien", "muy", "fue",
  "ser", "era", "hoy", "ayer", "poco", "mucho", "también", "todo", "todos",
  "así", "como", "cuando", "porque", "qué", "cómo", "quién", "dónde",
  "yo", "tú", "él", "ella", "nosotros", "voy", "soy",
]);

// ---- API pública ----

/**
 * Infiere la emoción dominante del día a partir de los mensajes del usuario.
 * Retorna el nombre de la emoción o "neutral".
 */
export function inferDayEmotion(day) {
  const userText = (day.rawChat || [])
    .filter((m) => m.role === "user")
    .map((m) => (m.content || "").toLowerCase())
    .join(" ");

  if (!userText.trim()) return "neutral";

  const scores = {};
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    scores[emotion] = keywords.filter((kw) => userText.includes(kw)).length;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : "neutral";
}

/**
 * Extrae los temas dominantes del día (top 5 palabras más frecuentes de mensajes usuario,
 * excluyendo stopwords y palabras cortas).
 */
export function extractDayThemes(day) {
  const wordCount = {};
  for (const msg of (day.rawChat || []).filter((m) => m.role === "user")) {
    const words = (msg.content || "")
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !SPANISH_STOPWORDS.has(w));
    for (const w of words) {
      wordCount[w] = (wordCount[w] || 0) + 1;
    }
  }
  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Genera un resumen textual automático del día a partir de sus mensajes y metadatos.
 */
export function summarizeDay(day) {
  const userMsgs = (day.rawChat || []).filter((m) => m.role === "user");
  if (userMsgs.length === 0) return "Día sin actividad registrada.";

  const count = userMsgs.length;
  const emotion = day.dominantEmotion || inferDayEmotion(day);
  const themes = day.dominantThemes?.length ? day.dominantThemes : extractDayThemes(day);
  const preview = (userMsgs[0]?.content || "").slice(0, 80);
  const themesStr = themes.length ? themes.join(", ") : "varios";
  const suffix = preview.length === 80 ? "..." : "";

  return `Día con ${count} mensaje${count !== 1 ? "s" : ""}. Emoción dominante: ${emotion}. Temas: ${themesStr}. Primera entrada: "${preview}${suffix}".`;
}

/**
 * Agrega todos los IDs de neuronas activadas durante el día (de rawChat).
 * Busca en activatedNeuronIds y linkedNeurons de cada mensaje.
 */
export function aggregateActivatedNeurons(day) {
  const ids = new Set();
  for (const msg of (day.rawChat || [])) {
    if (Array.isArray(msg.activatedNeuronIds)) {
      for (const id of msg.activatedNeuronIds) {
        if (id) ids.add(id);
      }
    }
    if (Array.isArray(msg.linkedNeurons)) {
      for (const id of msg.linkedNeurons) {
        if (id) ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

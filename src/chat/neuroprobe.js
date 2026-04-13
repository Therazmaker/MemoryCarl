/**
 * neuroprobe.js — Ente observador del NeuroChat
 *
 * Un agente secundario que vive al lado del NeuroChat sin reemplazarlo.
 * Observa silenciosamente las conversaciones, detecta gaps en el grafo
 * neuronal, y en el momento adecuado hace preguntas para:
 *
 *   1. Llenar gaps entre neuronas que deberían estar conectadas
 *   2. Crear puentes entre dominios sin relación aparente
 *   3. Profundizar en neuronas con poca evidencia
 *   4. Reforzar neuronas que llevan tiempo sin activarse (memoria temporal)
 *   5. GENERAR nuevas neuronas a partir de lo que el usuario responde
 *
 * Integración:
 *   import { NeuroProbe } from "./neuroprobe.js";
 *   const probe = new NeuroProbe();
 *
 *   // Después de cada mensaje del neurochat:
 *   probe.observe({ activated, generated, userInput, history });
 *
 *   // Para saber si el probe quiere preguntar algo:
 *   const question = probe.getPendingQuestion();
 *
 *   // Cuando el usuario responde al probe:
 *   const result = await probe.processAnswer(userAnswer);
 *   // result.neuronsCreated, result.connectionsAdded, result.strengthenedIds
 */

import { getAllNeurons, saveNeuron, updateNeuron } from "../neuro/neuronStore.js";
import { createNeuron, generateId } from "../neuro/schemas.js";
import { linkNeurons } from "../neuro/connections.js";
import { getInsightHistory } from "../neuro/insightHistory.js";

// ─── Constantes ──────────────────────────────────────────────────────────────

const PROBE_STORAGE_KEY  = "memorycarl_neuroprobe_state";
const PROBE_LOG_KEY      = "memorycarl_neuroprobe_log";

// Cuántos mensajes del chat esperar antes de que el probe pueda preguntar de nuevo
const COOLDOWN_MESSAGES  = 6;

// Tiempo mínimo (ms) entre preguntas si se mide por tiempo
const COOLDOWN_MS        = 3 * 60 * 1000; // 3 minutos

// Peso mínimo de conexión para considerar que ya existe
const MIN_CONN_WEIGHT    = 0.30;

// Días sin activación para considerar una neurona "dormida"
const DORMANT_DAYS       = 14;

// ─── Tipos de pregunta ────────────────────────────────────────────────────────

export const PROBE_QUESTION_TYPES = {
  GAP:      "gap",       // Vacío entre dos neuronas relacionadas
  BRIDGE:   "bridge",    // Puente entre dominios distintos
  DEPTH:    "depth",     // Profundizar en neurona con poca evidencia
  TEMPORAL: "temporal",  // Refuerzo de neurona dormida
  GENESIS:  "genesis",   // Preguntar para CREAR una neurona nueva
};

// ─── Utilidades internas ──────────────────────────────────────────────────────

function now() { return Date.now(); }

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

function loadState() {
  try {
    const raw = localStorage.getItem(PROBE_STORAGE_KEY);
    return JSON.parse(raw || "{}");
  } catch { return {}; }
}

function saveState(state) {
  try { localStorage.setItem(PROBE_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadLog() {
  try {
    const raw = localStorage.getItem(PROBE_LOG_KEY);
    return JSON.parse(raw || "[]");
  } catch { return []; }
}

function appendLog(entry) {
  try {
    const log = loadLog();
    log.push({ ...entry, at: new Date().toISOString() });
    localStorage.setItem(PROBE_LOG_KEY, JSON.stringify(log.slice(-200)));
  } catch {}
}

// Extrae tokens significativos de texto para crear triggers
function extractKeyTokens(text = "", maxTokens = 8) {
  const stopwords = new Set([
    "que", "de", "la", "el", "en", "y", "a", "los", "las", "un", "una",
    "es", "su", "por", "con", "se", "del", "al", "lo", "como", "más",
    "pero", "sus", "me", "si", "ya", "o", "fue", "hay", "le", "muy",
    "esto", "para", "mi", "era", "ese", "ser", "cuando", "también",
    "has", "han", "había", "este", "esta", "si", "no", "ni", "sobre",
    "the", "and", "of", "to", "in", "is", "it", "that", "was",
  ]);
  return text
    .toLowerCase()
    .replace(/[¿?¡!.,;:()\[\]"']/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 3 && !stopwords.has(t))
    .slice(0, maxTokens);
}

// Computa un score de "distancia" entre dos neuronas (0 = muy cercanas, 1 = muy lejanas)
function gapScore(a, b, allNeurons) {
  const connected = a.connections.includes(b.id) || b.connections.includes(a.id);
  if (connected) return 0; // Ya están conectadas, no es gap

  const domainDiff = a.core.domain !== b.core.domain ? 0.3 : 0;

  // Overlap de triggers
  const tokA = new Set(extractKeyTokens(
    [a.core.concept, a.core.summary, ...a.triggers].join(" ")
  ));
  const tokB = new Set(extractKeyTokens(
    [b.core.concept, b.core.summary, ...b.triggers].join(" ")
  ));
  const intersection = [...tokA].filter(t => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const similarity = union > 0 ? intersection / union : 0;

  // Gap alto = similares en tema pero sin conexión
  if (similarity > 0.25) return 0.8 + domainDiff * 0.2;

  // Si comparten dominio pero no triggers: brecha sospechosa
  if (a.core.domain === b.core.domain && similarity < 0.15) return 0.6;

  return similarity > 0.1 ? 0.4 : 0;
}

// ─── Generadores de preguntas ─────────────────────────────────────────────────

function buildGapQuestion(neuronA, neuronB) {
  const ca = neuronA.core.concept;
  const cb = neuronB.core.concept;
  const templates = [
    `Noto que hablas de "${ca}" y también de "${cb}", pero nunca los has conectado. ¿Cómo se relacionan en tu vida o en tu forma de pensar?`,
    `"${ca}" y "${cb}" aparecen en tu memoria pero sin un puente entre ellos. ¿Hubo algún momento en que los dos estuvieron presentes al mismo tiempo?`,
    `Tengo curiosidad: cuando piensas en "${ca}", ¿${cb} aparece de alguna forma? ¿O son mundos separados para ti?`,
    `He notado que "${ca}" y "${cb}" coexisten en tu grafo sin conexión. ¿Hay algo que los una que todavía no me has contado?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function buildBridgeQuestion(neuronA, neuronB) {
  const ca = neuronA.core.concept;
  const da = neuronA.core.domain;
  const cb = neuronB.core.concept;
  const db = neuronB.core.domain;
  const templates = [
    `Tienes "${ca}" en el dominio de ${da} y "${cb}" en ${db}. Son mundos distintos, pero me pregunto si hay algo que los conecte desde tu experiencia.`,
    `¿Alguna vez has aplicado lo que sabes sobre "${ca}" a algo relacionado con "${cb}"? Aunque parezcan distintos, podría haber un patrón compartido.`,
    `"${ca}" y "${cb}" pertenecen a áreas diferentes de tu vida. ¿Hay algún principio o aprendizaje que te sirva para los dos?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function buildDepthQuestion(neuron) {
  const c = neuron.core.concept;
  const s = neuron.core.summary;
  const templates = [
    `Tengo a "${c}" en tu memoria con poca evidencia. ${s ? `Sé que: "${s.slice(0, 80)}". ` : ""}¿Puedes contarme más sobre esto? Especialmente un ejemplo concreto.`,
    `"${c}" aparece en tu grafo pero con triggers débiles. ¿Cuándo aparece este concepto en tu día a día? ¿Hay una situación específica que lo active?`,
    `Quiero entender mejor "${c}". ¿Qué lo hace importante para ti? ¿Qué recordarías de esto dentro de un año?`,
    `"${c}" está en tu red pero con poca profundidad. ¿Hay una historia detrás que todavía no me has contado?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function buildTemporalQuestion(neuron) {
  const c = neuron.core.concept;
  const days = Math.round(daysSince(neuron.lastActivated || neuron.updatedAt));
  const timeHint = days < 30
    ? `hace ${days} días`
    : days < 365
      ? `hace ${Math.round(days / 7)} semanas`
      : `hace más de un año`;

  const templates = [
    `"${c}" no aparece en tus conversaciones desde ${timeHint}. ¿Sigue siendo relevante para ti? ¿Ha cambiado algo?`,
    `Revisando tu memoria, "${c}" quedó en pausa ${timeHint}. Con la perspectiva que da el tiempo, ¿lo verías diferente hoy?`,
    `El concepto "${c}" está dormido desde ${timeHint}. ¿Quieres actualizarlo o dejarlo ir?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function buildGenesisQuestion(domain, hint = "") {
  const domainLabels = {
    general: "tu vida en general",
    work: "tu trabajo",
    personal: "tu vida personal",
    health: "tu salud",
    finance: "tus finanzas",
    relationships: "tus relaciones",
    hobbies: "tus pasatiempos",
    learning: "tu aprendizaje",
    sport: "el deporte",
    football: "el fútbol",
    emotions: "tus emociones",
    identity: "tu identidad",
  };
  const domainLabel = domainLabels[domain] || domain;

  const genesisTemplates = [
    `Hablando de ${domainLabel}${hint ? ` y específicamente sobre "${hint}"` : ""}: ¿hay algo importante que todavía no le he preguntado y que sientes que debería saber sobre ti?`,
    `En el área de ${domainLabel}, ¿qué concepto o experiencia crees que es fundamental para entenderte pero que aún no existe en tu memoria?`,
    `¿Hay algo sobre ${domainLabel} que te define o que tiene mucho peso en tu vida y que nunca has mencionado aquí?`,
    `Si tuvieras que agregar una neurona nueva sobre ${domainLabel} ahora mismo, ¿cuál sería y por qué?`,
  ];
  return genesisTemplates[Math.floor(Math.random() * genesisTemplates.length)];
}

// ─── Motor de análisis ────────────────────────────────────────────────────────

function detectGaps(allNeurons) {
  const gaps = [];
  const checked = new Set();

  // Solo analizar neuronas con algo de peso y que hayan sido activadas
  const candidates = allNeurons.filter(n =>
    !n.deleted && n.weight > 0.4 && (n.timesActivated || 0) > 0
  );

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const key = [a.id, b.id].sort().join("|");
      if (checked.has(key)) continue;
      checked.add(key);

      const score = gapScore(a, b, allNeurons);
      if (score >= 0.6) {
        gaps.push({ neuronA: a, neuronB: b, score, type: PROBE_QUESTION_TYPES.GAP });
      }
    }
  }

  return gaps.sort((a, b) => b.score - a.score).slice(0, 10);
}

function detectBridges(allNeurons) {
  const bridges = [];
  const checked = new Set();

  const candidates = allNeurons.filter(n =>
    !n.deleted && n.weight > 0.5 && n.core.domain !== "general"
  );

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.core.domain === b.core.domain) continue;
      if (a.connections.includes(b.id)) continue;

      const key = [a.id, b.id].sort().join("|");
      if (checked.has(key)) continue;
      checked.add(key);

      // Solo sugerir puente si ambas tienen peso alto
      if (a.weight > 0.65 && b.weight > 0.65) {
        bridges.push({
          neuronA: a, neuronB: b,
          score: (a.weight + b.weight) / 2,
          type: PROBE_QUESTION_TYPES.BRIDGE
        });
      }
    }
  }

  return bridges.sort((a, b) => b.score - a.score).slice(0, 6);
}

function detectWeakNeurons(allNeurons) {
  return allNeurons
    .filter(n => {
      if (n.deleted) return false;
      const hasShortSummary = (n.core.summary || "").length < 30;
      const hasFewTriggers = (n.triggers || []).length < 2;
      const hasFewEvidence = (n.evidence || []).length < 1;
      const hasLowWeight = n.weight < 0.5;
      return (hasShortSummary || hasFewTriggers) && hasFewEvidence && !hasLowWeight;
    })
    .map(n => ({ neuron: n, type: PROBE_QUESTION_TYPES.DEPTH }))
    .slice(0, 5);
}

function detectDormantNeurons(allNeurons) {
  const dormant = [];
  for (const n of allNeurons) {
    if (n.deleted) continue;
    if (n.weight < 0.5) continue;
    const lastSeen = n.lastActivated || n.updatedAt;
    if (daysSince(lastSeen) >= DORMANT_DAYS) {
      dormant.push({ neuron: n, daysSince: Math.round(daysSince(lastSeen)), type: PROBE_QUESTION_TYPES.TEMPORAL });
    }
  }
  return dormant.sort((a, b) => b.daysSince - a.daysSince).slice(0, 4);
}

function detectGenesisDomains(allNeurons) {
  // Dominios con pocas neuronas = oportunidad de genesis
  const domainCounts = {};
  for (const n of allNeurons) {
    if (n.deleted) continue;
    const d = n.core.domain || "general";
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }

  // Dominios que existen pero son escasos
  const sparse = Object.entries(domainCounts)
    .filter(([d, c]) => c < 3 && d !== "general")
    .map(([d]) => d);

  // Siempre incluir una sugerencia abierta
  if (!sparse.includes("identity")) sparse.push("identity");

  return sparse.slice(0, 3);
}

// ─── Procesador de respuestas: extrae neuronas de lo que el usuario dice ──────

function extractNeuronsFromAnswer(answer, context) {
  /**
   * Analiza la respuesta del usuario y decide:
   * - Si crear una neurona nueva
   * - Si enriquecer una existente (más triggers, más evidencia)
   * - Si crear la conexión que el probe estaba buscando
   *
   * Esta función es local (sin IA). La función premium usa la API de Gemini/NeuroClaw.
   * Devuelve { neuronsToCreate, idsToStrengthen, idsToConnect, enrichments }
   */
  const { type, neuronA, neuronB, neuron: targetNeuron } = context;

  const tokens = extractKeyTokens(answer, 12);
  const firstSentence = answer.split(/[.!?]/)[0].slice(0, 120);

  const result = {
    neuronsToCreate: [],
    idsToStrengthen: [],
    idsToConnect: [],
    enrichments: [],     // { id, addTriggers, addEvidence, newSummary }
  };

  if (!answer || answer.trim().length < 10) return result;

  const answerLower = answer.toLowerCase();

  // Si el usuario niega la conexión ("no se relacionan", "son distintos", etc.)
  const denialPhrases = ["no se relacion", "no tienen nada", "son distintos", "no lo veo",
    "no hay conexión", "no connect", "no están", "nada que ver"];
  const denies = denialPhrases.some(p => answerLower.includes(p));

  if (type === PROBE_QUESTION_TYPES.GAP || type === PROBE_QUESTION_TYPES.BRIDGE) {
    if (!denies && neuronA && neuronB) {
      // El usuario aceptó la relación → conectar
      result.idsToConnect.push([neuronA.id, neuronB.id]);

      // Enriquecer ambas neuronas con los tokens de la respuesta
      result.enrichments.push({
        id: neuronA.id,
        addTriggers: tokens.slice(0, 4),
        addEvidence: [firstSentence],
      });
      result.enrichments.push({
        id: neuronB.id,
        addTriggers: tokens.slice(4, 8),
        addEvidence: [],
      });
    }

    // Si la respuesta es larga y contiene nueva información, crear neurona de la relación
    if (answer.length > 80 && !denies) {
      const bridgeConcept = `${neuronA?.core.concept || ""} ↔ ${neuronB?.core.concept || ""}`;
      result.neuronsToCreate.push({
        type: "pattern",
        core: {
          concept: bridgeConcept.slice(0, 120),
          domain: neuronA?.core.domain || "general",
          summary: firstSentence,
        },
        triggers: tokens,
        evidence: [firstSentence],
        weight: 0.55,
        emotion: "neutral",
        source: { kind: "probe", ref: "gap_question" },
      });
    }
  }

  if (type === PROBE_QUESTION_TYPES.DEPTH && targetNeuron) {
    // Profundizar en neurona existente
    result.idsToStrengthen.push(targetNeuron.id);
    result.enrichments.push({
      id: targetNeuron.id,
      addTriggers: tokens,
      addEvidence: [firstSentence],
      newSummary: answer.length > 40 ? firstSentence : null,
    });
  }

  if (type === PROBE_QUESTION_TYPES.TEMPORAL && targetNeuron) {
    // Reactivar neurona dormida
    const isStillRelevant = !denialPhrases.some(p => answerLower.includes(p));
    if (isStillRelevant) {
      result.idsToStrengthen.push(targetNeuron.id);
      result.enrichments.push({
        id: targetNeuron.id,
        addTriggers: tokens.slice(0, 3),
        addEvidence: [firstSentence],
      });
    }
  }

  if (type === PROBE_QUESTION_TYPES.GENESIS) {
    // El usuario describe algo nuevo → crear neurona
    if (answer.length > 30) {
      result.neuronsToCreate.push({
        type: "memory",
        core: {
          concept: firstSentence.slice(0, 80),
          domain: context.domain || "general",
          summary: answer.slice(0, 300),
        },
        triggers: tokens,
        evidence: [answer.slice(0, 200)],
        weight: 0.6,
        emotion: "neutral",
        source: { kind: "probe", ref: "genesis_question" },
      });
    }
  }

  return result;
}

// ─── Clase principal ──────────────────────────────────────────────────────────

export class NeuroProbe {
  constructor(options = {}) {
    this._state = loadState();
    this._options = {
      cooldownMessages: options.cooldownMessages ?? COOLDOWN_MESSAGES,
      cooldownMs: options.cooldownMs ?? COOLDOWN_MS,
      triggers: options.triggers ?? ["idle", "activation", "interval"],
      enabled: options.enabled ?? true,
      verbose: options.verbose ?? false,
      ...options,
    };

    // Estado interno de sesión (no persiste)
    this._messagesSinceLastProbe = 0;
    this._pendingQuestion = null;
    this._lastProbeAt = this._state.lastProbeAt || 0;
    this._sessionAnalysis = null;
  }

  // ── Observación pasiva ────────────────────────────────────────────────────

  /**
   * Llamar después de cada turno del NeuroChat.
   * @param {{ activated: Array, generated: Array, userInput: string, history: Array }} params
   */
  observe({ activated = [], generated = [], userInput = "", history = [] }) {
    if (!this._options.enabled) return;
    this._messagesSinceLastProbe++;

    // Guardar las neuronas que se activaron para análisis
    this._lastActivatedIds = (activated || []).map(a => a.neuron?.id).filter(Boolean);
    this._lastUserInput = userInput;

    // Verificar si debería generar una pregunta
    if (this._shouldAsk()) {
      this._generateQuestion();
    }
  }

  // ── Decisión de disparo ───────────────────────────────────────────────────

  _shouldAsk() {
    if (this._pendingQuestion) return false; // Ya hay una pregunta pendiente

    const cooldownOk = this._messagesSinceLastProbe >= this._options.cooldownMessages;
    const timeOk = (now() - this._lastProbeAt) >= this._options.cooldownMs;

    return cooldownOk || timeOk;
  }

  // ── Análisis y generación de pregunta ────────────────────────────────────

  _generateQuestion() {
    const allNeurons = getAllNeurons();
    if (allNeurons.length < 3) return; // Muy pocas neuronas todavía

    // Calcular todos los candidatos
    const gaps      = detectGaps(allNeurons);
    const bridges   = detectBridges(allNeurons);
    const weak      = detectWeakNeurons(allNeurons);
    const dormant   = detectDormantNeurons(allNeurons);
    const genesis   = detectGenesisDomains(allNeurons);

    // Guardar análisis para stats
    this._sessionAnalysis = { gaps, bridges, weak, dormant, genesis };

    // Priorizar: gaps > genesis > bridges > depth > temporal
    let chosen = null;

    // Evitar repetir la misma neurona que se preguntó antes
    const recentIds = new Set(this._state.recentProbedIds || []);

    if (gaps.length > 0) {
      const fresh = gaps.find(g =>
        !recentIds.has(g.neuronA.id) && !recentIds.has(g.neuronB.id)
      );
      if (fresh) {
        chosen = {
          type: PROBE_QUESTION_TYPES.GAP,
          text: buildGapQuestion(fresh.neuronA, fresh.neuronB),
          neuronA: fresh.neuronA,
          neuronB: fresh.neuronB,
          score: fresh.score,
        };
      }
    }

    if (!chosen && genesis.length > 0) {
      const domain = genesis[0];
      chosen = {
        type: PROBE_QUESTION_TYPES.GENESIS,
        text: buildGenesisQuestion(domain),
        domain,
        score: 0.7,
      };
    }

    if (!chosen && bridges.length > 0) {
      const fresh = bridges.find(b =>
        !recentIds.has(b.neuronA.id) && !recentIds.has(b.neuronB.id)
      );
      if (fresh) {
        chosen = {
          type: PROBE_QUESTION_TYPES.BRIDGE,
          text: buildBridgeQuestion(fresh.neuronA, fresh.neuronB),
          neuronA: fresh.neuronA,
          neuronB: fresh.neuronB,
          score: fresh.score,
        };
      }
    }

    if (!chosen && weak.length > 0) {
      const fresh = weak.find(w => !recentIds.has(w.neuron.id));
      if (fresh) {
        chosen = {
          type: PROBE_QUESTION_TYPES.DEPTH,
          text: buildDepthQuestion(fresh.neuron),
          neuron: fresh.neuron,
          score: 0.6,
        };
      }
    }

    if (!chosen && dormant.length > 0) {
      const fresh = dormant.find(d => !recentIds.has(d.neuron.id));
      if (fresh) {
        chosen = {
          type: PROBE_QUESTION_TYPES.TEMPORAL,
          text: buildTemporalQuestion(fresh.neuron),
          neuron: fresh.neuron,
          daysSince: fresh.daysSince,
          score: 0.5,
        };
      }
    }

    if (chosen) {
      this._pendingQuestion = {
        ...chosen,
        id: `probe_${Date.now().toString(36)}`,
        generatedAt: new Date().toISOString(),
        answered: false,
      };

      if (this._options.verbose) {
        console.log("[NeuroProbe] Pregunta generada:", this._pendingQuestion.type, chosen.text.slice(0, 60));
      }
    }
  }

  // ── API pública ───────────────────────────────────────────────────────────

  /**
   * Devuelve la pregunta pendiente si la hay, o null.
   * @returns {{ id, type, text, neuronA?, neuronB?, neuron?, domain? } | null}
   */
  getPendingQuestion() {
    return this._pendingQuestion || null;
  }

  /**
   * Fuerza la generación de una pregunta ahora, ignorando el cooldown.
   * @returns {{ id, type, text } | null}
   */
  forceQuestion() {
    this._generateQuestion();
    return this._pendingQuestion;
  }

  /**
   * Genera una pregunta de un tipo específico.
   * @param {string} type - Uno de PROBE_QUESTION_TYPES
   * @param {object} options - { neuronId, domainHint }
   */
  requestQuestionOfType(type, options = {}) {
    const allNeurons = getAllNeurons();

    if (type === PROBE_QUESTION_TYPES.GENESIS) {
      const domain = options.domainHint || "general";
      this._pendingQuestion = {
        id: `probe_${Date.now().toString(36)}`,
        type,
        text: buildGenesisQuestion(domain, options.hint),
        domain,
        generatedAt: new Date().toISOString(),
        answered: false,
      };
      return this._pendingQuestion;
    }

    if (type === PROBE_QUESTION_TYPES.GAP) {
      const gaps = detectGaps(allNeurons);
      const gap = options.neuronId
        ? gaps.find(g => g.neuronA.id === options.neuronId || g.neuronB.id === options.neuronId)
        : gaps[0];
      if (gap) {
        this._pendingQuestion = {
          id: `probe_${Date.now().toString(36)}`,
          type,
          text: buildGapQuestion(gap.neuronA, gap.neuronB),
          neuronA: gap.neuronA,
          neuronB: gap.neuronB,
          generatedAt: new Date().toISOString(),
          answered: false,
        };
      }
      return this._pendingQuestion;
    }

    if (type === PROBE_QUESTION_TYPES.DEPTH) {
      const weak = detectWeakNeurons(allNeurons);
      const target = options.neuronId
        ? weak.find(w => w.neuron.id === options.neuronId)
        : weak[0];
      if (target) {
        this._pendingQuestion = {
          id: `probe_${Date.now().toString(36)}`,
          type,
          text: buildDepthQuestion(target.neuron),
          neuron: target.neuron,
          generatedAt: new Date().toISOString(),
          answered: false,
        };
      }
      return this._pendingQuestion;
    }

    return null;
  }

  /**
   * Procesa la respuesta del usuario a la pregunta del probe.
   * Crea neuronas, refuerza conexiones, actualiza el grafo.
   *
   * @param {string} userAnswer
   * @returns {{
   *   neuronsCreated: Neuron[],
   *   connectionsAdded: number,
   *   strengthenedIds: string[],
   *   summary: string
   * }}
   */
  async processAnswer(userAnswer) {
    if (!this._pendingQuestion) {
      return { neuronsCreated: [], connectionsAdded: 0, strengthenedIds: [], summary: "No había pregunta pendiente." };
    }

    const context = { ...this._pendingQuestion };
    const extracted = extractNeuronsFromAnswer(userAnswer, context);

    const neuronsCreated = [];
    const strengthenedIds = [];
    let connectionsAdded = 0;

    // 1. Crear neuronas nuevas
    for (const nData of extracted.neuronsToCreate) {
      try {
        const newNeuron = createNeuron({
          ...nData,
          id: generateId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        saveNeuron(newNeuron);
        neuronsCreated.push(newNeuron);

        // Intentar conectar con las neuronas del contexto
        if (context.neuronA) linkNeurons(newNeuron.id, context.neuronA.id, { connectionSource: "probe" });
        if (context.neuronB) linkNeurons(newNeuron.id, context.neuronB.id, { connectionSource: "probe" });
        if (context.neuron)  linkNeurons(newNeuron.id, context.neuron.id,  { connectionSource: "probe" });
      } catch (err) {
        console.warn("[NeuroProbe] Error creando neurona:", err);
      }
    }

    // 2. Crear conexiones directas entre neuronas existentes
    for (const [idA, idB] of extracted.idsToConnect) {
      try {
        const ok = linkNeurons(idA, idB, { connectionSource: "probe", relationType: "probe_bridge" });
        if (ok) connectionsAdded++;
      } catch (err) {
        console.warn("[NeuroProbe] Error conectando neuronas:", err);
      }
    }

    // 3. Enriquecer neuronas existentes con nueva evidencia
    for (const enrichment of extracted.enrichments) {
      try {
        const allNeurons = getAllNeurons();
        const target = allNeurons.find(n => n.id === enrichment.id);
        if (!target) continue;

        const newTriggers = [...new Set([
          ...(target.triggers || []),
          ...(enrichment.addTriggers || []),
        ])].slice(0, 20);

        const newEvidence = [...new Set([
          ...(target.evidence || []),
          ...(enrichment.addEvidence || []),
        ])].slice(0, 20);

        const updates = {
          triggers: newTriggers,
          evidence: newEvidence,
          updatedAt: new Date().toISOString(),
          lastActivated: new Date().toISOString(),
          timesActivated: (target.timesActivated || 0) + 1,
        };

        if (enrichment.newSummary && enrichment.newSummary.length > (target.core.summary || "").length) {
          updates["core.summary"] = enrichment.newSummary;
        }

        // Leve boost de peso por haber sido profundizada
        const newWeight = Math.min(1, (target.weight || 0.5) + 0.04);
        updates.weight = newWeight;

        updateNeuron(enrichment.id, updates);
        strengthenedIds.push(enrichment.id);
      } catch (err) {
        console.warn("[NeuroProbe] Error enriqueciendo neurona:", err);
      }
    }

    // 4. Fortalecer neuronas marcadas explícitamente
    for (const id of extracted.idsToStrengthen) {
      if (strengthenedIds.includes(id)) continue;
      try {
        const allNeurons = getAllNeurons();
        const target = allNeurons.find(n => n.id === id);
        if (!target) continue;
        updateNeuron(id, {
          weight: Math.min(1, (target.weight || 0.5) + 0.05),
          lastActivated: new Date().toISOString(),
          timesActivated: (target.timesActivated || 0) + 1,
          updatedAt: new Date().toISOString(),
        });
        strengthenedIds.push(id);
      } catch {}
    }

    // 5. Actualizar estado del probe
    const probedIds = [
      context.neuronA?.id,
      context.neuronB?.id,
      context.neuron?.id,
    ].filter(Boolean);

    const recentProbedIds = [
      ...(this._state.recentProbedIds || []),
      ...probedIds,
    ].slice(-30); // Guardar los últimos 30

    this._state.recentProbedIds = recentProbedIds;
    this._state.lastProbeAt = now();
    this._state.totalQuestions = (this._state.totalQuestions || 0) + 1;
    this._state.totalNeuronsCreated = (this._state.totalNeuronsCreated || 0) + neuronsCreated.length;
    this._state.totalConnectionsAdded = (this._state.totalConnectionsAdded || 0) + connectionsAdded;
    saveState(this._state);

    // Marcar pregunta como respondida y limpiar
    this._pendingQuestion.answered = true;
    this._pendingQuestion.answeredAt = new Date().toISOString();
    this._messagesSinceLastProbe = 0;
    this._lastProbeAt = now();

    appendLog({
      questionId: context.id,
      type: context.type,
      neuronsCreated: neuronsCreated.length,
      connectionsAdded,
      strengthenedIds,
    });

    this._pendingQuestion = null;

    // Generar resumen humano del resultado
    const parts = [];
    if (neuronsCreated.length > 0) {
      parts.push(`✦ Creé ${neuronsCreated.length} neurona${neuronsCreated.length > 1 ? "s" : ""} nueva${neuronsCreated.length > 1 ? "s" : ""}: ${neuronsCreated.map(n => `"${n.core.concept}"`).join(", ")}`);
    }
    if (connectionsAdded > 0) {
      parts.push(`⟷ Conecté ${connectionsAdded} par${connectionsAdded > 1 ? "es" : ""} de neuronas`);
    }
    if (strengthenedIds.length > 0) {
      parts.push(`↑ Fortalecí ${strengthenedIds.length} neurona${strengthenedIds.length > 1 ? "s" : ""} existente${strengthenedIds.length > 1 ? "s" : ""}`);
    }
    const summary = parts.length > 0
      ? parts.join(" · ")
      : "Registré tu respuesta. Seguiré observando.";

    return { neuronsCreated, connectionsAdded, strengthenedIds, summary };
  }

  /**
   * Descarta la pregunta pendiente sin procesarla.
   */
  dismiss() {
    if (this._pendingQuestion) {
      appendLog({ questionId: this._pendingQuestion.id, type: this._pendingQuestion.type, dismissed: true });
    }
    this._pendingQuestion = null;
    this._messagesSinceLastProbe = 0;
    this._lastProbeAt = now();
    saveState({ ...this._state, lastProbeAt: now() });
  }

  /**
   * Devuelve estadísticas del probe para mostrar en UI.
   */
  getStats() {
    const allNeurons = getAllNeurons();
    const analysis = this._sessionAnalysis || {
      gaps: detectGaps(allNeurons),
      bridges: detectBridges(allNeurons),
      weak: detectWeakNeurons(allNeurons),
      dormant: detectDormantNeurons(allNeurons),
    };

    return {
      totalNeurons: allNeurons.filter(n => !n.deleted).length,
      weakConnections: analysis.gaps.length + analysis.bridges.length,
      gapCount: analysis.gaps.length,
      bridgeCount: analysis.bridges.length,
      weakNeuronCount: analysis.weak.length,
      dormantCount: analysis.dormant.length,
      totalQuestionsAsked: this._state.totalQuestions || 0,
      totalNeuronsCreated: this._state.totalNeuronsCreated || 0,
      totalConnectionsAdded: this._state.totalConnectionsAdded || 0,
      hasPendingQuestion: Boolean(this._pendingQuestion),
      pendingType: this._pendingQuestion?.type || null,
    };
  }

  /**
   * Devuelve el log completo de sesiones del probe.
   */
  getLog() {
    return loadLog();
  }

  /**
   * Habilita o deshabilita el probe.
   */
  setEnabled(enabled) {
    this._options.enabled = Boolean(enabled);
  }

  /**
   * Configura el cooldown entre preguntas.
   */
  setCooldown({ messages, ms } = {}) {
    if (messages != null) this._options.cooldownMessages = messages;
    if (ms != null) this._options.cooldownMs = ms;
  }
}

// ─── Instancia singleton para uso global ─────────────────────────────────────

export const neuroProbe = new NeuroProbe();

// ─── Helpers de integración con neurochat.js ──────────────────────────────────

/**
 * Hook para integrar con neurochat.sendMessage:
 *
 *   import { observeAfterMessage } from "./neuroprobe.js";
 *
 *   // Al final de sendMessage():
 *   observeAfterMessage(result);
 */
export function observeAfterMessage(neuroCoreResult) {
  neuroProbe.observe({
    activated: neuroCoreResult.activated || [],
    generated: neuroCoreResult.generated || [],
    userInput: neuroCoreResult.userInput || "",
    history: [],
  });
}

/**
 * Devuelve si hay una pregunta lista para mostrar al usuario.
 */
export function getProbeQuestion() {
  return neuroProbe.getPendingQuestion();
}

/**
 * Procesa la respuesta del usuario a una pregunta del probe.
 * Wrapper para usar sin instanciar NeuroProbe directamente.
 */
export async function answerProbeQuestion(text) {
  return neuroProbe.processAnswer(text);
}

export default neuroProbe;

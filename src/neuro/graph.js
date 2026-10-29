import { getAllRelations, RELATION_TYPE_LABELS } from "./relationStore.js";

/**
 * graph.js — Construcción y utilidades del grafo neuronal
 * NeuroChat / MemoryCarl
 *
 * Exporta:
 *   buildNeuronGraph(neurons, options?)
 *   filterGraphNodes(graph, filters)
 *   getDomainColors()
 *   getEmotionColors()
 *   getDomainColor(domain)
 *   getEmotionColor(emotion)
 *   computeNodeSize(neuron, options?)
 */

// ---- Colores por dominio ----
const DOMAIN_COLORS = {
  general:      "#7c5cff",
  personal:     "#a78bfa",
  work:         "#60a5fa",
  health:       "#34d399",
  finance:      "#fbbf24",
  relationships:"#f472b6",
  habits:       "#fb923c",
  beliefs:      "#e879f9",
  emotions:     "#f87171",
  learning:     "#38bdf8",
  creativity:   "#4ade80",
};

// ---- Colores por emoción ----
const EMOTION_COLORS = {
  joy:       "#34d399",
  sadness:   "#60a5fa",
  anger:     "#f87171",
  fear:      "#a78bfa",
  surprise:  "#fbbf24",
  disgust:   "#9ca3af",
  curiosity: "#38bdf8",
  pride:     "#fb923c",
  shame:     "#6b7280",
  love:      "#f472b6",
  neutral:   "#94a3b8",
};


const MANUAL_CATEGORY_COLORS = {
  people: "#f472b6",
  work: "#60a5fa",
  hobbies: "#34d399",
  projects: "#fbbf24",
  preferences: "#a78bfa",
  places: "#fb923c",
  identity: "#e879f9",
  other: "#94a3b8",
};
const FALLBACK_COLOR = "#94a3b8";

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (k) => {
    const n = (k + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(n - 3, 9 - n, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Color estable derivado del texto, para claves que no están en la paleta.
 * @param {string} key
 * @returns {string} color hex
 */
export function colorFromKey(key) {
  const str = String(key || "").trim().toLowerCase();
  if (!str) return FALLBACK_COLOR;
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return hslToHex(Math.abs(hash) % 360, 0.7, 0.66);
}

/**
 * Color de un dominio; los dominios desconocidos reciben un color estable propio.
 * @param {string} domain
 * @returns {string}
 */
export function getDomainColor(domain) {
  return DOMAIN_COLORS[domain] || colorFromKey(domain);
}

/**
 * Color de una emoción.
 * @param {string} emotion
 * @returns {string}
 */
export function getEmotionColor(emotion) {
  return EMOTION_COLORS[emotion] || FALLBACK_COLOR;
}

/**
 * Devuelve el mapa de colores por dominio.
 * @returns {Record<string, string>}
 */
export function getDomainColors() {
  return { ...DOMAIN_COLORS };
}

/**
 * Devuelve el mapa de colores por emoción.
 * @returns {Record<string, string>}
 */
export function getEmotionColors() {
  return { ...EMOTION_COLORS };
}

/**
 * Calcula el tamaño de un nodo basándose en su peso y activaciones.
 * @param {object} neuron
 * @param {{ minSize?: number, maxSize?: number }} [options]
 * @returns {number} tamaño en píxeles
 */
export function computeNodeSize(neuron, options = {}) {
  const min  = options.minSize ?? 10;
  const max  = options.maxSize ?? 36;
  const w    = typeof neuron.weight        === "number" ? neuron.weight        : 0.5;
  const acts = typeof neuron.timesActivated === "number" ? neuron.timesActivated : 0;

  // Combinar peso y activaciones (ambos normalizados)
  const actBoost = Math.min(acts / 20, 1); // cap en 20 activaciones
  const score    = w * 0.6 + actBoost * 0.4;

  return Math.round(min + score * (max - min));
}

/**
 * Construye un grafo de nodos y edges a partir de las neuronas almacenadas.
 *
 * @param {object[]} neurons - array de neuronas
 * @param {{
 *   highlightIds?: string[],  // IDs de neuronas a resaltar (p.ej. recién activadas)
 *   newIds?:       string[],  // IDs de neuronas recién generadas
 *   mergedIds?:    string[],  // IDs de neuronas mergeadas recientemente
 *   colorBy?:      "domain" | "emotion",
 *   sizeBy?:       "weight" | "activations",
 *   minSize?:      number,
 *   maxSize?:      number,
 * }} [options]
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
 */
export function buildNeuronGraph(neurons, options = {}) {
  if (!Array.isArray(neurons)) {
    return { nodes: [], edges: [] };
  }

  const colorBy      = options.colorBy  || "domain";
  const highlightIds = new Set(options.highlightIds || []);
  const newIds       = new Set(options.newIds       || []);
  const mergedIds    = new Set(options.mergedIds    || []);

  // ---- Construir nodos ----
  const nodes = neurons.map((n) => {
    const key      = colorBy === "emotion" ? (n.emotion || "neutral") : (n.core?.domain || "general");
    const manualCategory = n.meta?.manualCategory || null;
    const isManual = n.source?.kind === "manual";
    const color    = isManual ? (n.meta?.colorTag || MANUAL_CATEGORY_COLORS[manualCategory] || FALLBACK_COLOR)
      : (colorBy === "emotion" ? getEmotionColor(key) : getDomainColor(key));
    const size     = computeNodeSize(n, { minSize: options.minSize, maxSize: options.maxSize });
    const isHighlight = highlightIds.has(n.id);
    const isNew       = newIds.has(n.id);
    const isMerged    = mergedIds.has(n.id);

    let status = "normal";
    if (isNew)       status = "new";
    else if (isMerged)    status = "merged";
    else if (isHighlight) status = "active";

    return {
      id:                n.id,
      label:             n.core?.concept   || n.id,
      domain:            n.core?.domain    || "general",
      summary:           n.core?.summary   || "",
      type:              n.type            || "memory",
      emotion:           n.emotion         || "neutral",
      weight:            typeof n.weight         === "number" ? n.weight         : 0.5,
      timesActivated:    typeof n.timesActivated === "number" ? n.timesActivated : 0,
      lastActivated:     n.lastActivated   || null,
      numberOfConnections: Array.isArray(n.connections) ? n.connections.length : 0,
      triggers:          Array.isArray(n.triggers)   ? n.triggers   : [],
      evidence:          Array.isArray(n.evidence)   ? n.evidence   : [],
      connections:       Array.isArray(n.connections) ? n.connections : [],
      aliases:           Array.isArray(n.meta?.aliases) ? n.meta.aliases : [],
      priority:          n.meta?.priority || "medium",
      pin:               Boolean(n.meta?.pin),
      manualCategory,
      notes:             n.meta?.notes || "",
      sourceKind:        n.source?.kind || "user",
      temporal:          n.temporal || null,
      feedbackStats: {
        likes: Number(n.feedbackStats?.likes) || 0,
        dislikes: Number(n.feedbackStats?.dislikes) || 0,
        netScore: Number(n.feedbackStats?.netScore) || ((Number(n.feedbackStats?.likes) || 0) - (Number(n.feedbackStats?.dislikes) || 0)),
      },
      activationLearning: {
        usefulCount: Number(n.activationLearning?.usefulCount) || 0,
        falsePositiveCount: Number(n.activationLearning?.falsePositiveCount) || 0,
      },
      evolution: n.evolution || null,
      isManual,
      deleted: Boolean(n.deleted),
      color,
      size,
      status,  // "normal" | "active" | "new" | "merged"
    };
  });

  const seen = new Set();
  const edges = [];
  const allRelations = (() => {
    try {
      return getAllRelations();
    } catch (_e) {
      return [];
    }
  })();
  const relationIndex = {};
  for (const rel of allRelations) {
    const key = [rel.sourceId, rel.targetId].sort().join("--");
    if (!relationIndex[key] || rel.strength > relationIndex[key].strength) {
      relationIndex[key] = rel;
    }
  }

  for (const n of neurons) {
    if (!Array.isArray(n.connections)) continue;
    for (const targetId of n.connections) {
      const edgeKey = [n.id, targetId].sort().join("--");
      if (seen.has(edgeKey)) continue;
      const targetExists = neurons.some((x) => x.id === targetId);
      if (!targetExists) continue;
      seen.add(edgeKey);

      const relation = relationIndex[edgeKey] || null;
      edges.push({
        id: edgeKey,
        source: n.id,
        target: targetId,
        connectionSource: relation?.origin || n.linkMeta?.[targetId]?.connectionSource || "auto",
        relationType: relation?.type || null,
        relationLabel: relation ? (RELATION_TYPE_LABELS[relation.type] || relation.type) : null,
        strength: relation?.strength ?? 0.5,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Filtra los nodos (y edges) de un grafo según criterios dados.
 *
 * @param {{ nodes: GraphNode[], edges: GraphEdge[] }} graph
 * @param {{
 *   domain?:   string | null,
 *   emotion?:  string | null,
 *   recentDays?: number | null,   // activadas en los últimos N días
 *   search?:   string | null,    // concepto o trigger que contiene el texto
 * }} filters
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
 */
export function filterGraphNodes(graph, filters = {}) {
  let nodes = graph.nodes;

  if (!filters.showDeleted) {
    nodes = nodes.filter((n) => !n.deleted);
  }

  if (filters.domain) {
    nodes = nodes.filter((n) => n.domain === filters.domain);
  }
  if (filters.emotion) {
    nodes = nodes.filter((n) => n.emotion === filters.emotion);
  }
  if (filters.recentDays != null && filters.recentDays > 0) {
    const cutoff = Date.now() - filters.recentDays * 86400000;
    nodes = nodes.filter((n) => {
      if (!n.lastActivated) return false;
      const ts = typeof n.lastActivated === "number"
        ? n.lastActivated
        : new Date(n.lastActivated).getTime();
      return ts >= cutoff;
    });
  }
  if (filters.sourceKind) {
    if (filters.sourceKind === "manual") nodes = nodes.filter((n) => n.isManual);
    else if (filters.sourceKind === "auto") nodes = nodes.filter((n) => !n.isManual);
  }
  if (filters.manualCategory) {
    nodes = nodes.filter((n) => n.manualCategory === filters.manualCategory);
  }
  if (filters.pinned != null) {
    nodes = nodes.filter((n) => Boolean(n.pin) === Boolean(filters.pinned));
  }
  if (filters.type) {
    nodes = nodes.filter((n) => n.type === filters.type);
  }
  // Reach filter (from Regulación)
  if (filters.reach === "importantes") {
    nodes = [...nodes].sort((a, b) => {
      const scoreA = (a.timesActivated || a.mentions || 0) + (a.numberOfConnections || a.degree || 0) * 0.5;
      const scoreB = (b.timesActivated || b.mentions || 0) + (b.numberOfConnections || b.degree || 0) * 0.5;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const lastA = typeof a.lastActivated === "number" ? a.lastActivated : (a.lastActivated ? new Date(a.lastActivated).getTime() : 0);
      const lastB = typeof b.lastActivated === "number" ? b.lastActivated : (b.lastActivated ? new Date(b.lastActivated).getTime() : 0);
      return lastB - lastA;
    }).slice(0, 40);
  } else if (filters.reach === "recientes") {
    const cutoff30d = Date.now() - 30 * 86400000;
    nodes = nodes.filter((n) => {
      if (!n.lastActivated) return false;
      const ts = typeof n.lastActivated === "number" ? n.lastActivated : new Date(n.lastActivated).getTime();
      return ts >= cutoff30d;
    });
  }

  if (filters.search && filters.search.trim()) {
    const normalizeText = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const lower = normalizeText(filters.search);
    nodes = nodes.filter((n) =>
      normalizeText(n.label).includes(lower) ||
      normalizeText(n.summary).includes(lower) ||
      n.triggers.some((t) => normalizeText(t).includes(lower)) ||
      n.aliases.some((a) => normalizeText(a).includes(lower))
    );
  }

  const visibleSet = new Set(nodes.map((n) => n.id));

  // Focus 1-hop neighbors mode (from Regulación)
  if (filters.focusId && graph.nodes.some((n) => n.id === filters.focusId)) {
    visibleSet.add(filters.focusId);
    for (const edge of graph.edges) {
      if (edge.source === filters.focusId) visibleSet.add(edge.target);
      if (edge.target === filters.focusId) visibleSet.add(edge.source);
    }
  }

  const finalNodes = graph.nodes.filter((n) => visibleSet.has(n.id));
  const finalEdges = graph.edges.filter(
    (e) => visibleSet.has(e.source) && visibleSet.has(e.target)
  );

  return { nodes: finalNodes, edges: finalEdges };
}

/**
 * Devuelve los dominios únicos presentes en un grafo.
 * @param {{ nodes: GraphNode[] }} graph
 * @returns {string[]}
 */
export function getGraphDomains(graph) {
  return [...new Set(graph.nodes.map((n) => n.domain))].sort();
}

/**
 * Devuelve las emociones únicas presentes en un grafo.
 * @param {{ nodes: GraphNode[] }} graph
 * @returns {string[]}
 */
export function getGraphEmotions(graph) {
  return [...new Set(graph.nodes.map((n) => n.emotion))].sort();
}

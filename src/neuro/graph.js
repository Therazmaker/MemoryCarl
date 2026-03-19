/**
 * graph.js — Construcción y utilidades del grafo neuronal
 * NeuroChat / MemoryCarl
 *
 * Exporta:
 *   buildNeuronGraph(neurons, options?)
 *   filterGraphNodes(graph, filters)
 *   getDomainColors()
 *   getEmotionColors()
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
  const colorMap     = colorBy === "emotion" ? EMOTION_COLORS : DOMAIN_COLORS;

  // ---- Construir nodos ----
  const nodes = neurons.map((n) => {
    const key      = colorBy === "emotion" ? (n.emotion || "neutral") : (n.core?.domain || "general");
    const manualCategory = n.meta?.manualCategory || null;
    const isManual = n.source?.kind === "manual";
    const color    = isManual ? (n.meta?.colorTag || MANUAL_CATEGORY_COLORS[manualCategory] || "#94a3b8") : (colorMap[key] || "#94a3b8");
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
      feedbackStats: {
        likes: Number(n.feedbackStats?.likes) || 0,
        dislikes: Number(n.feedbackStats?.dislikes) || 0,
        netScore: Number(n.feedbackStats?.netScore) || ((Number(n.feedbackStats?.likes) || 0) - (Number(n.feedbackStats?.dislikes) || 0)),
      },
      activationLearning: {
        usefulCount: Number(n.activationLearning?.usefulCount) || 0,
        falsePositiveCount: Number(n.activationLearning?.falsePositiveCount) || 0,
      },
      isManual,
      color,
      size,
      status,  // "normal" | "active" | "new" | "merged"
    };
  });

  // ---- Construir edges (sin duplicados) ----
  const seen  = new Set();
  const edges = [];

  for (const n of neurons) {
    if (!Array.isArray(n.connections)) continue;
    for (const targetId of n.connections) {
      const edgeKey = [n.id, targetId].sort().join("--");
      if (seen.has(edgeKey)) continue;
      // Solo crear edge si ambas neuronas existen
      const targetExists = neurons.some((x) => x.id === targetId);
      if (!targetExists) continue;
      seen.add(edgeKey);
      edges.push({
        id:     edgeKey,
        source: n.id,
        target: targetId,
        connectionSource: n.linkMeta?.[targetId]?.connectionSource || "auto",
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
  if (filters.search && filters.search.trim()) {
    const lower = filters.search.trim().toLowerCase();
    nodes = nodes.filter((n) =>
      n.label.toLowerCase().includes(lower) ||
      n.summary.toLowerCase().includes(lower) ||
      n.triggers.some((t) => t.toLowerCase().includes(lower)) ||
      n.aliases.some((a) => a.toLowerCase().includes(lower))
    );
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges   = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes, edges };
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

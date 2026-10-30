/**
 * neurograph-ui.js — Vista de grafo interactivo de neuronas
 * NeuroChat / MemoryCarl
 *
 * Renderizado en Canvas 2D con loop de animación real (requestAnimationFrame).
 * Force-directed layout con resortes, repulsión y amortiguación.
 * Drag suave, zoom con rueda, pan con arrastre de fondo.
 *
 * Exporta:
 *   viewNeuroGraph(sessionState?)
 *   wireNeuroGraph(root, sessionState?)
 */

import { getAllNeurons, updateNeuron, getNeuronById, updateNeuronTemporal, getNeuronDeletionImpact, deleteNeuronSafely, restoreSoftDeletedNeuron } from "../neuro/neuronStore.js";
import {
  buildNeuronGraph,
  filterGraphNodes,
  getGraphDomains,
  getGraphEmotions,
  getDomainColor,
  getEmotionColor,
} from "../neuro/graph.js";
import { linkNeurons, unlinkNeurons } from "../neuro/connections.js";
import { getNeuronCalibrationSummary } from "../neuro/feedback.js";
import { repairGraphWithClaude } from "../neuro/graphRepairEngine.js";

// ---- Etiquetas y colores de relaciones (la paleta de dominios/emociones vive en graph.js) ----
const DOMAIN_LABELS = {
  general:       "General",
  personal:      "Personal",
  work:          "Trabajo",
  health:        "Salud",
  finance:       "Finanzas",
  relationships: "Relaciones",
  habits:        "Hábitos",
  beliefs:       "Creencias",
  emotions:      "Emociones",
  learning:      "Aprendizaje",
  creativity:    "Creatividad",
};

const EMOTION_LABELS = {
  joy:       "alegría",
  sadness:   "tristeza",
  anger:     "enojo",
  fear:      "miedo",
  surprise:  "sorpresa",
  disgust:   "desagrado",
  curiosity: "curiosidad",
  pride:     "orgullo",
  shame:     "vergüenza",
  love:      "amor",
  neutral:   "neutral",
  mixed:     "mixta",
};

const RELATION_COLORS = {
  causa:        "#f87171",
  consecuencia: "#fb923c",
  refuerza:     "#34d399",
  contradice:   "#f472b6",
  parte_de:     "#60a5fa",
  precede_a:    "#fbbf24",
  resuelve:     "#a78bfa",
};

const RELATION_LABELS = {
  causa:        "causa",
  consecuencia: "consecuencia",
  refuerza:     "refuerza",
  contradice:   "contradice",
  parte_de:     "parte de",
  precede_a:    "precede a",
  resuelve:     "resuelve",
};

// Posiciones fijas guardadas entre sesiones
const LAYOUT_KEY = "memorycarl_neurograph_layout_v1";
const MIN_ZOOM   = 0.05;
const MAX_ZOOM   = 6;

// ---- Estado interno ----
const graphState = {
  graph:        { nodes: [], edges: [] },
  filters:      { domain: null, emotion: null, recentDays: null, search: "", sourceKind: null, manualCategory: null, pinned: null, showDeleted: false, reach: "todos", focusId: null },
  filtered:     { nodes: [], edges: [] },
  selectedNode: null,
  detailOpen:   false, // hoja de detalle abierta (la selección puede existir sin ella)
  positions:    {},    // id → { x, y } en coordenadas del mundo, fijas
  zoom:         1,
  pan:          { x: 0, y: 0 },
  camAnim:      null,  // animación de cámara en curso
  cameraReady:  false, // la cámara ya se encuadró una vez
  colorBy:      "domain",
  editorMode:   false,
  editorMsg:    "",
  animFrame:    null,
  hoveredNode:  null,
  canvas:       null,
  ctx:          null,
  width:        700,   // tamaño lógico en px CSS
  height:       500,
  dpr:          1,     // devicePixelRatio aplicado al canvas
  resizeObserver: null,
  menuCloseHandler: null,
  sessionState: {},
};

// ---- Helpers ----
function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString("es", { day: "2-digit", month: "short" });
  } catch (_e) { return String(ts); }
}

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return `rgba(148,163,184,${alpha})`;
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(h.slice(1, 3), 16) || 148;
  const g = parseInt(h.slice(3, 5), 16) || 163;
  const b = parseInt(h.slice(5, 7), 16) || 184;
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// Dynamic node sizing formula inspired by Regulación (getNodeSize)
function getNodeSize(n) {
  const mentions = (n.timesActivated || n.mentions || 0) + (n.numberOfConnections || n.degree || 0) * 0.5;
  return clamp(10 + 4 * Math.sqrt(mentions), 10, 32);
}

// Dynamic font sizing formula inspired by Regulación (getNodeFontSize)
function getNodeFontSize(n) {
  const mentions = (n.timesActivated || n.mentions || 0) + (n.numberOfConnections || n.degree || 0) * 0.5;
  return clamp(11 + Math.sqrt(mentions), 11, 18);
}

function nodeColor(n) {
  if (typeof n.color === "string" && n.color.startsWith("#")) return n.color;
  if (graphState.colorBy === "emotion") return getEmotionColor(n.emotion);
  return getDomainColor(n.domain);
}

function domainLabel(domain) {
  return DOMAIN_LABELS[domain] || domain;
}

function emotionLabel(emotion) {
  return EMOTION_LABELS[emotion] || emotion;
}

// Texto de la etiqueta; recortado salvo que se pida completo
function nodeLabel(n, full = false) {
  if (full) return n.label;
  const maxLabelChars = Math.max(10, Math.floor(getNodeSize(n) / 2));
  return n.label.length > maxLabelChars ? n.label.slice(0, maxLabelChars) + "…" : n.label;
}

// ---- Layout fijo ----
// Las posiciones se calculan una vez, se guardan y no se mueven al interactuar.
// Las neuronas nuevas se colocan junto a sus conexiones sin mover las existentes.

function loadSavedLayout() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LAYOUT_KEY) : null;
    const parsed = JSON.parse(raw || "{}");
    const out = {};
    for (const [id, p] of Object.entries(parsed || {})) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x, y: p.y };
    }
    return out;
  } catch (_e) { return {}; }
}

function saveLayout() {
  try {
    if (typeof localStorage === "undefined") return;
    const out = {};
    for (const n of graphState.graph.nodes) {
      const p = graphState.positions[n.id];
      if (p) out[n.id] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(out));
  } catch (_e) { /* cuota llena: el layout se recalcula la próxima vez */ }
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }
  return adj;
}

// Simulación de fuerzas síncrona (estilo ForceAtlas2 de Regulación), sin dibujar.
// Los nodos en `pinned` no se mueven pero sí empujan a los demás.
function runLayout(nodes, edges, pinned, iterations) {
  const GRAVITATIONAL_CONSTANT = 30;
  const CENTRAL_GRAVITY        = 0.01;
  const SPRING_LENGTH          = 85;
  const SPRING_CONSTANT        = 0.08;
  const DAMPING                = 0.72;
  const MAX_SPEED              = 15;

  const pos = graphState.positions;
  const live = nodes.filter(n => pos[n.id]);
  const vel = new Map(live.map(n => [n.id, { vx: 0, vy: 0 }]));
  const deg = new Map(live.map(n => [n.id, (n.numberOfConnections || 1) + 1]));
  let alpha = 1;

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < live.length; i++) {
      const idA = live[i].id;
      const a = pos[idA];
      const va = vel.get(idA);
      for (let j = i + 1; j < live.length; j++) {
        const idB = live[j].id;
        const b = pos[idB];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy || 1;
        const dist  = Math.sqrt(dist2);
        const force = ((GRAVITATIONAL_CONSTANT * 180 * deg.get(idA) * deg.get(idB)) / dist2) * alpha;
        const vb = vel.get(idB);
        va.vx -= (dx / dist) * force;
        va.vy -= (dy / dist) * force;
        vb.vx += (dx / dist) * force;
        vb.vy += (dy / dist) * force;
      }
    }
    for (const e of edges) {
      const a = pos[e.source];
      const b = pos[e.target];
      const va = vel.get(e.source);
      const vb = vel.get(e.target);
      if (!a || !b || !va || !vb) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - SPRING_LENGTH) * SPRING_CONSTANT * alpha;
      va.vx += (dx / dist) * force;
      va.vy += (dy / dist) * force;
      vb.vx -= (dx / dist) * force;
      vb.vy -= (dy / dist) * force;
    }
    for (const n of live) {
      if (pinned.has(n.id)) continue;
      const p = pos[n.id];
      const v = vel.get(n.id);
      v.vx = (v.vx - p.x * CENTRAL_GRAVITY * alpha) * DAMPING;
      v.vy = (v.vy - p.y * CENTRAL_GRAVITY * alpha) * DAMPING;
      const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
      if (speed > MAX_SPEED) {
        v.vx = (v.vx / speed) * MAX_SPEED;
        v.vy = (v.vy / speed) * MAX_SPEED;
      }
      p.x += v.vx;
      p.y += v.vy;
    }
    alpha *= 0.985;
  }
}

// Garantiza que todas las neuronas del grafo tengan posición. Devuelve true si calculó algo.
function ensureLayout() {
  const { nodes, edges } = graphState.graph;
  const pos = graphState.positions;
  if (!Object.keys(pos).length) Object.assign(pos, loadSavedLayout());

  const missing = nodes.filter(n => !pos[n.id]);
  if (!missing.length) return false;

  const fresh = missing.length === nodes.length;
  const adj = buildAdjacency(edges);
  const radius = 60 + Math.sqrt(nodes.length) * 40;
  missing.forEach((n, i) => {
    // Junto a sus vecinos ya colocados; si no tiene, en una espiral alrededor del centro
    const placed = [...(adj.get(n.id) || [])].map(id => pos[id]).filter(Boolean);
    if (placed.length) {
      const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
      const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length;
      pos[n.id] = { x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 60 };
    } else {
      const angle = i * 2.399963; // ángulo áureo
      const r = fresh ? radius * Math.sqrt((i + 0.5) / missing.length) : radius + 40;
      pos[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
  });

  const pinned = fresh ? new Set() : new Set(nodes.filter(n => !missing.includes(n)).map(n => n.id));
  const iterations = fresh ? (nodes.length > 600 ? 120 : 300) : 120;
  runLayout(nodes, edges, pinned, iterations);
  saveLayout();
  return true;
}

// ---- Cámara ----
function canvasToWorld(cx, cy) {
  return {
    x: (cx - graphState.pan.x) / graphState.zoom,
    y: (cy - graphState.pan.y) / graphState.zoom,
  };
}

function cameraCenter() {
  return canvasToWorld(graphState.width / 2, graphState.height / 2);
}

function setCamera(center, zoom) {
  graphState.zoom  = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  graphState.pan.x = graphState.width  / 2 - center.x * graphState.zoom;
  graphState.pan.y = graphState.height / 2 - center.y * graphState.zoom;
}

// Mueve la cámara con animación (centro lineal, zoom geométrico)
function flyTo(center, zoom, duration = 450) {
  const from = { center: cameraCenter(), zoom: graphState.zoom };
  const to   = { center, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
  if (!duration) {
    graphState.camAnim = null;
    setCamera(to.center, to.zoom);
    requestFrame();
    return;
  }
  graphState.camAnim = { from, to, start: performance.now(), duration };
  requestFrame();
}

function stepCamera(now) {
  const anim = graphState.camAnim;
  if (!anim) return;
  const t = clamp((now - anim.start) / anim.duration, 0, 1);
  const e = 1 - Math.pow(1 - t, 3); // ease-out
  setCamera({
    x: anim.from.center.x + (anim.to.center.x - anim.from.center.x) * e,
    y: anim.from.center.y + (anim.to.center.y - anim.from.center.y) * e,
  }, anim.from.zoom * Math.pow(anim.to.zoom / anim.from.zoom, e));
  if (t >= 1) graphState.camAnim = null;
}

// Zoom manteniendo fijo el punto de pantalla (sx, sy)
function zoomAt(sx, sy, newZoom, duration = 0) {
  const world = canvasToWorld(sx, sy);
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const center = {
    x: world.x + (graphState.width  / 2 - sx) / z,
    y: world.y + (graphState.height / 2 - sy) / z,
  };
  flyTo(center, z, duration);
}

// Encuadra un conjunto de nodos
function fitView(nodes = graphState.filtered.nodes, duration = 450) {
  const pts = nodes.map(n => graphState.positions[n.id]).filter(Boolean);
  if (!pts.length) return;
  const pad = 40;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bw = Math.max(maxX - minX, 1) + pad * 2;
  const bh = Math.max(maxY - minY, 1) + pad * 2;
  const zoom = Math.min(graphState.width / bw, graphState.height / bh, 1.6);
  flyTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, zoom, duration);
}

function neighborIds(id) {
  const out = new Set();
  for (const e of graphState.graph.edges) {
    if (e.source === id) out.add(e.target);
    if (e.target === id) out.add(e.source);
  }
  return out;
}

// Centra la neurona y acerca lo justo para que se vean sus conexiones
function focusNode(n) {
  const p = graphState.positions[n.id];
  if (!p) return;
  let maxDx = 60, maxDy = 60;
  for (const id of neighborIds(n.id)) {
    const q = graphState.positions[id];
    if (!q) continue;
    maxDx = Math.max(maxDx, Math.abs(q.x - p.x));
    maxDy = Math.max(maxDy, Math.abs(q.y - p.y));
  }
  const margin = 50;
  const zoom = Math.min(
    (graphState.width  / 2 - margin) / maxDx,
    (graphState.height / 2 - margin - 60) / maxDy, // deja sitio a la barra de conexiones
  );
  flyTo({ x: p.x, y: p.y }, clamp(zoom, 0.9, 2.5));
}

// ---- Renderizado Canvas ----
function drawGraph() {
  const { ctx, width, height, dpr, filtered, positions, selectedNode, hoveredNode, zoom, pan } = graphState;
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

  const { nodes, edges } = filtered;
  const timestamp = Date.now();
  const focusSet  = selectedNode ? neighborIds(selectedNode.id) : null;
  if (focusSet) focusSet.add(selectedNode.id);
  const px = 1 / zoom; // 1 px de pantalla en unidades del mundo

  // Recorte: solo se dibuja lo que cae en pantalla
  const view = {
    minX: -pan.x / zoom - 60, minY: -pan.y / zoom - 60,
    maxX: (width - pan.x) / zoom + 60, maxY: (height - pan.y) / zoom + 60,
  };
  const inView = (p) => p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY;

  // --- Edges ---
  for (const edge of edges) {
    const a = positions[edge.source];
    const b = positions[edge.target];
    if (!a || !b || (!inView(a) && !inView(b))) continue;

    const relColor = edge.relationType ? RELATION_COLORS[edge.relationType] || null : null;
    const touchesSelection = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (touchesSelection) {
      ctx.strokeStyle = relColor || hexToRgba(nodeColor(selectedNode), 0.85);
      ctx.lineWidth   = 2.2 * px;
    } else if (selectedNode) {
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth   = 1 * px;
    } else {
      ctx.strokeStyle = relColor ? hexToRgba(relColor, 0.55) : "rgba(203,213,225,0.16)";
      ctx.lineWidth   = (relColor ? 1.5 : 1) * px;
    }
    ctx.stroke();

    // Flecha en mitad si hay tipo de relación
    if (edge.relationType && touchesSelection) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.scale(px, px);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-8, -4);
      ctx.lineTo(-8,  4);
      ctx.closePath();
      ctx.fillStyle = relColor || "rgba(167,139,250,0.9)";
      ctx.fill();
      ctx.restore();
    }
  }

  // --- Nodos: puntos cuando están lejos, anillos al acercarse ---
  const labels = [];
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p || !inView(p)) continue;
    const r          = Math.max(getNodeSize(n), 2.5 * px);
    const screenR    = r * zoom;
    const color      = nodeColor(n);
    const isSelected = selectedNode?.id === n.id;
    const isHovered  = hoveredNode?.id  === n.id;
    const isNeighbor = Boolean(focusSet?.has(n.id)) && !isSelected;
    const dimmed     = Boolean(focusSet) && !focusSet.has(n.id);
    const pulse      = Math.sin(timestamp / 700) * 0.5 + 0.5;

    ctx.globalAlpha = dimmed ? 0.16 : 1;

    // Halo animado para nodos activos/nuevos
    if (n.status === "active" || n.status === "new") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + (5 + pulse * 4) * px, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(n.status === "new" ? "#34d399" : "#a78bfa", 0.2 + pulse * 0.25);
      ctx.lineWidth   = 2.5 * px;
      ctx.stroke();
    }

    if (isSelected || isHovered) {
      ctx.shadowColor = hexToRgba(color, 0.8);
      ctx.shadowBlur  = 18;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (screenR < 7) {
      // Lejos: punto sólido, se lee mejor que un anillo diminuto
      ctx.fillStyle = hexToRgba(color, 0.95);
      ctx.fill();
    } else {
      // Base opaca para que las líneas no se transparenten dentro del anillo
      ctx.fillStyle = "#0f0d19";
      ctx.fill();
      if (isSelected || isHovered) {
        ctx.fillStyle = hexToRgba(color, isSelected ? 0.35 : 0.25);
        ctx.fill();
      }
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = isSelected ? "#ffffff" : hexToRgba(color, isHovered ? 1 : 0.9);
      ctx.lineWidth   = isSelected ? 3 * px : Math.max(r * 0.2, 1.5 * px);
      ctx.stroke();
    }
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    if (n.pin && screenR >= 7) {
      ctx.beginPath();
      ctx.arc(p.x + r * 0.7, p.y - r * 0.7, Math.max(3.5, r * 0.18), 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.fill();
    }

    // Etiquetas: aparecen al acercarse; la seleccionada y sus vecinas siempre
    const showLabel = !dimmed && (screenR >= 13 || isSelected || isHovered || isNeighbor);
    if (showLabel) labels.push({ n, p, r, isSelected, isHovered, full: isSelected || isNeighbor || zoom >= 1.6 });
  }
  ctx.globalAlpha = 1;

  // Las etiquetas van encima de todos los nodos, con tamaño constante en pantalla
  for (const { n, p, r, isSelected, isHovered, full } of labels) {
    const fontPx = Math.min(getNodeFontSize(n), 15) + (isSelected ? 2 : 0);
    ctx.font = `${isSelected ? 700 : 500} ${fontPx * px}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    const text = nodeLabel(n, full);
    const y = p.y + r + 5 * px;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(10,8,20,0.72)";
    ctx.beginPath();
    ctx.roundRect?.(p.x - w / 2 - 5 * px, y - 2 * px, w + 10 * px, (fontPx + 5) * px, 6 * px);
    ctx.fill();
    ctx.fillStyle = isSelected ? "#ffffff" : isHovered ? "#f8fafc" : "rgba(241,245,249,0.92)";
    ctx.fillText(text, p.x, y);
  }

  ctx.restore();
}

// ---- Loop principal ----
// Solo se anima mientras la cámara se mueve o hay nodos activos/nuevos pulsando.
function needsAnimation() {
  if (graphState.camAnim) return true;
  return graphState.filtered.nodes.some(n => n.status === "active" || n.status === "new");
}

function loop(now) {
  graphState.animFrame = null;
  if (!graphState.canvas?.isConnected) return; // la vista se desmontó
  stepCamera(now ?? performance.now());
  drawGraph();
  if (needsAnimation()) graphState.animFrame = requestAnimationFrame(loop);
}

// Pide un frame; si el loop estaba dormido, lo despierta.
function requestFrame() {
  if (graphState.animFrame || !graphState.canvas) return;
  graphState.animFrame = requestAnimationFrame(loop);
}

function startLoop() {
  stopLoop();
  requestFrame();
}

function stopLoop() {
  if (graphState.animFrame) {
    cancelAnimationFrame(graphState.animFrame);
    graphState.animFrame = null;
  }
}

// Nodo más cercano al punto, con margen extra para dedos
function hitTest(wx, wy, slopPx = 6) {
  let best = null;
  let bestDist = Infinity;
  for (const n of graphState.filtered.nodes) {
    const p = graphState.positions[n.id];
    if (!p) continue;
    const r = Math.max(getNodeSize(n), 2.5 / graphState.zoom) + slopPx / graphState.zoom;
    const d = Math.hypot(wx - p.x, wy - p.y);
    if (d <= r && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

// ---- Selección ----
function selectNode(root, n, { fly = true } = {}) {
  graphState.selectedNode    = n;
  graphState.filters.focusId = n ? n.id : null; // muestra sus vecinas aunque un filtro las oculte
  graphState.editorMode      = false;
  graphState.editorMsg       = "";
  if (!n) graphState.detailOpen = false;
  applyFiltersAndRerender(root, graphState.sessionState);
  rerenderDetailPanel(root);
  wireDetailPanel(root, graphState.sessionState);
  renderPeek(root);
  if (n && fly) focusNode(n);
  requestFrame();
}

// Barra inferior con la neurona seleccionada y sus conexiones para saltar entre ellas
function renderPeek(root) {
  const el = root.querySelector("#ngPeek");
  if (!el) return;
  const n = graphState.selectedNode;
  if (!n) {
    el.classList.remove("show");
    el.innerHTML = "";
    return;
  }
  const byId = new Map(graphState.graph.nodes.map(x => [x.id, x]));
  const neighbors = [...neighborIds(n.id)].map(id => byId.get(id)).filter(Boolean)
    .sort((a, b) => getNodeSize(b) - getNodeSize(a));
  el.innerHTML = `
    <div class="ngPeekHead">
      <span class="ngPeekDot" style="background:${nodeColor(n)}"></span>
      <span class="ngPeekTitle">${esc(n.label)}</span>
      <button class="ngPeekBtn" data-peek-detail>Detalle</button>
      <button class="ngPeekClose" data-peek-close title="Quitar selección">✕</button>
    </div>
    <div class="ngPeekLinks">
      ${neighbors.length
        ? `<span class="ngPeekLabel">Conectada con</span>${neighbors.map(x =>
            `<button class="ngPeekChip" data-goto="${esc(x.id)}"><span class="ngPeekDot" style="background:${nodeColor(x)}"></span>${esc(x.label)}</button>`
          ).join("")}`
        : `<span class="ngPeekLabel">Sin conexiones</span>`}
    </div>`;
  el.classList.add("show");
}

function goToNode(root, id) {
  const target = graphState.graph.nodes.find(x => x.id === id);
  if (target) selectNode(root, target);
}

// ---- Wiring del Canvas: pellizco para zoom, un dedo para mover, toque para seleccionar ----
function wireCanvas(root) {
  const canvas = graphState.canvas;
  if (!canvas) return;

  const pointers = new Map(); // pointerId → { x, y }
  let gesture  = null;
  let lastTap  = { t: 0, x: 0, y: 0 };

  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startPan(pt, moved = false) {
    gesture = { type: "pan", startX: pt.x, startY: pt.y, panX: graphState.pan.x, panY: graphState.pan.y, moved };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture = {
      type: "pinch",
      startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      startZoom: graphState.zoom,
      worldMid:  canvasToWorld(mid.x, mid.y),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    graphState.camAnim = null; // el dedo manda sobre cualquier animación
    pointers.set(e.pointerId, getXY(e));
    if (pointers.size === 1) startPan(getXY(e));
    else if (pointers.size === 2) startPinch();
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    const pt = getXY(e);
    if (!pointers.has(e.pointerId)) {
      // Ratón sin botón pulsado: hover
      const { x, y } = canvasToWorld(pt.x, pt.y);
      const hit = hitTest(x, y, 2) || null;
      if (hit?.id !== graphState.hoveredNode?.id) {
        graphState.hoveredNode = hit;
        requestFrame();
      }
      canvas.style.cursor = hit ? "pointer" : "grab";
      return;
    }
    pointers.set(e.pointerId, pt);

    if (gesture?.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid  = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      graphState.zoom  = clamp(gesture.startZoom * (dist / gesture.startDist), MIN_ZOOM, MAX_ZOOM);
      graphState.pan.x = mid.x - gesture.worldMid.x * graphState.zoom;
      graphState.pan.y = mid.y - gesture.worldMid.y * graphState.zoom;
      requestFrame();
    } else if (gesture?.type === "pan") {
      const dx = pt.x - gesture.startX;
      const dy = pt.y - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) > 6) gesture.moved = true;
      if (gesture.moved) {
        graphState.pan.x = gesture.panX + dx;
        graphState.pan.y = gesture.panY + dy;
        canvas.style.cursor = "grabbing";
        requestFrame();
      }
    }
  });

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    const pt = getXY(e);
    pointers.delete(e.pointerId);
    const wasTap = gesture?.type === "pan" && !gesture.moved && pointers.size === 0 && e.type === "pointerup";

    if (pointers.size === 1) {
      // De pellizco a un dedo: seguir moviendo sin que cuente como toque
      startPan([...pointers.values()][0], true);
      return;
    }
    if (pointers.size === 0) gesture = null;
    canvas.style.cursor = "grab";
    if (!wasTap) return;

    const now = performance.now();
    const isDoubleTap = now - lastTap.t < 320 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 30;
    lastTap = { t: isDoubleTap ? 0 : now, x: pt.x, y: pt.y };

    const { x, y } = canvasToWorld(pt.x, pt.y);
    const hit = hitTest(x, y, e.pointerType === "touch" ? 14 : 4);
    if (hit) {
      selectNode(root, hit);
    } else if (isDoubleTap) {
      zoomAt(pt.x, pt.y, graphState.zoom * 2, 300);
    } else if (graphState.selectedNode) {
      selectNode(root, null);
    }
  }
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("pointerleave", () => {
    if (graphState.hoveredNode && !pointers.size) {
      graphState.hoveredNode = null;
      requestFrame();
    }
  });

  // Rueda / trackpad: zoom centrado en el cursor
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { x, y } = getXY(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(x, y, graphState.zoom * factor);
  }, { passive: false });
}

// ---- Panel de detalle ----
function renderNodeDetail() {
  const n = graphState.selectedNode;
  if (!n) {
    return `<div class="ngDetail ngDetailEmpty">
      <div style="font-size:32px;margin-bottom:8px;opacity:.4">✦</div>
      <div>Haz clic en una neurona para ver su detalle.</div>
    </div>`;
  }
  if (graphState.editorMode) return renderNodeEditor(n);

  const color   = nodeColor(n);
  const fullN   = getNeuronById(n.id) || n;
  const evo     = fullN.evolution || {};
  const calib   = getNeuronCalibrationSummary(fullN);
  const calibCls = { very_positive: "pos", positive: "pos", very_negative: "neg", negative: "neg" }[calib.badge] || "neu";

  const triggersHtml = n.triggers.length
    ? n.triggers.map(t => `<span class="ngTag">${esc(t)}</span>`).join(" ")
    : `<span style="opacity:.3">—</span>`;

  const connections = n.connections || [];
  const connectionsHtml = connections.length
    ? connections.slice(0, 8).map(cid => {
        const cn    = graphState.graph.nodes.find(x => x.id === cid);
        const label = cn ? cn.label : `[${cid.slice(0, 10)}…]`;
        return `<div class="ngConnItem">
          <button class="ngTag ngConnGoto" data-goto="${esc(cid)}" title="Ir a esta neurona">${esc(label)}</button>
          <button class="ngUnlinkBtn" data-source="${esc(n.id)}" data-target="${esc(cid)}" title="Quitar">✕</button>
        </div>`;
      }).join("")
    : `<div style="opacity:.3;font-size:11px">Sin conexiones</div>`;

  const statusBadge = n.status !== "normal"
    ? `<span class="ngStatusBadge ngStatusBadge--${n.status}">${{ active: "⚡ Activada", new: "✨ Nueva", merged: "🔀 Mergeada" }[n.status] || n.status}</span>`
    : "";

  const temporalLine = [
    fullN.temporal?.date,
    fullN.temporal?.isPast ? "pasado" : "",
    fullN.temporal?.stage,
    fullN.temporal?.timeContext,
  ].filter(Boolean).join(" · ");

  return `
    <div class="ngDetail">
      <div class="ngSheetHandleBar"><div class="ngSheetHandle"></div></div>
      <div class="ngDetailTopRow">
        <div class="ngDetailHeader" style="border-left: 3px solid ${color}; padding-left: 10px; flex:1;">
          <div class="ngDetailConcept">${esc(n.label)}</div>
          <div class="ngDetailType">${esc(n.type)} · ${esc(domainLabel(n.domain))}</div>
          ${statusBadge}
        </div>
        <button class="ngBtnCloseSheet" id="ngBtnCloseDetail" title="Cerrar detalles">✕</button>
      </div>

      ${n.summary ? `<div class="ngDetailSummary">${esc(n.summary)}</div>` : ""}
      ${temporalLine ? `<div class="ngMeta">🕒 ${esc(temporalLine)}</div>` : ""}

      <div class="ngCalibBadge ngCalib--${calibCls}">
        👍 ${calib.likes} · 👎 ${calib.dislikes} · neto ${calib.netScore >= 0 ? "+" : ""}${calib.netScore}
        <span style="opacity:.6;margin-left:4px">${esc(calib.label)}</span>
      </div>

      <div class="ngDetailGrid">
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Emoción</div><div>${esc(emotionLabel(n.emotion))}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Peso</div><div>${typeof n.weight === "number" ? n.weight.toFixed(2) : "—"}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Activaciones</div><div>${n.timesActivated}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Conexiones</div><div>${n.numberOfConnections}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Última activación</div><div>${fmtDate(n.lastActivated)}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Falsos positivos</div><div>${n.activationLearning?.falsePositiveCount ?? 0}</div></div>
      </div>

      ${n.aliases?.length ? `<div class="ngMeta">Alias: ${esc(n.aliases.join(", "))}</div>` : ""}
      ${n.notes ? `<div class="ngMeta">📝 ${esc(n.notes)}</div>` : ""}

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Triggers</div>
        <div class="ngTagList">${triggersHtml}</div>
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Evolución</div>
        <div class="ngMeta">uso: ${evo.usageCount || 0} · ok: ${evo.successfulActivations || 0} · fail: ${evo.failedActivations || 0}</div>
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Conexiones (${connections.length})</div>
        <div class="ngConnList">${connectionsHtml}</div>
        <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
          <input id="ngConnTarget" class="ngInput" style="flex:1;min-width:0" placeholder="Concepto o ID…" />
          <button class="ngBtn" id="ngBtnAddConn">+ Conectar</button>
        </div>
      </div>

      <div style="margin-top:12px">
        <button class="ngBtn ngBtn--primary" id="ngBtnOpenEditor" style="width:100%">✏️ Editar neurona</button>
        <button class="ngBtn" id="ngBtnDeleteNeuron" style="width:100%;margin-top:8px">🗑️ Eliminar neurona</button>
        ${n.deleted ? '<button class="ngBtn" id="ngBtnRestoreNeuron" style="width:100%;margin-top:8px">♻️ Restaurar neurona</button>' : ""}
      </div>
    </div>`;
}

function renderNodeEditor(n) {
  const fullN = getNeuronById(n.id) || n;
  const msg   = graphState.editorMsg
    ? `<div class="ngEditorMsg ${graphState.editorMsg.startsWith("✓") ? "ok" : "err"}">${esc(graphState.editorMsg)}</div>`
    : "";

  return `
    <div class="ngDetail ngEditor">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px">✏️ ${esc(n.label)}</div>
        <button class="ngBtn" id="ngBtnCancelEditor">✕ Cancelar</button>
      </div>
      ${msg}
      <form id="ngEditorForm">
        <input type="hidden" name="id" value="${esc(n.id)}" />
        <label class="ngEditorLabel">Concepto</label>
        <input name="concept" class="ngInput" value="${esc(fullN.core?.concept || "")}" required />
        <label class="ngEditorLabel">Resumen</label>
        <textarea name="summary" class="ngInput" rows="2">${esc(fullN.core?.summary || "")}</textarea>
        <label class="ngEditorLabel">Dominio</label>
        <input name="domain" class="ngInput" value="${esc(fullN.core?.domain || "")}" />
        <label class="ngEditorLabel">Emoción</label>
        <input name="emotion" class="ngInput" value="${esc(fullN.emotion || "neutral")}" />
        <label class="ngEditorLabel">Triggers (coma)</label>
        <input name="triggers" class="ngInput" value="${esc((fullN.triggers || []).join(", "))}" />
        <label class="ngEditorLabel">Fecha</label>
        <input type="date" name="date" class="ngInput" value="${esc(fullN.temporal?.date || "")}" />
        <label class="ngEditorLabel">Etapa</label>
        <input name="stage" class="ngInput" value="${esc(fullN.temporal?.stage || "")}" />
        <label class="ngEditorLabel" style="flex-direction:row;gap:6px;align-items:center;display:flex">
          <input type="checkbox" name="isHistorical" ${fullN.temporal?.isHistorical ? "checked" : ""} /> Histórico
        </label>
        <label class="ngEditorLabel">Alias (coma)</label>
        <input name="aliases" class="ngInput" value="${esc((fullN.meta?.aliases || []).join(", "))}" />
        <label class="ngEditorLabel">Prioridad</label>
        <select name="priority" class="ngInput">
          <option value="low"    ${fullN.meta?.priority === "low"    ? "selected" : ""}>Baja</option>
          <option value="medium" ${(!fullN.meta?.priority || fullN.meta?.priority === "medium") ? "selected" : ""}>Media</option>
          <option value="high"   ${fullN.meta?.priority === "high"   ? "selected" : ""}>Alta</option>
        </select>
        <label class="ngEditorLabel" style="flex-direction:row;gap:6px;align-items:center;display:flex">
          <input type="checkbox" name="pin" ${fullN.meta?.pin ? "checked" : ""} /> Fijar
        </label>
        <label class="ngEditorLabel">Notas</label>
        <textarea name="notes" class="ngInput" rows="2">${esc(fullN.meta?.notes || "")}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="submit" class="ngBtn ngBtn--primary" style="flex:1">💾 Guardar</button>
          <button type="button" id="ngBtnCancelEditor2" class="ngBtn" style="flex:1">Cancelar</button>
        </div>
      </form>
    </div>`;
}

// ---- Barra de filtros e interfaz estilo Regulación ----
function renderFiltersBar() {
  const { graph, filtered, filters } = graphState;
  const domains  = getGraphDomains(graph);

  const reach = filters.reach || "importantes";

  return `
    <div class="ngFiltersContainer">
      <div class="ngSearchRow">
        <div class="ngSearchWrapper">
          <span class="ngSearchIcon">🔍</span>
          <input type="search" class="ngSearchInput" id="ngSearch" placeholder="Buscar nodos…" value="${esc(filters.search || "")}" />
          <span class="ngCountBadge">${filtered.nodes.length} de ${graph.nodes.length}</span>
        </div>
      </div>

      <!-- Strip unificado de filtros y categorías -->
      <div class="ngFilterStrip">
        <div class="ngReachGroup">
          <button class="ngReachBtn ${reach === "importantes" ? "active" : ""}" data-reach="importantes">Importantes</button>
          <button class="ngReachBtn ${reach === "recientes" ? "active" : ""}" data-reach="recientes">Recientes</button>
          <button class="ngReachBtn ${reach === "todos" ? "active" : ""}" data-reach="todos">Completo</button>
        </div>
        <div class="ngChipDivider"></div>
        <div class="ngCategoryChips">
          <button class="ngChipBtn ${!filters.domain ? "active" : ""}" data-domain-chip="">Todas las áreas</button>
          ${domains.map(d => {
            const isSelected = filters.domain === d;
            const color = getDomainColor(d);
            return `<button class="ngChipBtn ${isSelected ? "active" : ""}" data-domain-chip="${esc(d)}" style="${isSelected ? `background:${hexToRgba(color, 0.2)};border-color:${color};color:${color};font-weight:700` : ''}"><span class="ngChipDot" style="background:${color}"></span>${esc(domainLabel(d))}</button>`;
          }).join("")}
        </div>
      </div>
    </div>`;
}

// ---- Vista principal ----
function ngraphInner(sessionState = {}) {
  const { graph } = graphState;
  return `
    <div class="ngWrap">
      ${ngCss()}
      <div class="ngHeader">
        <div class="ngHeaderLeft">
          <div class="ngHeaderIcon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="12" cy="18" r="3" />
              <path d="M8.5 7.5L10.5 15.5" />
              <path d="M15.5 7.5L13.5 15.5" />
              <path d="M9 6h6" />
            </svg>
          </div>
          <div class="ngHeaderTitle">Grafo de Conexiones</div>
        </div>
        <div class="ngHeaderRight">
          <span class="ngNodePill">${graph.nodes.length} nodos</span>
          <div class="ngMenuWrap">
            <button class="ngMenuBtn" id="ngMenuBtn" title="Opciones del grafo">⋮</button>
            <div class="ngMenuDropdown" id="ngMenuDropdown">
              <button class="ngMenuItem" id="ngBtnRepairGraph">✨ Reparar con Claude</button>
              <button class="ngMenuItem" id="ngBtnRefresh">↺ Refrescar grafo</button>
              <button class="ngMenuItem" id="ngBtnZoomReset">⊙ Centrar vista</button>
              <button class="ngMenuItem" id="ngBtnResetPositions">⟲ Reiniciar posiciones</button>
              <div class="ngMenuDivider"></div>
              <label class="ngMenuItem ngMenuLabel">
                <input type="checkbox" id="ngFilterShowDeleted" ${graphState.filters.showDeleted ? "checked" : ""}/>
                Mostrar eliminadas
              </label>
            </div>
          </div>
        </div>
      </div>

      ${renderFiltersBar()}

      <div class="ngLayout">
        <div class="ngGraphArea" id="ngGraphArea">
          <canvas id="ngCanvas"></canvas>
          <div class="ngPeek" id="ngPeek"></div>
          <div class="ngHint" id="ngHint">Pellizca para acercar · toca una neurona para seguir sus conexiones</div>
          <div class="ngZoomFloatingControls">
            <button class="ngCircleBtn" id="ngBtnZoomIn" title="Acercar">+</button>
            <button class="ngCircleBtn" id="ngBtnZoomOut" title="Alejar">−</button>
          </div>
        </div>
        <details class="ngLegendBar" id="ngLegendBar">
          <summary>Leyenda</summary>
          ${buildLegend()}
        </details>
        <div class="ngDetailPanel" id="ngDetailPanel">
          ${renderNodeDetail()}
        </div>
      </div>
    </div>`;
}

function buildLegend() {
  const items = [
    { color: "#a78bfa", label: "Activada" },
    { color: "#34d399", label: "Nueva" },
    { color: "#fbbf24", label: "Fijada" },
  ];
  const relItems = Object.entries(RELATION_COLORS).map(([type, color]) =>
    `<span class="ngLegItem"><span class="ngLegLine" style="background:${color}"></span>${esc(RELATION_LABELS[type] || type)}</span>`
  ).join("");

  return `
    <div class="ngLegend">
      <div class="ngLegGroup">
        <span class="ngLegGroupTitle">Estado</span>
        ${items.map(i => `<span class="ngLegItem"><span class="ngLegDot" style="background:${i.color}"></span>${i.label}</span>`).join("")}
      </div>
      <div class="ngLegGroup">
        <span class="ngLegGroupTitle">Relaciones</span>
        ${relItems}
      </div>
    </div>`;
}

// ---- Inicializar canvas después de insertar en DOM ----
// Ajusta el canvas al tamaño real del área y a la densidad de la pantalla.
// Devuelve true si el tamaño cambió.
function resizeCanvas(area) {
  const canvas = graphState.canvas;
  if (!canvas || !area) return false;
  const w   = Math.round(area.clientWidth  || 700);
  const h   = Math.round(area.clientHeight || Math.max(540, Math.floor(window.innerHeight - 210)));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (w === graphState.width && h === graphState.height && dpr === graphState.dpr
    && canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) {
    return false;
  }
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  graphState.width  = w;
  graphState.height = h;
  graphState.dpr    = dpr;
  return true;
}

function initCanvas(root) {
  const canvas = root.querySelector("#ngCanvas");
  const area   = root.querySelector("#ngGraphArea");
  if (!canvas || !area) return;

  // Si la vista se re-renderiza, se conserva el encuadre actual
  const center = graphState.cameraReady ? cameraCenter() : null;
  graphState.canvas = canvas;
  graphState.ctx    = canvas.getContext("2d");
  resizeCanvas(area);
  ensureLayout();

  if (center) {
    setCamera(center, graphState.zoom);
  } else {
    // Al abrir: toda la red a la vista, neuronas pequeñas
    fitView(graphState.filtered.nodes, 0);
    graphState.cameraReady = true;
  }
}

// ---- Detalle y editor ----
function rerenderDetailPanel(root) {
  const panel = root.querySelector("#ngDetailPanel");
  if (panel) {
    panel.innerHTML = renderNodeDetail();
    if (graphState.selectedNode && graphState.detailOpen) {
      panel.classList.add("open");
    } else {
      panel.classList.remove("open");
    }
  }
}

function wireDetailPanel(root, sessionState = {}) {
  const panel = root.querySelector("#ngDetailPanel");
  if (!panel) return;

  // Cerrar la hoja no quita la selección: se sigue navegando por sus conexiones
  panel.querySelector("#ngBtnCloseDetail")?.addEventListener("click", () => {
    graphState.detailOpen = false;
    graphState.editorMode = false;
    rerenderDetailPanel(root);
  });

  panel.querySelectorAll(".ngConnGoto").forEach(btn => {
    btn.addEventListener("click", () => {
      graphState.detailOpen = false;
      goToNode(root, btn.dataset.goto);
    });
  });

  panel.querySelector("#ngBtnOpenEditor")?.addEventListener("click", () => {
    graphState.editorMode = true;
    graphState.editorMsg  = "";
    rerenderDetailPanel(root);
    wireDetailPanel(root, sessionState);
  });

  ["#ngBtnCancelEditor", "#ngBtnCancelEditor2"].forEach(sel => {
    panel.querySelector(sel)?.addEventListener("click", () => {
      graphState.editorMode = false;
      graphState.editorMsg  = "";
      rerenderDetailPanel(root);
      wireDetailPanel(root, sessionState);
    });
  });

  panel.querySelector("#ngEditorForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const id = fd.get("id");
    if (!id) return;

    const patch = {
      core: {
        concept: String(fd.get("concept") || "").trim(),
        domain:  String(fd.get("domain")  || "").trim(),
        summary: String(fd.get("summary") || "").trim(),
      },
      emotion:  String(fd.get("emotion") || "neutral").trim(),
      triggers: String(fd.get("triggers") || "").split(",").map(s => s.trim()).filter(Boolean),
      meta: {
        aliases:  String(fd.get("aliases") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
        priority: fd.get("priority") || "medium",
        pin:      fd.get("pin") === "on",
        notes:    String(fd.get("notes") || "").trim(),
      },
    };

    const saved = updateNeuron(id, patch);
    if (saved) {
      updateNeuronTemporal(id, {
        date:         String(fd.get("date")  || "").trim() || null,
        stage:        String(fd.get("stage") || "").trim() || null,
        isHistorical: fd.get("isHistorical") === "on",
      });
      graphState.editorMsg  = "✓ Cambios guardados";
      graphState.editorMode = false;
      rebuildAndRender(root, sessionState);
    } else {
      graphState.editorMsg = "✗ Error al guardar";
      rerenderDetailPanel(root);
      wireDetailPanel(root, sessionState);
    }
  });

  panel.querySelector("#ngBtnAddConn")?.addEventListener("click", () => {
    const n     = graphState.selectedNode;
    if (!n) return;
    const input = panel.querySelector("#ngConnTarget");
    const raw   = (input?.value || "").trim();
    if (!raw) return;
    const all   = getAllNeurons();
    let target  = all.find(x => x.id === raw);
    if (!target) {
      const lower = raw.toLowerCase();
      target = all.find(x =>
        (x.core?.concept || "").toLowerCase() === lower ||
        (x.meta?.aliases || []).some(a => a.toLowerCase() === lower)
      );
    }
    if (target) {
      linkNeurons(n.id, target.id, { connectionSource: "manual" });
      if (input) input.value = "";
      rebuildAndRender(root, sessionState);
    } else if (input) {
      input.style.outline = "2px solid #f87171";
      setTimeout(() => { input.style.outline = ""; }, 1500);
    }
  });

  panel.querySelectorAll(".ngUnlinkBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      unlinkNeurons(btn.dataset.source, btn.dataset.target);
      rebuildAndRender(root, sessionState);
    });
  });

  panel.querySelector("#ngBtnDeleteNeuron")?.addEventListener("click", () => {
    const selected = graphState.selectedNode;
    if (!selected) return;
    const impact = getNeuronDeletionImpact(selected.id);
    if (!impact) return;
    const warning = impact.likes >= 5 || impact.connectionsAffected >= 6
      ? "\n⚠️ Alta relevancia detectada (likes/conectividad)." : "";
    const msg = `Esta neurona está conectada a ${impact.memoriesAffected} memorias y ${impact.connectionsAffected} neuronas. Insights afectados: ${impact.insightsAffected}. ¿Deseas eliminarla de todos modos?${warning}`;
    if (!confirm(msg)) return;
    deleteNeuronSafely(selected.id, { hard: true });
    graphState.selectedNode    = null;
    graphState.filters.focusId = null;
    graphState.detailOpen      = false;
    rebuildAndRender(root, sessionState);
  });

  panel.querySelector("#ngBtnRestoreNeuron")?.addEventListener("click", () => {
    const selected = graphState.selectedNode;
    if (!selected) return;
    restoreSoftDeletedNeuron(selected.id);
    rebuildAndRender(root, sessionState);
  });
}

// ---- Wiring principal ----
function wireNeuroGraphInner(root, sessionState = {}) {
  graphState.sessionState = sessionState;

  // Evita duplicar listeners si la misma vista se cablea dos veces
  const canvasEl = root.querySelector("#ngCanvas");
  if (!canvasEl || canvasEl.dataset.ngWired === "1") return;
  canvasEl.dataset.ngWired = "1";

  initCanvas(root);
  wireCanvas(root);
  startLoop();
  wireDetailPanel(root, sessionState);
  renderPeek(root);

  const peek = root.querySelector("#ngPeek");
  peek?.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) { goToNode(root, goto.dataset.goto); return; }
    if (e.target.closest("[data-peek-close]")) { selectNode(root, null); return; }
    if (e.target.closest("[data-peek-detail]")) {
      graphState.detailOpen = true;
      rerenderDetailPanel(root);
      wireDetailPanel(root, sessionState);
    }
  });

  // La pista desaparece con el primer gesto
  const hint = root.querySelector("#ngHint");
  if (hint) {
    if (graphState.hintSeen) hint.remove();
    else canvasEl.addEventListener("pointerdown", () => { graphState.hintSeen = true; hint.remove(); }, { once: true });
  }

  root.querySelector("#ngBtnRepairGraph")?.addEventListener("click", async () => {
    const btn = root.querySelector("#ngBtnRepairGraph");
    const headerSub = root.querySelector(".ngHeaderSub");
    const originalText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Analizando...";
    }

    try {
      const result = await repairGraphWithClaude({
        onProgress: (statusMsg) => {
          if (headerSub) headerSub.textContent = statusMsg;
        },
      });

      if (result.ok) {
        alert(
          `✨ Reparación del Grafo Completada\n\n` +
          `• Neuronas limpiadas/eliminadas: ${result.deletedCount || 0}\n` +
          `• Neuronas fusionadas: ${result.mergedCount || 0}\n` +
          `• Neuronas mejoradas: ${result.updatedCount || 0}\n` +
          `• Conexiones creadas: ${result.connectionsCreatedCount || 0}\n\n` +
          `Resumen de Claude:\n${result.summary}`
        );
      } else {
        alert(`❌ No se pudo completar la reparación:\n${result.error || "Error desconocido"}`);
      }
    } catch (err) {
      alert(`❌ Error al reparar el grafo: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      rebuildAndRender(root, sessionState);
    }
  });

  // Menu de 3 puntos (Dropdown)
  const menuBtn = root.querySelector("#ngMenuBtn");
  const menuDropdown = root.querySelector("#ngMenuDropdown");
  if (menuBtn && menuDropdown) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle("show");
    });
    // Un único listener global: se reemplaza en cada re-render en lugar de acumularse
    if (graphState.menuCloseHandler) document.removeEventListener("click", graphState.menuCloseHandler);
    graphState.menuCloseHandler = () => menuDropdown.classList.remove("show");
    document.addEventListener("click", graphState.menuCloseHandler);
    menuDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  root.querySelector("#ngBtnResetPositions")?.addEventListener("click", () => {
    menuDropdown?.classList.remove("show");
    graphState.positions = {};
    try { localStorage.removeItem(LAYOUT_KEY); } catch (_e) { /* noop */ }
    graphState.cameraReady = false;
    rebuildAndRender(root, sessionState);
  });

  root.querySelector("#ngBtnRefresh")?.addEventListener("click", () => {
    menuDropdown?.classList.remove("show");
    rebuildAndRender(root, sessionState);
  });
  root.querySelector("#ngBtnZoomIn")?.addEventListener("click", () => {
    zoomAt(graphState.width / 2, graphState.height / 2, graphState.zoom * 1.5, 220);
  });
  root.querySelector("#ngBtnZoomOut")?.addEventListener("click", () => {
    zoomAt(graphState.width / 2, graphState.height / 2, graphState.zoom / 1.5, 220);
  });
  root.querySelector("#ngBtnZoomReset")?.addEventListener("click", () => {
    menuDropdown?.classList.remove("show");
    fitView();
  });

  const filterMap = {
    "#ngFilterDomain":  v => { graphState.filters.domain     = v || null; },
    "#ngFilterEmotion": v => { graphState.filters.emotion    = v || null; },
    "#ngFilterSource":  v => { graphState.filters.sourceKind = v || null; },
    "#ngColorBy":       v => { graphState.colorBy = v || "domain"; rebuildAndRender(root, sessionState); return; },
  };
  Object.entries(filterMap).forEach(([sel, fn]) => {
    root.querySelector(sel)?.addEventListener("change", e => {
      fn(e.target.value);
      applyFiltersAndRerender(root, sessionState);
    });
  });
  root.querySelector("#ngFilterShowDeleted")?.addEventListener("change", (e) => {
    graphState.filters.showDeleted = Boolean(e.target.checked);
    applyFiltersAndRerender(root, sessionState);
  });

  // Eventos para el Toggle de Alcance (Reach: Importantes / Recientes / Todos)
  root.querySelectorAll(".ngReachBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const reachVal = btn.dataset.reach || "importantes";
      graphState.filters.reach = reachVal;
      root.querySelectorAll(".ngReachBtn").forEach(b => b.classList.toggle("active", b.dataset.reach === reachVal));
      applyFiltersAndRerender(root, sessionState);
      fitView();
    });
  });

  // Eventos para Chips de Categoría / Dominio
  root.querySelectorAll(".ngChipBtn").forEach(chip => {
    chip.addEventListener("click", () => {
      const domVal = chip.dataset.domainChip || null;
      graphState.filters.domain = domVal;
      const select = root.querySelector("#ngFilterDomain");
      if (select) select.value = domVal || "";
      applyFiltersAndRerender(root, sessionState);
      fitView();
    });
  });

  let searchTimer = null;
  root.querySelector("#ngSearch")?.addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      graphState.filters.search = e.target.value;
      applyFiltersAndRerender(root, sessionState);
      fitView();
    }, 180);
  });

  // Resize observer: mantiene el canvas al tamaño del área (rotación, ventana, sidebar)
  graphState.resizeObserver?.disconnect();
  graphState.resizeObserver = null;
  const area = root.querySelector("#ngGraphArea");
  if (area && window.ResizeObserver) {
    let ngResizeRaf = 0;
    graphState.resizeObserver = new ResizeObserver(() => {
      if (ngResizeRaf) cancelAnimationFrame(ngResizeRaf);
      ngResizeRaf = requestAnimationFrame(() => {
        ngResizeRaf = 0;
        // Mantener el mismo punto del mundo en el centro de la pantalla
        const center = cameraCenter();
        if (resizeCanvas(area)) {
          setCamera(center, graphState.zoom);
          requestFrame();
        }
      });
    });
    graphState.resizeObserver.observe(area);
  }
}

function applyFiltersAndRerender(root, sessionState = {}) {
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  requestFrame();
  const header = root.querySelector(".ngHeaderSub");
  if (header) {
    const { graph, filtered } = graphState;
    header.textContent = `${graph.nodes.length} neuronas · ${filtered.nodes.length} visibles · ${filtered.edges.length} conexiones`;
  }
}

function rebuildAndRender(root, sessionState = {}) {
  const neurons = getAllNeurons({ includeDeleted: true });
  graphState.graph = buildNeuronGraph(neurons, {
    colorBy:      graphState.colorBy,
    highlightIds: sessionState.lastActivatedIds || [],
    newIds:       sessionState.lastGeneratedIds  || [],
    mergedIds:    sessionState.lastMergedIds     || [],
  });
  // La selección apunta al nodo recién construido (o desaparece si se borró)
  const selId = graphState.selectedNode?.id;
  graphState.selectedNode = selId ? graphState.graph.nodes.find(n => n.id === selId) || null : null;
  if (!graphState.selectedNode) {
    graphState.filters.focusId = null;
    graphState.detailOpen      = false;
  }
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);

  const wrap = root.querySelector(".ngWrap");
  if (!wrap) return;

  stopLoop();
  wrap.outerHTML = ngraphInner(sessionState).replace(/^<div class="ngWrap">/, '<div class="ngWrap">');
  const newWrap = root.querySelector(".ngWrap");
  if (newWrap) wireNeuroGraphInner(root, sessionState);
}

// ---- Exports ----
export function viewNeuroGraph(sessionState = {}) {
  const neurons = getAllNeurons({ includeDeleted: true });
  graphState.graph = buildNeuronGraph(neurons, {
    colorBy:      graphState.colorBy,
    highlightIds: sessionState.lastActivatedIds || [],
    newIds:       sessionState.lastGeneratedIds  || [],
    mergedIds:    sessionState.lastMergedIds     || [],
  });
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  return ngraphInner(sessionState);
}

export function wireNeuroGraph(root, sessionState = {}) {
  wireNeuroGraphInner(root, sessionState);
}

// ---- CSS ----
function ngCss() {
  return `<style id="ngraphStyles">
  .ngWrap { max-width: 1200px; margin: 0 auto; padding: 0 0 80px; font-family: system-ui, -apple-system, sans-serif; }

  /* Header estilo Regulación */
  .ngHeader {
    position: relative; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; margin-bottom: 12px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
    border-radius: 16px;
  }
  .ngHeaderLeft { display: flex; align-items: center; gap: 10px; }
  .ngHeaderIcon { color: #fbbf24; display: flex; align-items: center; }
  .ngHeaderTitle { font-size: 18px; font-weight: 700; color: #f8fafc; letter-spacing: -.3px; }

  .ngHeaderRight { display: flex; align-items: center; gap: 10px; }
  .ngNodePill {
    background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 20px; padding: 4px 12px; font-size: 12px; font-weight: 600;
  }

  /* Menu Dropdown */
  .ngMenuWrap { position: relative; }
  .ngMenuBtn {
    background: transparent; border: none; color: #94a3b8; font-size: 20px;
    cursor: pointer; padding: 4px 8px; border-radius: 8px; transition: background .12s;
  }
  .ngMenuBtn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .ngMenuDropdown {
    display: none; position: absolute; top: 100%; right: 0; margin-top: 6px;
    background: #1e1b2e; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
    padding: 6px; min-width: 180px; box-shadow: 0 10px 25px rgba(0,0,0,.5); z-index: 1000;
  }
  .ngMenuDropdown.show { display: block; }
  .ngMenuItem {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px;
    background: transparent; border: none; color: #e2e8f0; font-size: 12px; font-weight: 500;
    text-align: left; cursor: pointer; border-radius: 8px; transition: background .12s;
  }
  .ngMenuItem:hover { background: rgba(124,92,255,.2); color: #fff; }
  .ngMenuDivider { height: 1px; background: rgba(255,255,255,.08); margin: 4px 0; }
  .ngMenuLabel { cursor: pointer; opacity: .85; }

  /* Búsqueda y Filtros */
  .ngFiltersContainer { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .ngSearchRow { display: flex; width: 100%; }
  .ngSearchWrapper {
    position: relative; display: flex; align-items: center; width: 100%;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
    border-radius: 14px; padding: 0 12px; transition: border-color .15s;
  }
  .ngSearchWrapper:focus-within { border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.05); }
  .ngSearchIcon { opacity: .4; font-size: 13px; margin-right: 8px; }
  .ngSearchInput {
    flex: 1; background: transparent; border: none; padding: 10px 0; color: #fff;
    font-size: 13px; outline: none; font-family: inherit;
  }
  .ngSearchInput::placeholder { opacity: .4; }
  .ngCountBadge {
    background: rgba(255,255,255,.08); color: #94a3b8; font-size: 11px;
    padding: 3px 8px; border-radius: 12px; font-weight: 500; white-space: nowrap;
  }

  /* Strip unificado con scroll horizontal */
  .ngFilterStrip {
    display: flex; align-items: center; gap: 8px; overflow-x: auto; padding: 2px 0 6px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .ngFilterStrip::-webkit-scrollbar { display: none; }

  .ngReachGroup { display: flex; gap: 4px; flex-shrink: 0; }
  .ngReachBtn {
    background: transparent; border: none; padding: 5px 12px; font-size: 12px;
    color: #94a3b8; font-weight: 500; border-radius: 20px; cursor: pointer; transition: all .15s;
  }
  .ngReachBtn.active {
    background: rgba(255,255,255,.12); color: #fff; font-weight: 700;
  }
  .ngChipDivider { width: 1px; height: 16px; background: rgba(255,255,255,.12); flex-shrink: 0; }

  .ngCategoryChips { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
  .ngChipBtn {
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
    color: #94a3b8; border-radius: 20px; padding: 4px 12px; font-size: 12px;
    cursor: pointer; white-space: nowrap; transition: all .12s ease; flex-shrink: 0;
  }
  .ngChipBtn:hover { background: rgba(255,255,255,.12); color: #fff; }
  .ngChipDot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .ngChipBtn.active {
    background: rgba(124,92,255,.25); border-color: rgba(124,92,255,.5); color: #c4b5fd; font-weight: 700;
  }

  /* Layout y Canvas */
  .ngLayout { display: flex; flex-direction: column; position: relative; gap: 0; }
  .ngGraphArea {
    width: 100%; min-width: 0; position: relative;
    background: rgba(10,8,20,.65);
    border: 1px solid rgba(124,92,255,.18); border-radius: 18px;
    overflow: hidden; height: calc(100vh - 210px); min-height: 540px;
  }
  #ngCanvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }

  /* Barra de la neurona seleccionada y sus conexiones */
  .ngPeek {
    position: absolute; left: 10px; right: 58px; bottom: 10px; z-index: 11;
    display: none; flex-direction: column; gap: 6px; padding: 8px 10px;
    background: rgba(24,21,40,.92); border: 1px solid rgba(124,92,255,.3); border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45); backdrop-filter: blur(6px);
  }
  .ngPeek.show { display: flex; }
  .ngPeekHead { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ngPeekTitle { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ngPeekDot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .ngPeekBtn {
    background: rgba(124,92,255,.25); border: 1px solid rgba(124,92,255,.5); color: #ddd6fe;
    border-radius: 10px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .ngPeekClose {
    background: transparent; border: none; color: #94a3b8; font-size: 14px; cursor: pointer; padding: 2px 6px;
  }
  .ngPeekLinks {
    display: flex; gap: 6px; align-items: center; overflow-x: auto; scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .ngPeekLinks::-webkit-scrollbar { display: none; }
  .ngPeekLabel { font-size: 11px; color: #94a3b8; white-space: nowrap; flex-shrink: 0; }
  .ngPeekChip {
    display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #e2e8f0;
    border-radius: 20px; padding: 5px 11px; font-size: 12px; cursor: pointer; white-space: nowrap;
  }
  .ngPeekChip:active { background: rgba(124,92,255,.3); }
  .ngHint {
    position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 5;
    pointer-events: none; font-size: 11px; color: #cbd5e1; white-space: nowrap;
    background: rgba(24,21,40,.85); border: 1px solid rgba(255,255,255,.1); border-radius: 20px; padding: 5px 12px;
  }
  .ngConnGoto { border: none; cursor: pointer; font-family: inherit; }
  #ngCanvas:active { cursor: grabbing; }

  .ngZoomFloatingControls {
    position: absolute; right: 14px; bottom: 14px; display: flex; flex-direction: column; gap: 6px; z-index: 10;
  }
  .ngCircleBtn {
    width: 34px; height: 34px; border-radius: 50%; background: rgba(30,27,46,.85);
    border: 1px solid rgba(255,255,255,.15); color: #fff; font-size: 16px; font-weight: bold;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,.3); transition: transform .1s, background .12s;
  }
  .ngCircleBtn:hover { background: rgba(124,92,255,.4); }
  .ngCircleBtn:active { transform: scale(.92); }

  /* Detail panel (Sliding Bottom Sheet Drawer) */
  .ngDetailPanel {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 990;
    max-width: 600px; margin: 0 auto;
    background: #181528; border: 1px solid rgba(124,92,255,.3);
    border-bottom: none; border-radius: 20px 20px 0 0;
    box-shadow: 0 -10px 30px rgba(0,0,0,.6);
    overflow-y: auto; max-height: 65vh;
    transform: translateY(105%);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .ngDetailPanel.open {
    transform: translateY(0);
  }
  .ngSheetHandleBar { display: flex; justify-content: center; padding: 8px 0 4px; }
  .ngSheetHandle { width: 36px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.2); }
  .ngDetailTopRow { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
  .ngBtnCloseSheet {
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
    color: #fff; width: 30px; height: 30px; border-radius: 50%; font-size: 14px;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    flex-shrink: 0; transition: background .12s;
  }
  .ngBtnCloseSheet:hover { background: rgba(255,255,255,.2); }

  @media(max-width:720px) {
    .ngGraphArea { height: calc(100vh - 230px); min-height: 480px; }
    .ngDetailPanel { max-height: 75vh; }
  }

  /* Leyenda (fuera del canvas, plegable) */
  .ngLegendBar {
    margin-top: 8px; padding: 8px 14px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px; font-size: 12px; color: #94a3b8;
  }
  .ngLegendBar > summary { cursor: pointer; font-weight: 600; list-style: none; user-select: none; }
  .ngLegendBar > summary::-webkit-details-marker { display: none; }
  .ngLegendBar > summary::before { content: "▸"; display: inline-block; width: 14px; transition: transform .15s; }
  .ngLegendBar[open] > summary::before { transform: rotate(90deg); }
  .ngLegend { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .ngLegGroup { display: flex; gap: 6px 12px; flex-wrap: wrap; align-items: center; }
  .ngLegGroupTitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; opacity: .5; min-width: 72px; }
  .ngLegItem { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #cbd5e1; }
  .ngLegDot  { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .ngLegLine { width: 16px; height: 2px; border-radius: 2px; flex-shrink: 0; }

  /* Detail panel */
  .ngDetail { padding: 16px; }
  .ngDetailEmpty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 220px; text-align: center; opacity: .35; font-size: 12px; gap: 8px;
  }
  .ngDetailConcept { font-size: 15px; font-weight: 700; word-break: break-word; }
  .ngDetailType    { font-size: 11px; opacity: .5; margin-top: 2px; }
  .ngDetailSummary {
    font-size: 12px; opacity: .75; margin-bottom: 12px; line-height: 1.55;
    background: rgba(255,255,255,.04); border-radius: 9px; padding: 9px;
  }
  .ngMeta { font-size: 11px; opacity: .6; margin-bottom: 4px; }
  .ngDetailGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; }
  .ngDetailItem { background: rgba(255,255,255,.04); border-radius: 9px; padding: 7px 9px; }
  .ngDetailItemLabel { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; opacity: .4; margin-bottom: 2px; }
  .ngDetailSection { margin-top: 12px; }
  .ngDetailSectionTitle {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; opacity: .4; margin-bottom: 6px;
  }
  .ngTagList { display: flex; flex-wrap: wrap; gap: 4px; }
  .ngTag {
    font-size: 10px; padding: 2px 8px; border-radius: 6px;
    background: rgba(124,92,255,.18); color: #c4b5fd; font-weight: 600;
  }

  /* Calibración */
  .ngCalibBadge {
    font-size: 11px; padding: 6px 10px; border-radius: 9px; margin: 8px 0;
    border: 1px solid rgba(255,255,255,.08);
  }
  .ngCalib--pos { background: rgba(52,211,153,.1); border-color: rgba(52,211,153,.3); color: #34d399; }
  .ngCalib--neg { background: rgba(248,113,113,.1); border-color: rgba(248,113,113,.3); color: #f87171; }
  .ngCalib--neu { background: rgba(255,255,255,.04); }

  /* Status badges */
  .ngStatusBadge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 6px; font-weight: 600; margin-top: 4px; }
  .ngStatusBadge--active { background: rgba(167,139,250,.2); color: #a78bfa; }
  .ngStatusBadge--new    { background: rgba(52,211,153,.2);  color: #34d399; }
  .ngStatusBadge--merged { background: rgba(251,191,36,.2);  color: #fbbf24; }

  /* Conexiones */
  .ngConnList  { display: flex; flex-direction: column; gap: 4px; max-height: 130px; overflow-y: auto; }
  .ngConnItem  { display: flex; align-items: center; gap: 6px; }
  .ngUnlinkBtn {
    background: transparent; border: none; color: rgba(255,255,255,.3);
    cursor: pointer; font-size: 11px; padding: 2px 4px; border-radius: 4px;
    transition: color .12s;
  }
  .ngUnlinkBtn:hover { color: #f87171; }

  /* Editor */
  .ngEditor { overflow-y: auto; }
  .ngEditorLabel {
    font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
    opacity: .45; margin-top: 6px; display: block;
  }
  .ngEditorMsg {
    font-size: 11px; padding: 6px 9px; border-radius: 8px; margin-bottom: 8px;
  }
  .ngEditorMsg.ok  { background: rgba(52,211,153,.15); color: #34d399; }
  .ngEditorMsg.err { background: rgba(248,113,113,.15); color: #f87171; }
  </style>`;
}

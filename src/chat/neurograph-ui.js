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

import { getAllNeurons, updateNeuron, getNeuronById, updateNeuronTemporal } from "../neuro/neuronStore.js";
import {
  buildNeuronGraph,
  filterGraphNodes,
  getGraphDomains,
  getGraphEmotions,
  getDomainColors,
  getEmotionColors,
} from "../neuro/graph.js";
import { linkNeurons, unlinkNeurons } from "../neuro/connections.js";
import { getNeuronCalibrationSummary } from "../neuro/feedback.js";

// ---- Paleta de colores ----
const DOMAIN_PALETTE = {
  general:       "#7c5cff",
  personal:      "#a78bfa",
  work:          "#60a5fa",
  health:        "#34d399",
  finance:       "#fbbf24",
  relationships: "#f472b6",
  habits:        "#fb923c",
  beliefs:       "#e879f9",
  emotions:      "#f87171",
  learning:      "#38bdf8",
  creativity:    "#4ade80",
};

const EMOTION_PALETTE = {
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

const RELATION_COLORS = {
  causa:        "#f87171",
  consecuencia: "#fb923c",
  refuerza:     "#34d399",
  contradice:   "#f472b6",
  parte_de:     "#60a5fa",
  precede_a:    "#fbbf24",
  resuelve:     "#a78bfa",
};

// ---- Estado interno ----
const graphState = {
  graph:        { nodes: [], edges: [] },
  filters:      { domain: null, emotion: null, recentDays: null, search: "", sourceKind: null, manualCategory: null, pinned: null },
  filtered:     { nodes: [], edges: [] },
  selectedNode: null,
  simulation:   null,
  positions:    {},    // id → { x, y, vx, vy }
  zoom:         1,
  pan:          { x: 0, y: 0 },
  dragging:     null,  // id del nodo dragging
  panning:      false,
  panStart:     { x: 0, y: 0 },
  colorBy:      "domain",
  editorMode:   false,
  editorMsg:    "",
  animFrame:    null,
  hoveredNode:  null,
  canvas:       null,
  ctx:          null,
  width:        700,
  height:       500,
  alpha:        1.0,   // simulation cooling
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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function nodeColor(n) {
  if (graphState.colorBy === "emotion") return EMOTION_PALETTE[n.emotion] || "#94a3b8";
  return DOMAIN_PALETTE[n.domain] || "#94a3b8";
}

// ---- Posicionamiento inicial ----
function initPositions(nodes, w, h) {
  const domains = [...new Set(nodes.map(n => n.domain))];
  nodes.forEach((n, i) => {
    if (graphState.positions[n.id]) return;
    const dIdx   = domains.indexOf(n.domain);
    const angle  = (dIdx / Math.max(domains.length, 1)) * Math.PI * 2 + i * 0.3;
    const radius = Math.min(w, h) * 0.28;
    graphState.positions[n.id] = {
      x:  w / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 80,
      y:  h / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 80,
      vx: 0,
      vy: 0,
    };
  });
}

// ---- Force simulation ----
function tickSimulation() {
  const nodes = graphState.filtered.nodes;
  const edges = graphState.filtered.edges;
  const pos   = graphState.positions;
  const alpha = graphState.alpha;
  if (alpha < 0.001) return;

  const REPULSION  = 1800;
  const SPRING_LEN = 130;
  const SPRING_K   = 0.06;
  const CENTER_K   = 0.012;
  const DAMPING    = 0.82;
  const cx = graphState.width  / 2;
  const cy = graphState.height / 2;

  // Repulsión entre todos los nodos
  for (let i = 0; i < nodes.length; i++) {
    const a = pos[nodes[i].id];
    if (!a) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = pos[nodes[j].id];
      if (!b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy || 1;
      const dist  = Math.sqrt(dist2);
      const force = (REPULSION / dist2) * alpha;
      const nx = dx / dist;
      const ny = dy / dist;
      a.vx -= nx * force;
      a.vy -= ny * force;
      b.vx += nx * force;
      b.vy += ny * force;
    }
  }

  // Resortes en edges
  for (const edge of edges) {
    const a = pos[edge.source];
    const b = pos[edge.target];
    if (!a || !b) continue;
    const dx   = b.x - a.x;
    const dy   = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - SPRING_LEN) * SPRING_K * alpha;
    const nx = dx / dist;
    const ny = dy / dist;
    a.vx += nx * force;
    a.vy += ny * force;
    b.vx -= nx * force;
    b.vy -= ny * force;
  }

  // Atracción hacia el centro
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p) continue;
    p.vx += (cx - p.x) * CENTER_K * alpha;
    p.vy += (cy - p.y) * CENTER_K * alpha;
  }

  // Integrar velocidades
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p || graphState.dragging === n.id) continue;
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.x  += p.vx;
    p.y  += p.vy;
    // Contener dentro del canvas
    const r = n.size || 14;
    p.x = Math.max(r, Math.min(graphState.width  - r, p.x));
    p.y = Math.max(r, Math.min(graphState.height - r, p.y));
  }

  graphState.alpha *= 0.994;
}

// ---- Renderizado Canvas ----
function drawGraph() {
  const { ctx, width, height, filtered, positions, selectedNode, hoveredNode, zoom, pan } = graphState;
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

  const { nodes, edges } = filtered;
  const timestamp = Date.now();

  // --- Edges ---
  for (const edge of edges) {
    const a = positions[edge.source];
    const b = positions[edge.target];
    if (!a || !b) continue;

    const relColor = edge.relationType ? (RELATION_COLORS[edge.relationType] || "rgba(255,255,255,0.12)") : null;
    const baseColor = relColor || "rgba(255,255,255,0.10)";
    const isHighlight = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isHighlight ? (relColor || "rgba(167,139,250,0.7)") : baseColor;
    ctx.lineWidth   = isHighlight ? (edge.relationType ? 2.5 : 1.8) : (edge.relationType ? 1.5 : 0.8);

    if (edge.relationType) {
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]);

    // Flecha en mitad si hay tipo de relación
    if (edge.relationType && isHighlight) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
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

  // --- Nodos ---
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) continue;
    const r          = n.size || 14;
    const color      = nodeColor(n);
    const isSelected = selectedNode?.id === n.id;
    const isHovered  = hoveredNode?.id  === n.id;
    const isActive   = n.status === "active";
    const isNew      = n.status === "new";
    const isMerged   = n.status === "merged";
    const pulse      = Math.sin(timestamp / 700) * 0.5 + 0.5;

    // Halo animado para nodos activos/nuevos
    if (isActive || isNew) {
      const haloR = r + 8 + pulse * 5;
      const haloColor = isNew ? "#34d399" : "#a78bfa";
      ctx.beginPath();
      ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(haloColor, 0.15 + pulse * 0.2);
      ctx.lineWidth   = 3;
      ctx.stroke();
    }

    // Sombra suave en nodo seleccionado/hover
    if (isSelected || isHovered) {
      ctx.shadowColor = hexToRgba(color, 0.6);
      ctx.shadowBlur  = 18;
    }

    // Círculo base con gradiente radial
    const grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
    grad.addColorStop(0, hexToRgba(color, isSelected ? 1 : isHovered ? 0.95 : 0.9));
    grad.addColorStop(1, hexToRgba(color, isSelected ? 0.85 : isHovered ? 0.75 : 0.55));

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    // Borde
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 2.5;
    } else if (isNew) {
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth   = 2;
    } else if (isMerged) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth   = 2;
    } else if (isHovered) {
      ctx.strokeStyle = hexToRgba(color, 1);
      ctx.lineWidth   = 1.5;
    } else {
      ctx.strokeStyle = hexToRgba(color, 0.4);
      ctx.lineWidth   = 0.8;
    }
    ctx.stroke();

    // Pin indicator
    if (n.pin) {
      ctx.beginPath();
      ctx.arc(p.x + r * 0.65, p.y - r * 0.65, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.fill();
    }

    // Etiqueta
    const maxLabelChars = Math.max(6, Math.floor(r / 3.5));
    const label = n.label.length > maxLabelChars ? n.label.slice(0, maxLabelChars) + "…" : n.label;
    ctx.font      = `${isSelected ? "600" : "400"} ${isSelected ? 11 : 9}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // Sombra del texto
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur  = 4;
    ctx.fillStyle   = isSelected ? "#ffffff" : "rgba(255,255,255,0.75)";
    ctx.fillText(label, p.x, p.y + r + 4);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";
  }

  ctx.restore();
}

// ---- Loop principal ----
function startLoop(root) {
  stopLoop();
  function loop() {
    tickSimulation();
    drawGraph();
    graphState.animFrame = requestAnimationFrame(loop);
  }
  graphState.animFrame = requestAnimationFrame(loop);
}

function stopLoop() {
  if (graphState.animFrame) {
    cancelAnimationFrame(graphState.animFrame);
    graphState.animFrame = null;
  }
}

// ---- Conversión coordenadas canvas ↔ mundo ----
function canvasToWorld(cx, cy) {
  return {
    x: (cx - graphState.pan.x) / graphState.zoom,
    y: (cy - graphState.pan.y) / graphState.zoom,
  };
}

function hitTest(wx, wy) {
  const nodes = graphState.filtered.nodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const p = graphState.positions[n.id];
    if (!p) continue;
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy <= (n.size + 4) * (n.size + 4)) return n;
  }
  return null;
}

// ---- Wiring del Canvas ----
function wireCanvas(root, sessionState = {}) {
  const canvas = graphState.canvas;
  if (!canvas) return;

  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let panStartX   = 0;
  let panStartY   = 0;
  let lastPanX    = 0;
  let lastPanY    = 0;

  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const touchPoint = e.touches?.[0] || e.changedTouches?.[0] || null;
    if (touchPoint) {
      return {
        cx: (touchPoint.clientX - rect.left) * scaleX,
        cy: (touchPoint.clientY - rect.top)  * scaleY,
      };
    }
    if (typeof e.clientX !== "number" || typeof e.clientY !== "number") {
      return {
        cx: canvas.width / 2,
        cy: canvas.height / 2,
      };
    }
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top)  * scaleY,
    };
  }

  function onPointerDown(e) {
    const { cx, cy } = getXY(e);
    const { x, y }   = canvasToWorld(cx, cy);
    const hit         = hitTest(x, y);

    if (hit) {
      graphState.dragging   = hit.id;
      graphState.panning    = false;
      const p               = graphState.positions[hit.id];
      dragOffsetX           = x - p.x;
      dragOffsetY           = y - p.y;
      graphState.alpha      = Math.max(graphState.alpha, 0.3); // reiniciar simulación
      e.preventDefault?.();
    } else {
      graphState.panning  = true;
      graphState.dragging = null;
      panStartX           = cx;
      panStartY           = cy;
      lastPanX            = graphState.pan.x;
      lastPanY            = graphState.pan.y;
    }
  }

  function onPointerMove(e) {
    const { cx, cy } = getXY(e);
    const { x, y }   = canvasToWorld(cx, cy);

    if (graphState.dragging) {
      const p = graphState.positions[graphState.dragging];
      if (p) {
        p.x  = x - dragOffsetX;
        p.y  = y - dragOffsetY;
        p.vx = 0;
        p.vy = 0;
      }
      e.preventDefault?.();
    } else if (graphState.panning) {
      graphState.pan.x = lastPanX + (cx - panStartX);
      graphState.pan.y = lastPanY + (cy - panStartY);
    } else {
      // hover
      const hit = hitTest(x, y);
      graphState.hoveredNode = hit || null;
      canvas.style.cursor = hit ? "pointer" : "grab";
    }
  }

  function onPointerUp(e) {
    const { cx, cy } = getXY(e);
    const { x, y }   = canvasToWorld(cx, cy);

    if (graphState.dragging) {
      // Si apenas se movió → seleccionar
      const p   = graphState.positions[graphState.dragging];
      const dx  = p ? p.x - (x - dragOffsetX) : 9999;
      const dy  = p ? p.y - (y - dragOffsetY) : 9999;
      const moved = Math.sqrt(dx * dx + dy * dy) > 4;

      if (!moved) {
        const hit = graphState.filtered.nodes.find(n => n.id === graphState.dragging);
        if (hit) {
          graphState.selectedNode = hit;
          graphState.editorMode   = false;
          graphState.editorMsg    = "";
          rerenderDetailPanel(root);
          wireDetailPanel(root, sessionState);
        }
      }
      graphState.dragging = null;
    } else if (graphState.panning) {
      graphState.panning = false;
    } else {
      // Click en vacío → deseleccionar
      const hit = hitTest(x, y);
      if (!hit) {
        graphState.selectedNode = null;
        graphState.editorMode   = false;
        rerenderDetailPanel(root);
        wireDetailPanel(root, sessionState);
      }
    }
  }

  // Mouse
  canvas.addEventListener("mousedown",  onPointerDown);
  canvas.addEventListener("mousemove",  onPointerMove);
  canvas.addEventListener("mouseup",    onPointerUp);
  canvas.addEventListener("mouseleave", () => {
    graphState.dragging    = null;
    graphState.panning     = false;
    graphState.hoveredNode = null;
  });

  // Touch
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  canvas.addEventListener("touchmove",  onPointerMove, { passive: false });
  canvas.addEventListener("touchend",   onPointerUp);

  // Wheel zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { cx, cy } = getXY(e);
    const factor      = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom     = Math.max(0.15, Math.min(6, graphState.zoom * factor));
    // Zoom centrado en el cursor
    graphState.pan.x  = cx - (cx - graphState.pan.x) * (newZoom / graphState.zoom);
    graphState.pan.y  = cy - (cy - graphState.pan.y) * (newZoom / graphState.zoom);
    graphState.zoom   = newZoom;
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
          <span class="ngTag" style="background:rgba(255,255,255,.06)">${esc(label)}</span>
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
      <div class="ngDetailHeader" style="border-left: 3px solid ${color}; padding-left: 10px; margin-bottom: 10px;">
        <div class="ngDetailConcept">${esc(n.label)}</div>
        <div class="ngDetailType">${esc(n.type)} · ${esc(n.domain)}</div>
        ${statusBadge}
      </div>

      ${n.summary ? `<div class="ngDetailSummary">${esc(n.summary)}</div>` : ""}
      ${temporalLine ? `<div class="ngMeta">🕒 ${esc(temporalLine)}</div>` : ""}

      <div class="ngCalibBadge ngCalib--${calibCls}">
        👍 ${calib.likes} · 👎 ${calib.dislikes} · net ${calib.netScore >= 0 ? "+" : ""}${calib.netScore}
        <span style="opacity:.6;margin-left:4px">${esc(calib.label)}</span>
      </div>

      <div class="ngDetailGrid">
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Emoción</div><div>${esc(n.emotion)}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Peso</div><div>${typeof n.weight === "number" ? n.weight.toFixed(2) : "—"}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Activaciones</div><div>${n.timesActivated}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Conexiones</div><div>${n.numberOfConnections}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">Última activación</div><div>${fmtDate(n.lastActivated)}</div></div>
        <div class="ngDetailItem"><div class="ngDetailItemLabel">False+</div><div>${n.activationLearning?.falsePositiveCount ?? 0}</div></div>
      </div>

      ${n.aliases?.length ? `<div class="ngMeta">aliases: ${n.aliases.join(", ")}</div>` : ""}
      ${n.notes ? `<div class="ngMeta">📝 ${esc(n.notes)}</div>` : ""}

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Triggers</div>
        <div class="ngTagList">${triggersHtml}</div>
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Evolution</div>
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
        <label class="ngEditorLabel">Summary</label>
        <textarea name="summary" class="ngInput" rows="2">${esc(fullN.core?.summary || "")}</textarea>
        <label class="ngEditorLabel">Domain</label>
        <input name="domain" class="ngInput" value="${esc(fullN.core?.domain || "")}" />
        <label class="ngEditorLabel">Emotion</label>
        <input name="emotion" class="ngInput" value="${esc(fullN.emotion || "neutral")}" />
        <label class="ngEditorLabel">Triggers (coma)</label>
        <input name="triggers" class="ngInput" value="${esc((fullN.triggers || []).join(", "))}" />
        <label class="ngEditorLabel">Fecha</label>
        <input type="date" name="date" class="ngInput" value="${esc(fullN.temporal?.date || "")}" />
        <label class="ngEditorLabel">Stage</label>
        <input name="stage" class="ngInput" value="${esc(fullN.temporal?.stage || "")}" />
        <label class="ngEditorLabel" style="flex-direction:row;gap:6px;align-items:center;display:flex">
          <input type="checkbox" name="isHistorical" ${fullN.temporal?.isHistorical ? "checked" : ""} /> Histórico
        </label>
        <label class="ngEditorLabel">Aliases (coma)</label>
        <input name="aliases" class="ngInput" value="${esc((fullN.meta?.aliases || []).join(", "))}" />
        <label class="ngEditorLabel">Priority</label>
        <select name="priority" class="ngInput">
          <option value="low"    ${fullN.meta?.priority === "low"    ? "selected" : ""}>low</option>
          <option value="medium" ${(!fullN.meta?.priority || fullN.meta?.priority === "medium") ? "selected" : ""}>medium</option>
          <option value="high"   ${fullN.meta?.priority === "high"   ? "selected" : ""}>high</option>
        </select>
        <label class="ngEditorLabel" style="flex-direction:row;gap:6px;align-items:center;display:flex">
          <input type="checkbox" name="pin" ${fullN.meta?.pin ? "checked" : ""} /> Pin
        </label>
        <label class="ngEditorLabel">Notes</label>
        <textarea name="notes" class="ngInput" rows="2">${esc(fullN.meta?.notes || "")}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="submit" class="ngBtn ngBtn--primary" style="flex:1">💾 Guardar</button>
          <button type="button" id="ngBtnCancelEditor2" class="ngBtn" style="flex:1">Cancelar</button>
        </div>
      </form>
    </div>`;
}

// ---- Barra de filtros ----
function renderFiltersBar() {
  const { graph, filters, colorBy } = graphState;
  const domains  = getGraphDomains(graph);
  const emotions = getGraphEmotions(graph);

  const domainOpts  = domains.map(d  => `<option value="${esc(d)}"  ${filters.domain  === d  ? "selected" : ""}>${esc(d)}</option>`).join("");
  const emotionOpts = emotions.map(e => `<option value="${esc(e)}"  ${filters.emotion === e  ? "selected" : ""}>${esc(e)}</option>`).join("");

  return `
    <div class="ngFilters">
      <input type="search" class="ngInput ngSearchInput" id="ngSearch" placeholder="🔍 Buscar neurona…" value="${esc(filters.search || "")}" />
      <select class="ngInput ngSelect" id="ngFilterDomain">
        <option value="">Todos los dominios</option>${domainOpts}
      </select>
      <select class="ngInput ngSelect" id="ngFilterEmotion">
        <option value="">Todas las emociones</option>${emotionOpts}
      </select>
      <select class="ngInput ngSelect" id="ngFilterRecent">
        <option value="">Cualquier fecha</option>
        <option value="1"  ${filters.recentDays === 1  ? "selected" : ""}>Hoy</option>
        <option value="7"  ${filters.recentDays === 7  ? "selected" : ""}>Últimos 7d</option>
        <option value="30" ${filters.recentDays === 30 ? "selected" : ""}>Últimos 30d</option>
      </select>
      <select class="ngInput ngSelect" id="ngFilterSource">
        <option value="">Manual + auto</option>
        <option value="manual" ${filters.sourceKind === "manual" ? "selected" : ""}>Solo manuales</option>
        <option value="auto"   ${filters.sourceKind === "auto"   ? "selected" : ""}>Solo automáticas</option>
      </select>
      <select class="ngInput ngSelect" id="ngColorBy">
        <option value="domain"  ${colorBy === "domain"  ? "selected" : ""}>Color: dominio</option>
        <option value="emotion" ${colorBy === "emotion" ? "selected" : ""}>Color: emoción</option>
      </select>
      <button class="ngBtn" id="ngBtnReset" title="Resetear filtros">✕</button>
    </div>`;
}

// ---- Vista principal ----
function ngraphInner(sessionState = {}) {
  const { graph, filtered } = graphState;
  return `
    <div class="ngWrap">
      ${ngCss()}
      <div class="ngHeader">
        <div class="ngHeaderLeft">
          <div>
            <div class="ngHeaderTitle">Neuron Graph</div>
            <div class="ngHeaderSub">${graph.nodes.length} neuronas · ${filtered.nodes.length} visibles · ${filtered.edges.length} conexiones</div>
          </div>
        </div>
        <div class="ngHeaderActions">
          <button class="ngBtn" id="ngBtnRefresh" title="Refrescar">↺</button>
          <button class="ngBtn" id="ngBtnZoomIn"  title="Acercar">+</button>
          <button class="ngBtn" id="ngBtnZoomOut" title="Alejar">−</button>
          <button class="ngBtn" id="ngBtnZoomReset" title="Centrar">⊙</button>
        </div>
      </div>

      ${renderFiltersBar()}

      <div class="ngLayout">
        <div class="ngGraphArea" id="ngGraphArea">
          <canvas id="ngCanvas"></canvas>
          <div class="ngLegendOverlay" id="ngLegendOverlay">${buildLegendOverlay()}</div>
        </div>
        <div class="ngDetailPanel" id="ngDetailPanel">
          ${renderNodeDetail()}
        </div>
      </div>
    </div>`;
}

function buildLegendOverlay() {
  const items = [
    { color: "#a78bfa", label: "Activada" },
    { color: "#34d399", label: "Nueva" },
    { color: "#fbbf24", label: "Mergeada · pin" },
  ];
  const relItems = Object.entries(RELATION_COLORS).slice(0, 4).map(([type, color]) =>
    `<span class="ngLegItem"><span class="ngLegLine" style="background:${color}"></span>${type}</span>`
  ).join("");

  return `
    <div class="ngLegend">
      ${items.map(i => `<span class="ngLegItem"><span class="ngLegDot" style="background:${i.color}"></span>${i.label}</span>`).join("")}
      ${relItems}
    </div>`;
}

// ---- Inicializar canvas después de insertar en DOM ----
function initCanvas(root) {
  const canvas = root.querySelector("#ngCanvas");
  const area   = root.querySelector("#ngGraphArea");
  if (!canvas || !area) return;

  const w = area.clientWidth  || 700;
  const h = Math.max(460, window.innerHeight * 0.55);
  canvas.width  = w;
  canvas.height = h;
  graphState.canvas = canvas;
  graphState.ctx    = canvas.getContext("2d");
  graphState.width  = w;
  graphState.height = h;

  initPositions(graphState.filtered.nodes, w, h);
  graphState.alpha = 1.0;
}

// ---- Detalle y editor ----
function rerenderDetailPanel(root) {
  const panel = root.querySelector("#ngDetailPanel");
  if (panel) panel.innerHTML = renderNodeDetail();
}

function wireDetailPanel(root, sessionState = {}) {
  const panel = root.querySelector("#ngDetailPanel");
  if (!panel) return;

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
}

// ---- Wiring principal ----
function wireNeuroGraphInner(root, sessionState = {}) {
  graphState.sessionState = sessionState;

  initCanvas(root);
  wireCanvas(root, sessionState);
  startLoop(root);
  wireDetailPanel(root, sessionState);

  root.querySelector("#ngBtnRefresh")?.addEventListener("click", () => {
    graphState.positions = {};
    rebuildAndRender(root, sessionState);
  });
  root.querySelector("#ngBtnZoomIn")?.addEventListener("click", () => {
    graphState.zoom = Math.min(graphState.zoom * 1.25, 6);
  });
  root.querySelector("#ngBtnZoomOut")?.addEventListener("click", () => {
    graphState.zoom = Math.max(graphState.zoom / 1.25, 0.15);
  });
  root.querySelector("#ngBtnZoomReset")?.addEventListener("click", () => {
    graphState.zoom  = 1;
    graphState.pan   = { x: 0, y: 0 };
  });
  root.querySelector("#ngBtnReset")?.addEventListener("click", () => {
    graphState.filters = { domain: null, emotion: null, recentDays: null, search: "", sourceKind: null, manualCategory: null, pinned: null };
    const s = root.querySelector("#ngSearch");
    if (s) s.value = "";
    ["#ngFilterDomain","#ngFilterEmotion","#ngFilterRecent","#ngFilterSource","#ngColorBy"].forEach(sel => {
      const el = root.querySelector(sel);
      if (el) el.value = "";
    });
    applyFiltersAndRerender(root, sessionState);
  });

  const filterMap = {
    "#ngFilterDomain":  v => { graphState.filters.domain     = v || null; },
    "#ngFilterEmotion": v => { graphState.filters.emotion    = v || null; },
    "#ngFilterRecent":  v => { graphState.filters.recentDays = v ? parseInt(v, 10) : null; },
    "#ngFilterSource":  v => { graphState.filters.sourceKind = v || null; },
    "#ngColorBy":       v => { graphState.colorBy = v || "domain"; rebuildAndRender(root, sessionState); return; },
  };
  Object.entries(filterMap).forEach(([sel, fn]) => {
    root.querySelector(sel)?.addEventListener("change", e => {
      fn(e.target.value);
      applyFiltersAndRerender(root, sessionState);
    });
  });

  let searchTimer = null;
  root.querySelector("#ngSearch")?.addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      graphState.filters.search = e.target.value;
      applyFiltersAndRerender(root, sessionState);
    }, 180);
  });

  // Resize observer
  const area = root.querySelector("#ngGraphArea");
  if (area && window.ResizeObserver) {
    new ResizeObserver(() => {
      const canvas = graphState.canvas;
      if (!canvas) return;
      const w = area.clientWidth;
      const h = Math.max(460, window.innerHeight * 0.55);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        graphState.width  = w;
        graphState.height = h;
      }
    }).observe(area);
  }
}

function applyFiltersAndRerender(root, sessionState = {}) {
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  const header = root.querySelector(".ngHeaderSub");
  if (header) {
    const { graph, filtered } = graphState;
    header.textContent = `${graph.nodes.length} neuronas · ${filtered.nodes.length} visibles · ${filtered.edges.length} conexiones`;
  }
}

function rebuildAndRender(root, sessionState = {}) {
  const neurons = getAllNeurons();
  graphState.graph = buildNeuronGraph(neurons, {
    colorBy:      graphState.colorBy,
    highlightIds: sessionState.lastActivatedIds || [],
    newIds:       sessionState.lastGeneratedIds  || [],
    mergedIds:    sessionState.lastMergedIds     || [],
  });
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  graphState.alpha    = Math.max(graphState.alpha, 0.6);

  const wrap = root.querySelector(".ngWrap");
  if (!wrap) return;

  stopLoop();
  wrap.outerHTML = ngraphInner(sessionState).replace(/^<div class="ngWrap">/, '<div class="ngWrap">');
  const newWrap = root.querySelector(".ngWrap");
  if (newWrap) wireNeuroGraphInner(root, sessionState);
}

// ---- Exports ----
export function viewNeuroGraph(sessionState = {}) {
  const neurons = getAllNeurons();
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
  .ngWrap { max-width: 1200px; margin: 0 auto; padding: 0 0 80px; font-family: system-ui, sans-serif; }

  /* Header */
  .ngHeader {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    background: linear-gradient(135deg, rgba(124,92,255,.14) 0%, rgba(99,102,241,.08) 100%);
    border: 1px solid rgba(124,92,255,.28); border-radius: 18px; margin-bottom: 12px;
  }
  .ngHeaderLeft  { display: flex; align-items: center; gap: 12px; }
  .ngHeaderTitle { font-size: 16px; font-weight: 700; letter-spacing: -.2px; }
  .ngHeaderSub   { font-size: 11px; opacity: .55; margin-top: 2px; }
  .ngHeaderActions { display: flex; gap: 6px; }

  /* Botones */
  .ngBtn {
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    border-radius: 9px; padding: 6px 12px; cursor: pointer; font-size: 13px;
    color: inherit; transition: background .12s, transform .08s;
    font-family: inherit;
  }
  .ngBtn:hover  { background: rgba(255,255,255,.14); }
  .ngBtn:active { transform: scale(.96); }
  .ngBtn--primary {
    background: rgba(124,92,255,.22); border-color: rgba(124,92,255,.4); color: #c4b5fd;
  }
  .ngBtn--primary:hover { background: rgba(124,92,255,.32); }

  /* Inputs */
  .ngInput {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 9px; padding: 7px 11px; color: inherit; font-size: 12px;
    font-family: inherit; outline: none; resize: vertical; width: 100%; box-sizing: border-box;
  }
  .ngInput:focus { border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.07); }
  .ngInput::placeholder { opacity: .35; }

  /* Filtros */
  .ngFilters {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.07);
    border-radius: 14px; padding: 10px 14px; margin-bottom: 12px;
  }
  .ngSearchInput { flex: 2; min-width: 160px; }
  .ngSelect { cursor: pointer; flex: 1; min-width: 120px; }

  /* Layout */
  .ngLayout { display: flex; gap: 14px; align-items: flex-start; }
  .ngGraphArea {
    flex: 1; min-width: 0; position: relative;
    background: rgba(10,8,20,.6);
    border: 1px solid rgba(124,92,255,.18); border-radius: 18px;
    overflow: hidden; min-height: 460px;
  }
  #ngCanvas { display: block; width: 100%; cursor: grab; }
  #ngCanvas:active { cursor: grabbing; }

  .ngDetailPanel {
    width: 280px; flex-shrink: 0;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
    border-radius: 18px; overflow-y: auto; max-height: 560px;
  }
  @media(max-width:720px) {
    .ngLayout      { flex-direction: column; }
    .ngDetailPanel { width: 100%; max-height: none; }
  }

  /* Legend overlay */
  .ngLegendOverlay {
    position: absolute; bottom: 10px; left: 12px; pointer-events: none;
  }
  .ngLegend { display: flex; gap: 10px; flex-wrap: wrap; }
  .ngLegItem { display: flex; align-items: center; gap: 5px; font-size: 10px; opacity: .55; }
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

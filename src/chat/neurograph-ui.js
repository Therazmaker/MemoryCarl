/**
 * neurograph-ui.js — Vista de grafo interactivo de neuronas
 * NeuroChat / MemoryCarl
 *
 * Implementa un grafo SVG force-directed ligero sin dependencias externas.
 * Compatible con GitHub Pages.
 *
 * Exporta:
 *   viewNeuroGraph(sessionState?)
 *   wireNeuroGraph(root, sessionState?)
 */

import { getAllNeurons, updateNeuron, getNeuronById } from "../neuro/neuronStore.js";
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

// ---- Estado interno del grafo ----
const graphState = {
  graph:        { nodes: [], edges: [] },
  filters:      { domain: null, emotion: null, recentDays: null, search: "", sourceKind: null, manualCategory: null, pinned: null },
  filtered:     { nodes: [], edges: [] },
  selectedNode: null,
  simulation:   null,
  svgPositions: {},  // id → { x, y }
  zoom:         1,
  pan:          { x: 0, y: 0 },
  dragging:     null,
  colorBy:      "domain",
  editorMode:   false,  // true = panel de edición activo
  editorMsg:    "",     // mensaje de éxito/error tras guardar
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
    const d = new Date(ts);
    return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  } catch (_e) {
    return String(ts);
  }
}

// ---- Layout simple (posiciones iniciales por dominio) ----
function initPositions(nodes, width = 700, height = 500) {
  const positions = {};
  const domains = [...new Set(nodes.map((n) => n.domain))];

  nodes.forEach((node, i) => {
    if (graphState.svgPositions[node.id]) {
      positions[node.id] = { ...graphState.svgPositions[node.id] };
      return;
    }
    const dIdx   = domains.indexOf(node.domain);
    const angle  = (dIdx / Math.max(domains.length, 1)) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.3;
    const spread = (Math.random() - 0.5) * 100;
    positions[node.id] = {
      x: width  / 2 + Math.cos(angle) * radius + spread,
      y: height / 2 + Math.sin(angle) * radius + spread,
      vx: 0,
      vy: 0,
    };
  });
  return positions;
}

// ---- Renderizado SVG ----
function renderGraphSVG(width = 700, height = 500) {
  const { filtered, svgPositions, zoom, pan, selectedNode, colorBy } = graphState;
  const { nodes, edges } = filtered;

  if (!nodes.length) {
    return `<div class="ngEmpty">
      <div class="ngEmptyIcon">🔮</div>
      <div>No hay neuronas que mostrar.</div>
      <div style="font-size:11px;opacity:.5;margin-top:4px">Ajusta los filtros o chatea para generar neuronas.</div>
    </div>`;
  }

  // Calcular posiciones
  const positions = initPositions(nodes, width, height);
  Object.assign(graphState.svgPositions, positions);

  const transform = `translate(${pan.x},${pan.y}) scale(${zoom})`;

  // Renderizar edges
  const edgesHtml = edges.map((e) => {
    const s = positions[e.source];
    const t = positions[e.target];
    if (!s || !t) return "";
    return `<line class="ngEdge" x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" />`;
  }).join("");

  // Renderizar nodos
  const nodesHtml = nodes.map((n) => {
    const pos = positions[n.id];
    if (!pos) return "";
    const isSelected = selectedNode?.id === n.id;
    const statusClass = n.status !== "normal" ? ` ngNode--${n.status}` : "";
    const selectedClass = isSelected ? " ngNode--selected" : "";
    const manualClass = n.isManual ? " ngNode--manual" : "";

    // Halo para nodos activos/nuevos
    const halo = (n.status === "active" || n.status === "new")
      ? `<circle cx="${pos.x}" cy="${pos.y}" r="${n.size + 6}" class="ngHalo ngHalo--${n.status}" />`
      : "";

    // Etiqueta (se muestra siempre, truncada)
    const labelLen = Math.floor(n.size / 3.5);
    const label    = n.label.length > labelLen ? n.label.slice(0, labelLen) + "…" : n.label;

    return `
      ${halo}
      <circle
        cx="${pos.x}" cy="${pos.y}" r="${n.size}"
        fill="${n.color}"
        class="ngNode${statusClass}${selectedClass}${manualClass}"
        data-id="${esc(n.id)}"
        opacity="${isSelected ? 1 : 0.82}"
      >
        <title>${esc(n.label)}: ${esc(n.summary)}</title>
      </circle>
      <text
        x="${pos.x}" y="${pos.y + n.size + 11}"
        text-anchor="middle"
        class="ngNodeLabel${isSelected ? " ngNodeLabel--selected" : ""}"
        data-id="${esc(n.id)}"
        pointer-events="none"
      >${esc(label)}</text>`;
  }).join("");

  return `
    <svg id="ngSvg" class="ngSvg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <filter id="ngGlow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="ngViewport" transform="${transform}">
        <g class="ngEdges">${edgesHtml}</g>
        <g class="ngNodes">${nodesHtml}</g>
      </g>
    </svg>`;
}

// ---- Panel de detalle de nodo ----
function renderNodeDetail() {
  const n = graphState.selectedNode;
  if (!n) {
    return `<div class="ngDetail ngDetailEmpty">
      <div style="font-size:22px;margin-bottom:6px">🔍</div>
      <div>Haz clic en una neurona para ver su detalle.</div>
    </div>`;
  }

  if (graphState.editorMode) {
    return renderNodeEditor(n);
  }

  const domainColors = getDomainColors();
  const color = domainColors[n.domain] || "#94a3b8";

  const triggersHtml = n.triggers.length
    ? n.triggers.map((t) => `<span class="ngTag">${esc(t)}</span>`).join(" ")
    : `<span style="opacity:.4">—</span>`;

  const evidenceHtml = n.evidence.length
    ? n.evidence.slice(0, 5).map((e) => `<div class="ngEvidenceItem">• ${esc(e)}</div>`).join("")
    : `<div style="opacity:.4;font-size:11px">Sin evidencias registradas</div>`;

  const statusBadge = n.status !== "normal"
    ? `<span class="ngStatusBadge ngStatusBadge--${n.status}">${
        { active: "⚡ Activada", new: "✨ Nueva", merged: "🔀 Mergeada" }[n.status] || n.status
      }</span>`
    : "";

  // Calibración feedback
  const fullNeuron = getNeuronById(n.id) || n;
  const calib = getNeuronCalibrationSummary(fullNeuron);
  const calibBadgeClass = {
    very_positive: "ngCalibBadge--positive",
    positive:      "ngCalibBadge--positive",
    very_negative: "ngCalibBadge--negative",
    negative:      "ngCalibBadge--negative",
    neutral:       "ngCalibBadge--neutral",
  }[calib.badge] || "ngCalibBadge--neutral";

  const calibHtml = calib.totalVotes > 0
    ? `<div class="ngCalibBadge ${calibBadgeClass}">
        👍 ${calib.likes} · 👎 ${calib.dislikes} · net: ${calib.netScore >= 0 ? "+" : ""}${calib.netScore} · ${esc(calib.label)}
       </div>`
    : `<div class="ngCalibBadge ngCalibBadge--neutral" style="opacity:.5">Sin feedback aún</div>`;

  // Conexiones actuales
  const connections = n.connections || [];
  const connectionsHtml = connections.length
    ? connections.slice(0, 8).map((cid) => {
        const cn = graphState.graph.nodes.find((x) => x.id === cid);
        return `<div class="ngConnItem">
          <span class="ngTag" style="background:rgba(255,255,255,.07);color:inherit">${esc(cn ? cn.label : cid)}</span>
          <button class="ngIconBtn ngUnlinkBtn" data-source="${esc(n.id)}" data-target="${esc(cid)}" style="padding:2px 6px;font-size:10px" title="Quitar conexión">✕</button>
        </div>`;
      }).join("")
    : `<div style="opacity:.4;font-size:11px">Sin conexiones</div>`;

  return `
    <div class="ngDetail">
      <div class="ngDetailHeader" style="border-left: 3px solid ${color}">
        <div class="ngDetailConcept">${esc(n.label)}</div>
        <div class="ngDetailType">${esc(n.type)} · ${esc(n.domain)}</div>
        ${statusBadge}
      </div>

      ${n.summary ? `<div class="ngDetailSummary">${esc(n.summary)}</div>` : ""}

      ${calibHtml}

      <div class="ngDetailGrid">
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Emoción</div>
          <div>${esc(n.emotion)}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Peso</div>
          <div>${typeof n.weight === "number" ? n.weight.toFixed(2) : "—"}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Activaciones</div>
          <div>${n.timesActivated}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Conexiones</div>
          <div>${n.numberOfConnections}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Última activación</div>
          <div>${fmtDate(n.lastActivated)}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">👍 Likes</div>
          <div>${n.feedbackStats?.likes ?? 0}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">👎 Dislikes</div>
          <div>${n.feedbackStats?.dislikes ?? 0}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Net score</div>
          <div>${n.feedbackStats?.netScore ?? 0}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">Useful count</div>
          <div>${n.activationLearning?.usefulCount ?? 0}</div>
        </div>
        <div class="ngDetailItem">
          <div class="ngDetailItemLabel">False positive</div>
          <div>${n.activationLearning?.falsePositiveCount ?? 0}</div>
        </div>
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Contexto manual</div>
        <div style="font-size:12px;opacity:.85">aliases: ${(n.aliases||[]).join(", ") || "—"} · pin: ${n.pin ? "sí" : "no"} · priority: ${esc(n.priority || "medium")} · category: ${esc(n.manualCategory || "—")}</div>
        ${n.notes ? `<div class="ngEvidenceItem">📝 ${esc(n.notes)}</div>` : ""}
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Triggers</div>
        <div class="ngTagList">${triggersHtml}</div>
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Evidencias</div>
        ${evidenceHtml}
      </div>

      <div class="ngDetailSection">
        <div class="ngDetailSectionTitle">Conexiones actuales</div>
        <div class="ngConnList">${connectionsHtml}</div>
        <div class="ngConnAdd" style="margin-top:8px;display:flex;gap:6px;align-items:center">
          <input id="ngConnTarget" class="ngSearchInput" style="flex:1;min-width:0" placeholder="ID o concepto a conectar…" />
          <button class="ngIconBtn" id="ngBtnAddConn" style="white-space:nowrap">+ Conectar</button>
        </div>
      </div>

      <div class="ngDetailActions" style="margin-top:12px;display:flex;gap:8px">
        <button class="ngIconBtn ngBtnEdit" id="ngBtnOpenEditor" style="flex:1">✏️ Editar</button>
      </div>
    </div>`;
}

// ---- Editor de neurona desde el grafo ----
function renderNodeEditor(n) {
  const fullNeuron = getNeuronById(n.id) || n;
  const msg = graphState.editorMsg
    ? `<div class="ngEditorMsg ${graphState.editorMsg.startsWith("✓") ? "ngEditorMsg--ok" : "ngEditorMsg--err"}">${esc(graphState.editorMsg)}</div>`
    : "";

  return `
    <div class="ngDetail ngEditor">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800;font-size:13px">✏️ Editando: ${esc(n.label)}</div>
        <button class="ngIconBtn" id="ngBtnCancelEditor" style="padding:4px 8px;font-size:11px">✕ Cancelar</button>
      </div>
      ${msg}
      <form id="ngEditorForm" class="ngEditorForm">
        <input type="hidden" name="id" value="${esc(n.id)}" />
        <label class="ngEditorLabel">Concepto</label>
        <input name="concept" class="ngEditorInput" value="${esc(fullNeuron.core?.concept || "")}" placeholder="Concepto" required />
        <label class="ngEditorLabel">Summary</label>
        <textarea name="summary" class="ngEditorInput" rows="2" placeholder="Resumen…">${esc(fullNeuron.core?.summary || "")}</textarea>
        <label class="ngEditorLabel">Domain</label>
        <input name="domain" class="ngEditorInput" value="${esc(fullNeuron.core?.domain || "")}" placeholder="domain" />
        <label class="ngEditorLabel">Emotion</label>
        <input name="emotion" class="ngEditorInput" value="${esc(fullNeuron.emotion || "neutral")}" placeholder="emotion" />
        <label class="ngEditorLabel">Triggers (coma)</label>
        <input name="triggers" class="ngEditorInput" value="${esc((fullNeuron.triggers || []).join(", "))}" placeholder="trigger1, trigger2…" />
        <label class="ngEditorLabel">Aliases (coma)</label>
        <input name="aliases" class="ngEditorInput" value="${esc((fullNeuron.meta?.aliases || []).join(", "))}" placeholder="alias1, alias2…" />
        <label class="ngEditorLabel">Priority</label>
        <select name="priority" class="ngEditorInput">
          <option value="low" ${fullNeuron.meta?.priority === "low" ? "selected" : ""}>low</option>
          <option value="medium" ${(!fullNeuron.meta?.priority || fullNeuron.meta?.priority === "medium") ? "selected" : ""}>medium</option>
          <option value="high" ${fullNeuron.meta?.priority === "high" ? "selected" : ""}>high</option>
        </select>
        <label class="ngEditorLabel" style="display:flex;align-items:center;gap:6px;flex-direction:row">
          <input type="checkbox" name="pin" ${fullNeuron.meta?.pin ? "checked" : ""} /> Pin
        </label>
        <label class="ngEditorLabel">Notes</label>
        <textarea name="notes" class="ngEditorInput" rows="2" placeholder="Notas internas…">${esc(fullNeuron.meta?.notes || "")}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button type="submit" class="ngIconBtn" style="flex:1;background:rgba(99,102,241,.25)">💾 Guardar</button>
          <button type="button" id="ngBtnCancelEditor2" class="ngIconBtn" style="flex:1">Cancelar</button>
        </div>
      </form>
    </div>`;
}

// ---- Barra de filtros ----
function renderFiltersBar() {
  const { graph, filters, colorBy } = graphState;
  const domains  = getGraphDomains(graph);
  const emotions = getGraphEmotions(graph);

  const domainOptions = domains.map((d) =>
    `<option value="${esc(d)}" ${filters.domain === d ? "selected" : ""}>${esc(d)}</option>`
  ).join("");

  const emotionOptions = emotions.map((e) =>
    `<option value="${esc(e)}" ${filters.emotion === e ? "selected" : ""}>${esc(e)}</option>`
  ).join("");

  return `
    <div class="ngFilters">
      <input
        type="search" class="ngSearchInput" id="ngSearch"
        placeholder="Buscar concepto o trigger…"
        value="${esc(filters.search || "")}"
      />
      <select class="ngSelect" id="ngFilterDomain">
        <option value="">Todos los dominios</option>
        ${domainOptions}
      </select>
      <select class="ngSelect" id="ngFilterEmotion">
        <option value="">Todas las emociones</option>
        ${emotionOptions}
      </select>
      <select class="ngSelect" id="ngFilterRecent">
        <option value="">Cualquier fecha</option>
        <option value="1"  ${filters.recentDays === 1  ? "selected" : ""}>Hoy</option>
        <option value="7"  ${filters.recentDays === 7  ? "selected" : ""}>Últimos 7d</option>
        <option value="30" ${filters.recentDays === 30 ? "selected" : ""}>Últimos 30d</option>
      </select>
      <select class="ngSelect" id="ngFilterSource">
        <option value="">Manual + auto</option>
        <option value="manual" ${filters.sourceKind === "manual" ? "selected" : ""}>Solo manuales</option>
        <option value="auto" ${filters.sourceKind === "auto" ? "selected" : ""}>Solo automáticas</option>
      </select>
      <select class="ngSelect" id="ngFilterManualCategory">
        <option value="">Todas las categorías manuales</option>
        <option value="people" ${filters.manualCategory === "people" ? "selected" : ""}>people</option>
        <option value="work" ${filters.manualCategory === "work" ? "selected" : ""}>work</option>
        <option value="projects" ${filters.manualCategory === "projects" ? "selected" : ""}>projects</option>
        <option value="hobbies" ${filters.manualCategory === "hobbies" ? "selected" : ""}>hobbies</option>
        <option value="preferences" ${filters.manualCategory === "preferences" ? "selected" : ""}>preferences</option>
      </select>
      <select class="ngSelect" id="ngFilterPinned">
        <option value="">Pinned y no pinned</option>
        <option value="1" ${filters.pinned === true ? "selected" : ""}>Solo pinned</option>
        <option value="0" ${filters.pinned === false ? "selected" : ""}>Solo no pinned</option>
      </select>
      <select class="ngSelect" id="ngColorBy">
        <option value="domain"  ${colorBy === "domain"  ? "selected" : ""}>Color: dominio</option>
        <option value="emotion" ${colorBy === "emotion" ? "selected" : ""}>Color: emoción</option>
      </select>
      <button class="ngIconBtn" id="ngBtnReset" title="Resetear filtros">✕</button>
    </div>`;
}

// ---- Vista principal ----
function ngraphInner(sessionState = {}) {
  const { graph, filtered } = graphState;
  const total    = graph.nodes.length;
  const filtered_ = filtered.nodes.length;

  return `
    <div class="ngWrap">
      ${ngCss()}
      <div class="ngHeader">
        <div class="ngHeaderLeft">
          <span class="ngHeaderIcon">🕸️</span>
          <div>
            <div class="ngHeaderTitle">Neuron Graph</div>
            <div class="ngHeaderSub">${total} neuronas · ${filtered_} visibles · ${filtered.edges.length} conexiones</div>
          </div>
        </div>
        <div class="ngHeaderActions">
          <button class="ngIconBtn" id="ngBtnRefresh" title="Refrescar grafo">🔄</button>
          <button class="ngIconBtn" id="ngBtnZoomIn"  title="Acercar">+</button>
          <button class="ngIconBtn" id="ngBtnZoomOut" title="Alejar">−</button>
          <button class="ngIconBtn" id="ngBtnZoomReset" title="Resetear zoom">⊙</button>
        </div>
      </div>

      ${renderFiltersBar()}

      <div class="ngLayout">
        <!-- Área del grafo SVG -->
        <div class="ngGraphArea" id="ngGraphArea">
          ${renderGraphSVG()}
        </div>

        <!-- Panel de detalle -->
        <div class="ngDetailPanel" id="ngDetailPanel">
          ${renderNodeDetail()}
        </div>
      </div>

      <!-- Leyenda de estado -->
      <div class="ngLegend">
        <span class="ngLegendItem"><span class="ngLegendDot ngLegendDot--active"></span>Activada recientemente</span>
        <span class="ngLegendItem"><span class="ngLegendDot ngLegendDot--new"></span>Generada ahora</span>
        <span class="ngLegendItem"><span class="ngLegendDot ngLegendDot--merged"></span>Mergeada</span>
        <span class="ngLegendItem"><span class="ngLegendDot" style="background:#f472b6"></span>Manual context</span>
        <span class="ngLegendItem" style="margin-left:8px;opacity:.5">Tamaño = peso · Halo = actividad</span>
      </div>
    </div>`;
}

// ---- Renderizado y re-render ----
function rerenderGraph(root, sessionState = {}) {
  const area        = root.querySelector("#ngGraphArea");
  const detailPanel = root.querySelector("#ngDetailPanel");
  const header      = root.querySelector(".ngHeaderSub");

  if (area) {
    area.innerHTML = renderGraphSVG();
    wireGraphSVG(root, sessionState);
  }
  if (detailPanel) {
    detailPanel.innerHTML = renderNodeDetail();
    wireDetailPanel(root, sessionState);
  }
  if (header) {
    const { graph, filtered } = graphState;
    header.textContent = `${graph.nodes.length} neuronas · ${filtered.nodes.length} visibles · ${filtered.edges.length} conexiones`;
  }
}

function applyFiltersAndRerender(root, sessionState = {}) {
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  rerenderGraph(root, sessionState);
}

// ---- Wiring del SVG (nodos clickeables, pan, zoom) ----
function wireGraphSVG(root, sessionState = {}) {
  const svg = root.querySelector("#ngSvg");
  if (!svg) return;

  // Click en nodo
  svg.addEventListener("click", (e) => {
    const nodeEl = e.target.closest("[data-id]");
    if (!nodeEl) {
      graphState.selectedNode = null;
      graphState.editorMode   = false;
      graphState.editorMsg    = "";
      rerenderGraph(root, sessionState);
      return;
    }
    const id   = nodeEl.dataset.id;
    const node = graphState.filtered.nodes.find((n) => n.id === id);
    if (node) {
      graphState.selectedNode = node;
      graphState.editorMode   = false;
      graphState.editorMsg    = "";
      rerenderGraph(root, sessionState);
    }
  });

  // Drag básico (mousedown → mousemove → mouseup)
  let dragNode = null;
  let dragOffset = { x: 0, y: 0 };

  svg.addEventListener("mousedown", (e) => {
    const circleEl = e.target.closest("circle[data-id]");
    if (!circleEl) return;
    e.preventDefault();
    dragNode   = circleEl.dataset.id;
    const rect = svg.getBoundingClientRect();
    const scaleX = parseFloat(svg.getAttribute("viewBox").split(" ")[2]) / rect.width;
    const scaleY = parseFloat(svg.getAttribute("viewBox").split(" ")[3]) / rect.height;
    const pos   = graphState.svgPositions[dragNode] || { x: 0, y: 0 };
    dragOffset  = {
      x: e.clientX * scaleX - pos.x,
      y: e.clientY * scaleY - pos.y,
    };
  });

  svg.addEventListener("mousemove", (e) => {
    if (!dragNode) return;
    const rect   = svg.getBoundingClientRect();
    const scaleX = parseFloat(svg.getAttribute("viewBox").split(" ")[2]) / rect.width;
    const scaleY = parseFloat(svg.getAttribute("viewBox").split(" ")[3]) / rect.height;
    graphState.svgPositions[dragNode] = {
      x: e.clientX * scaleX - dragOffset.x,
      y: e.clientY * scaleY - dragOffset.y,
      vx: 0,
      vy: 0,
    };
    rerenderGraph(root);
  });

  svg.addEventListener("mouseup",    () => { dragNode = null; });
  svg.addEventListener("mouseleave", () => { dragNode = null; });

  // Touch drag
  svg.addEventListener("touchstart", (e) => {
    const circleEl = e.target.closest("circle[data-id]");
    if (!circleEl) return;
    dragNode       = circleEl.dataset.id;
    const rect     = svg.getBoundingClientRect();
    const scaleX   = parseFloat(svg.getAttribute("viewBox").split(" ")[2]) / rect.width;
    const scaleY   = parseFloat(svg.getAttribute("viewBox").split(" ")[3]) / rect.height;
    const t        = e.touches[0];
    const pos      = graphState.svgPositions[dragNode] || { x: 0, y: 0 };
    dragOffset     = { x: t.clientX * scaleX - pos.x, y: t.clientY * scaleY - pos.y };
  }, { passive: true });

  svg.addEventListener("touchmove", (e) => {
    if (!dragNode) return;
    const rect   = svg.getBoundingClientRect();
    const scaleX = parseFloat(svg.getAttribute("viewBox").split(" ")[2]) / rect.width;
    const scaleY = parseFloat(svg.getAttribute("viewBox").split(" ")[3]) / rect.height;
    const t      = e.touches[0];
    graphState.svgPositions[dragNode] = {
      x: t.clientX * scaleX - dragOffset.x,
      y: t.clientY * scaleY - dragOffset.y,
      vx: 0,
      vy: 0,
    };
    rerenderGraph(root);
  }, { passive: true });

  svg.addEventListener("touchend", () => { dragNode = null; });
}

// ---- Wiring principal ----
function wireNeuroGraphInner(root, sessionState = {}) {
  wireGraphSVG(root, sessionState);

  // Zoom in/out
  root.querySelector("#ngBtnZoomIn")?.addEventListener("click", () => {
    graphState.zoom = Math.min(graphState.zoom * 1.25, 5);
    rerenderGraph(root, sessionState);
  });
  root.querySelector("#ngBtnZoomOut")?.addEventListener("click", () => {
    graphState.zoom = Math.max(graphState.zoom / 1.25, 0.2);
    rerenderGraph(root, sessionState);
  });
  root.querySelector("#ngBtnZoomReset")?.addEventListener("click", () => {
    graphState.zoom = 1;
    graphState.pan  = { x: 0, y: 0 };
    rerenderGraph(root, sessionState);
  });

  // Refrescar
  root.querySelector("#ngBtnRefresh")?.addEventListener("click", () => {
    graphState.svgPositions = {};
    rebuildAndRender(root, sessionState);
  });

  // Reset filtros
  root.querySelector("#ngBtnReset")?.addEventListener("click", () => {
    graphState.filters = { domain: null, emotion: null, recentDays: null, search: "", sourceKind: null, manualCategory: null, pinned: null };
    const searchEl = root.querySelector("#ngSearch");
    if (searchEl) searchEl.value = "";
    applyFiltersAndRerender(root, sessionState);
    // Actualizar selectores
    ["#ngFilterDomain", "#ngFilterEmotion", "#ngFilterRecent", "#ngFilterSource", "#ngFilterManualCategory", "#ngFilterPinned"].forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) el.value = "";
    });
  });

  // Filtros
  root.querySelector("#ngFilterDomain")?.addEventListener("change", (e) => {
    graphState.filters.domain = e.target.value || null;
    applyFiltersAndRerender(root, sessionState);
  });
  root.querySelector("#ngFilterEmotion")?.addEventListener("change", (e) => {
    graphState.filters.emotion = e.target.value || null;
    applyFiltersAndRerender(root, sessionState);
  });
  root.querySelector("#ngFilterRecent")?.addEventListener("change", (e) => {
    graphState.filters.recentDays = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRerender(root, sessionState);
  });
  
  root.querySelector("#ngFilterSource")?.addEventListener("change", (e) => {
    graphState.filters.sourceKind = e.target.value || null;
    applyFiltersAndRerender(root, sessionState);
  });
  root.querySelector("#ngFilterManualCategory")?.addEventListener("change", (e) => {
    graphState.filters.manualCategory = e.target.value || null;
    applyFiltersAndRerender(root, sessionState);
  });
  root.querySelector("#ngFilterPinned")?.addEventListener("change", (e) => {
    if (e.target.value === "") graphState.filters.pinned = null;
    else graphState.filters.pinned = e.target.value === "1";
    applyFiltersAndRerender(root, sessionState);
  });
  root.querySelector("#ngColorBy")?.addEventListener("change", (e) => {
    graphState.colorBy = e.target.value || "domain";
    rebuildAndRender(root, sessionState);
  });

  // Búsqueda (debounce ligero)
  let searchTimer = null;
  root.querySelector("#ngSearch")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      graphState.filters.search = e.target.value;
      applyFiltersAndRerender(root, sessionState);
    }, 200);
  });

  wireDetailPanel(root, sessionState);
}

// ---- Wiring del panel de detalle (editor, conexiones) ----
function wireDetailPanel(root, sessionState = {}) {
  const panel = root.querySelector("#ngDetailPanel");
  if (!panel) return;

  // Abrir editor
  panel.querySelector("#ngBtnOpenEditor")?.addEventListener("click", () => {
    graphState.editorMode = true;
    graphState.editorMsg  = "";
    rerenderDetailPanel(root);
    wireDetailPanel(root, sessionState);
  });

  // Cancelar editor
  ["#ngBtnCancelEditor", "#ngBtnCancelEditor2"].forEach((sel) => {
    panel.querySelector(sel)?.addEventListener("click", () => {
      graphState.editorMode = false;
      graphState.editorMsg  = "";
      rerenderDetailPanel(root);
      wireDetailPanel(root, sessionState);
    });
  });

  // Guardar edición
  panel.querySelector("#ngEditorForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const id = fd.get("id");
    if (!id) return;

    const triggers = String(fd.get("triggers") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const aliases  = String(fd.get("aliases")  || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const pin      = fd.get("pin") === "on";

    const patch = {
      core: {
        concept: String(fd.get("concept") || "").trim(),
        domain:  String(fd.get("domain")  || "").trim(),
        summary: String(fd.get("summary") || "").trim(),
      },
      emotion:  String(fd.get("emotion") || "neutral").trim(),
      triggers,
      meta: {
        aliases,
        priority: fd.get("priority") || "medium",
        pin,
        notes: String(fd.get("notes") || "").trim(),
      },
    };

    const saved = updateNeuron(id, patch);
    if (saved) {
      graphState.editorMsg  = "✓ Cambios guardados";
      graphState.editorMode = false;
      // Actualizar el nodo seleccionado en el grafo
      rebuildAndRender(root, sessionState);
    } else {
      graphState.editorMsg = "✗ Error al guardar";
      rerenderDetailPanel(root);
      wireDetailPanel(root, sessionState);
    }
  });

  // Agregar conexión
  panel.querySelector("#ngBtnAddConn")?.addEventListener("click", () => {
    const n = graphState.selectedNode;
    if (!n) return;
    const input = panel.querySelector("#ngConnTarget");
    const rawValue = (input?.value || "").trim();
    if (!rawValue) return;

    // Buscar por ID o por concepto/alias
    const all = getAllNeurons();
    let target = all.find((x) => x.id === rawValue);
    if (!target) {
      const lower = rawValue.toLowerCase();
      target = all.find((x) =>
        (x.core?.concept || "").toLowerCase() === lower ||
        (x.meta?.aliases || []).some((a) => a.toLowerCase() === lower)
      );
    }

    if (target) {
      const ok = linkNeurons(n.id, target.id, { connectionSource: "manual" });
      if (ok) {
        if (input) input.value = "";
        rebuildAndRender(root, sessionState);
        return;
      }
    }
    // Mostrar error inline
    if (input) {
      input.style.borderColor = "#f87171";
      setTimeout(() => { input.style.borderColor = ""; }, 1500);
    }
  });

  // Quitar conexión
  panel.querySelectorAll(".ngUnlinkBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sourceId = btn.dataset.source;
      const targetId = btn.dataset.target;
      if (sourceId && targetId) {
        unlinkNeurons(sourceId, targetId);
        rebuildAndRender(root, sessionState);
      }
    });
  });
}

function rerenderDetailPanel(root) {
  const panel = root.querySelector("#ngDetailPanel");
  if (panel) panel.innerHTML = renderNodeDetail();
}

function rebuildAndRender(root, sessionState = {}) {
  const neurons = getAllNeurons();
  graphState.graph    = buildNeuronGraph(neurons, {
    colorBy:      graphState.colorBy,
    highlightIds: sessionState.lastActivatedIds || [],
    newIds:       sessionState.lastGeneratedIds  || [],
    mergedIds:    sessionState.lastMergedIds     || [],
  });
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);

  const wrap = root.querySelector(".ngWrap");
  if (!wrap) return;
  wrap.outerHTML = ngraphInner(sessionState).replace(/^\s*<div class="ngWrap">/, '<div class="ngWrap">');

  // Re-render completo
  const newWrap = root.querySelector(".ngWrap");
  if (newWrap) {
    wireNeuroGraphInner(root, sessionState);
  }
}

// ---- Exports ----

/**
 * Devuelve el HTML completo de la vista de grafo.
 * @param {{ lastActivatedIds?: string[], lastGeneratedIds?: string[], lastMergedIds?: string[] }} [sessionState]
 * @returns {string}
 */
export function viewNeuroGraph(sessionState = {}) {
  const neurons = getAllNeurons();
  graphState.graph    = buildNeuronGraph(neurons, {
    colorBy:      graphState.colorBy,
    highlightIds: sessionState.lastActivatedIds || [],
    newIds:       sessionState.lastGeneratedIds  || [],
    mergedIds:    sessionState.lastMergedIds     || [],
  });
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  return ngraphInner(sessionState);
}

/**
 * Wiring principal de la vista de grafo.
 * @param {Element} root
 * @param {{ lastActivatedIds?: string[], lastGeneratedIds?: string[], lastMergedIds?: string[] }} [sessionState]
 */
export function wireNeuroGraph(root, sessionState = {}) {
  wireNeuroGraphInner(root, sessionState);
}

// ---- CSS ----
function ngCss() {
  return `<style id="ngraphStyles">
  .ngWrap { max-width: 1100px; margin: 0 auto; padding: 0 0 80px; }

  /* Header */
  .ngHeader {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: rgba(99,102,241,.12);
    border: 1px solid rgba(99,102,241,.25); border-radius: 16px; margin-bottom: 12px;
  }
  .ngHeaderLeft { display: flex; align-items: center; gap: 12px; }
  .ngHeaderIcon  { font-size: 28px; }
  .ngHeaderTitle { font-size: 16px; font-weight: 800; }
  .ngHeaderSub   { font-size: 11px; opacity: .6; margin-top: 2px; }
  .ngHeaderActions { display: flex; gap: 6px; }
  .ngIconBtn {
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 14px;
    color: inherit; transition: background .12s;
  }
  .ngIconBtn:hover { background: rgba(255,255,255,.15); }

  /* Filtros */
  .ngFilters {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07);
    border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;
  }
  .ngSearchInput {
    flex: 1; min-width: 160px; background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
    padding: 6px 10px; color: inherit; font-size: 12px; outline: none;
  }
  .ngSearchInput::placeholder { opacity: .4; }
  .ngSelect {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 6px 8px; color: inherit; font-size: 12px;
    cursor: pointer; outline: none;
  }

  /* Layout grafo + detalle */
  .ngLayout { display: flex; gap: 14px; align-items: flex-start; }
  .ngGraphArea {
    flex: 1; min-width: 0;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px; overflow: hidden; position: relative; min-height: 420px;
  }
  .ngDetailPanel {
    width: 270px; flex-shrink: 0;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
    border-radius: 16px; overflow-y: auto; max-height: 520px;
  }
  @media(max-width:700px) {
    .ngLayout      { flex-direction: column; }
    .ngDetailPanel { width: 100%; max-height: none; }
  }

  /* SVG */
  .ngSvg { display: block; width: 100%; cursor: grab; }
  .ngSvg:active { cursor: grabbing; }
  .ngEdge { stroke: rgba(255,255,255,.1); stroke-width: 1; }
  .ngNode { cursor: pointer; transition: opacity .15s; }
  .ngNode:hover { opacity: 1 !important; }
  .ngNode--selected { stroke: #fff; stroke-width: 2.5; }
  .ngNode--active   { filter: url(#ngGlow); }
  .ngNode--new      { stroke: #34d399; stroke-width: 2; }
  .ngNode--merged   { stroke: #fbbf24; stroke-width: 2; }
  .ngNodeLabel { font-size: 9px; fill: rgba(255,255,255,.6); font-family: inherit; pointer-events: none; }
  .ngNodeLabel--selected { fill: #fff; font-weight: 700; }
  .ngHalo { fill: none; opacity: .35; }
  .ngHalo--active { stroke: #a78bfa; stroke-width: 4; animation: ngPulse 1.5s infinite; }
  .ngHalo--new    { stroke: #34d399; stroke-width: 3; animation: ngPulse 2s  infinite; }
  @keyframes ngPulse {
    0%, 100% { opacity: .2; } 50% { opacity: .6; }
  }
  .ngEmpty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 300px; text-align: center; opacity: .5; font-size: 14px; gap: 6px;
  }
  .ngEmptyIcon { font-size: 36px; }

  /* Detalle */
  .ngDetail { padding: 14px; }
  .ngDetailEmpty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 200px; text-align: center; opacity: .4; font-size: 12px; gap: 8px;
  }
  .ngDetailHeader { padding-left: 10px; margin-bottom: 10px; }
  .ngDetailConcept { font-size: 14px; font-weight: 800; word-break: break-word; }
  .ngDetailType    { font-size: 11px; opacity: .55; margin-top: 2px; }
  .ngDetailSummary {
    font-size: 12px; opacity: .7; margin-bottom: 12px; line-height: 1.5;
    background: rgba(255,255,255,.04); border-radius: 8px; padding: 8px;
  }
  .ngDetailGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
  .ngDetailItem { background: rgba(255,255,255,.04); border-radius: 8px; padding: 6px 8px; }
  .ngDetailItemLabel { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; opacity: .45; margin-bottom: 2px; }
  .ngDetailSection { margin-top: 10px; }
  .ngDetailSectionTitle { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; opacity: .45; margin-bottom: 5px; }
  .ngTagList { display: flex; flex-wrap: wrap; gap: 4px; }
  .ngTag { font-size: 10px; padding: 2px 7px; border-radius: 6px;
    background: rgba(99,102,241,.18); color: #a5b4fc; font-weight: 600; }
  .ngEvidenceItem { font-size: 11px; opacity: .65; margin-bottom: 2px; }
  .ngStatusBadge {
    display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 6px;
    font-weight: 600; margin-top: 4px;
  }
  .ngStatusBadge--active  { background: rgba(124,92,255,.2); color: #a78bfa; }
  .ngStatusBadge--new     { background: rgba(52,211,153,.2); color: #34d399; }
  .ngStatusBadge--merged  { background: rgba(251,191,36,.2); color: #fbbf24; }

  /* Leyenda */
  .ngLegend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; padding: 0 4px; font-size: 11px; opacity: .6; }
  .ngLegendItem { display: flex; align-items: center; gap: 5px; }
  .ngLegendDot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .ngLegendDot--active { background: #a78bfa; }
  .ngLegendDot--new    { background: #34d399; }
  .ngLegendDot--merged { background: #fbbf24; }

  /* Calibración feedback */
  .ngCalibBadge {
    font-size: 11px; padding: 5px 8px; border-radius: 8px; margin: 8px 0;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
    line-height: 1.4;
  }
  .ngCalibBadge--positive { background: rgba(52,211,153,.12); border-color: rgba(52,211,153,.3); color: #34d399; }
  .ngCalibBadge--negative { background: rgba(248,113,113,.12); border-color: rgba(248,113,113,.3); color: #f87171; }
  .ngCalibBadge--neutral  { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.08); }

  /* Conexiones */
  .ngConnList { display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
  .ngConnItem { display: flex; align-items: center; gap: 6px; }

  /* Editor */
  .ngEditor { overflow-y: auto; }
  .ngEditorForm { display: flex; flex-direction: column; gap: 6px; }
  .ngEditorLabel { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; opacity: .5; margin-top: 4px; }
  .ngEditorInput {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 6px 9px; color: inherit; font-size: 12px;
    font-family: inherit; outline: none; resize: vertical;
  }
  .ngEditorInput:focus { border-color: rgba(99,102,241,.5); }
  .ngEditorMsg {
    font-size: 11px; padding: 5px 8px; border-radius: 8px; margin-bottom: 6px;
  }
  .ngEditorMsg--ok  { background: rgba(52,211,153,.15); color: #34d399; }
  .ngEditorMsg--err { background: rgba(248,113,113,.15); color: #f87171; }
  </style>`;
}

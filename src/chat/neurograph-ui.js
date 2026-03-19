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

import { getAllNeurons } from "../neuro/neuronStore.js";
import {
  buildNeuronGraph,
  filterGraphNodes,
  getGraphDomains,
  getGraphEmotions,
  getDomainColors,
  getEmotionColors,
} from "../neuro/graph.js";

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

  return `
    <div class="ngDetail">
      <div class="ngDetailHeader" style="border-left: 3px solid ${color}">
        <div class="ngDetailConcept">${esc(n.label)}</div>
        <div class="ngDetailType">${esc(n.type)} · ${esc(n.domain)}</div>
        ${statusBadge}
      </div>

      ${n.summary ? `<div class="ngDetailSummary">${esc(n.summary)}</div>` : ""}

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
function rerenderGraph(root) {
  const area        = root.querySelector("#ngGraphArea");
  const detailPanel = root.querySelector("#ngDetailPanel");
  const header      = root.querySelector(".ngHeaderSub");

  if (area) {
    area.innerHTML = renderGraphSVG();
    wireGraphSVG(root);
  }
  if (detailPanel) {
    detailPanel.innerHTML = renderNodeDetail();
  }
  if (header) {
    const { graph, filtered } = graphState;
    header.textContent = `${graph.nodes.length} neuronas · ${filtered.nodes.length} visibles · ${filtered.edges.length} conexiones`;
  }
}

function applyFiltersAndRerender(root) {
  graphState.filtered = filterGraphNodes(graphState.graph, graphState.filters);
  rerenderGraph(root);
}

// ---- Wiring del SVG (nodos clickeables, pan, zoom) ----
function wireGraphSVG(root) {
  const svg = root.querySelector("#ngSvg");
  if (!svg) return;

  // Click en nodo
  svg.addEventListener("click", (e) => {
    const nodeEl = e.target.closest("[data-id]");
    if (!nodeEl) {
      graphState.selectedNode = null;
      rerenderGraph(root);
      return;
    }
    const id   = nodeEl.dataset.id;
    const node = graphState.filtered.nodes.find((n) => n.id === id);
    if (node) {
      graphState.selectedNode = node;
      rerenderGraph(root);
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
  wireGraphSVG(root);

  // Zoom in/out
  root.querySelector("#ngBtnZoomIn")?.addEventListener("click", () => {
    graphState.zoom = Math.min(graphState.zoom * 1.25, 5);
    rerenderGraph(root);
  });
  root.querySelector("#ngBtnZoomOut")?.addEventListener("click", () => {
    graphState.zoom = Math.max(graphState.zoom / 1.25, 0.2);
    rerenderGraph(root);
  });
  root.querySelector("#ngBtnZoomReset")?.addEventListener("click", () => {
    graphState.zoom = 1;
    graphState.pan  = { x: 0, y: 0 };
    rerenderGraph(root);
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
    applyFiltersAndRerender(root);
    // Actualizar selectores
    ["#ngFilterDomain", "#ngFilterEmotion", "#ngFilterRecent", "#ngFilterSource", "#ngFilterManualCategory", "#ngFilterPinned"].forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) el.value = "";
    });
  });

  // Filtros
  root.querySelector("#ngFilterDomain")?.addEventListener("change", (e) => {
    graphState.filters.domain = e.target.value || null;
    applyFiltersAndRerender(root);
  });
  root.querySelector("#ngFilterEmotion")?.addEventListener("change", (e) => {
    graphState.filters.emotion = e.target.value || null;
    applyFiltersAndRerender(root);
  });
  root.querySelector("#ngFilterRecent")?.addEventListener("change", (e) => {
    graphState.filters.recentDays = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRerender(root);
  });
  
  root.querySelector("#ngFilterSource")?.addEventListener("change", (e) => {
    graphState.filters.sourceKind = e.target.value || null;
    applyFiltersAndRerender(root);
  });
  root.querySelector("#ngFilterManualCategory")?.addEventListener("change", (e) => {
    graphState.filters.manualCategory = e.target.value || null;
    applyFiltersAndRerender(root);
  });
  root.querySelector("#ngFilterPinned")?.addEventListener("change", (e) => {
    if (e.target.value === "") graphState.filters.pinned = null;
    else graphState.filters.pinned = e.target.value === "1";
    applyFiltersAndRerender(root);
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
      applyFiltersAndRerender(root);
    }, 200);
  });
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
  </style>`;
}

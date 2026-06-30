/**
 * MemoryCarl · Sleep Radial Chart
 * v1.0.0 — 2026
 *
 * Módulo independiente que agrega la pestaña "🌀 Radial" al Dream Journal Pro.
 * Inspirado en los bullet journal trackers circulares tipo Bujo.
 *
 * INTEGRACIÓN (una sola línea en sleep_journal_pro.js):
 *   Buscar la línea: data-tab="chart">📈 Gráfico</button>
 *   Agregar después: <button class="djp-tab" data-tab="radial">🌀 Radial</button>
 *
 *   En renderActive(), agregar:
 *   else if (uiState.tab === "radial") window.DJP_Radial.render(content, getFiltered());
 *
 * No modifica ningún archivo existente salvo esas dos líneas.
 */

(function () {
  "use strict";

  // ─── Paleta del módulo ────────────────────────────────────────────────────

  const COLORS = {
    bg:          "rgba(13,12,26,0)",
    ring:        "rgba(255,255,255,0.06)",
    ringLabel:   "rgba(255,255,255,0.20)",
    spoke:       "rgba(255,255,255,0.05)",
    accent:      "#7c5cff",
    accentGlow:  "rgba(124,92,255,0.35)",
    gold:        "#c9933a",
    goldGlow:    "rgba(201,147,58,0.4)",
    dot:         "#ffffff",
    tooltip_bg:  "rgba(13,12,26,0.95)",
    tooltip_bd:  "rgba(124,92,255,0.4)",
  };

  // ─── Constantes de layout ─────────────────────────────────────────────────

  const RINGS       = 5;   // círculos concéntricos (1–5 horas extra de la base)
  const BASE_HOURS  = 4;   // el círculo más interior = 4h de sueño
  const MAX_HOURS   = BASE_HOURS + RINGS; // = 9h
  const SPOKE_EXTRA = 18;  // px extra más allá del anillo exterior para la línea

  // ─── Modos de color disponibles ──────────────────────────────────────────

  const COLOR_MODES = [
    { id: "quality",   label: "Calidad",   icon: "⭐" },
    { id: "dreamType", label: "Tipo",      icon: "🌙" },
    { id: "emotion",   label: "Emoción",   icon: "💜" },
    { id: "clarity",   label: "Claridad",  icon: "🔮" },
  ];

  // ─── Colores por tipo de sueño ───────────────────────────────────────────

  const TYPE_COLORS = {
    lucid:     "#7c5cff",
    nightmare: "#ff4d6d",
    recurring: "#ff9f1c",
    vivid:     "#06d6a0",
    prophetic: "#e040fb",
    normal:    "#5c9eff",
    "":        "#5c9eff",
  };

  const EMOTION_COLORS = {
    calm:      "#5c9eff",
    anxious:   "#ff4d6d",
    happy:     "#ffd166",
    confused:  "#a78bfa",
    energized: "#06d6a0",
    melancholy:"#94a3b8",
    inspired:  "#e040fb",
    scared:    "#ff6b35",
    "":        "#5c9eff",
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function polarToXY(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function hoursToRadius(hours, innerR, outerR) {
    const pct = clamp((hours - BASE_HOURS) / RINGS, 0, 1);
    return innerR + pct * (outerR - innerR);
  }

  function qualityColor(q) {
    if (q == null) return COLORS.accent;
    if (q >= 4.5) return "#06d6a0";
    if (q >= 3.5) return "#7c5cff";
    if (q >= 2.5) return "#ffd166";
    if (q >= 1.5) return "#ff9f1c";
    return "#ff4d6d";
  }

  function clarityColor(c) {
    if (c == null) return COLORS.accent;
    const palette = ["#94a3b8","#a78bfa","#7c5cff","#5c9eff","#06d6a0"];
    return palette[clamp(Math.round(c) - 1, 0, 4)];
  }

  function dotColor(entry, mode) {
    switch (mode) {
      case "quality":   return qualityColor(entry.quality);
      case "dreamType": return TYPE_COLORS[entry.dreamType] || COLORS.accent;
      case "emotion":   return EMOTION_COLORS[entry.wakeEmotion] || COLORS.accent;
      case "clarity":   return clarityColor(entry.clarity);
      default:          return COLORS.accent;
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y?.slice(2)}`;
  }

  function dreamTypeLabel(t) {
    const map = {
      normal:"Normal",lucid:"Lúcido",nightmare:"Pesadilla",
      recurring:"Recurrente",vivid:"Vívido",prophetic:"Profético",
    };
    return map[t] || t || "—";
  }

  function emotionLabel(e) {
    const map = {
      calm:"Calma",anxious:"Ansioso",happy:"Feliz",confused:"Confundido",
      energized:"Energizado",melancholy:"Melancólico",inspired:"Inspirado",scared:"Asustado",
    };
    return map[e] || e || "—";
  }

  // ─── CSS inyectado ────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("djp-radial-styles")) return;
    const s = document.createElement("style");
    s.id = "djp-radial-styles";
    s.textContent = `
/* ── Sleep Radial Chart ─────────────────────────────────── */
.djpr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 4px 0 12px;
  user-select: none;
}

/* Controles superiores */
.djpr-controls {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}
.djpr-mode-btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.1);
  background: transparent;
  color: rgba(255,255,255,.5);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
  transition: all .15s;
}
.djpr-mode-btn:hover { color: rgba(255,255,255,.8); }
.djpr-mode-btn.active {
  background: rgba(124,92,255,.22);
  border-color: rgba(124,92,255,.5);
  color: #fff;
}

/* Contenedor SVG */
.djpr-svg-container {
  position: relative;
  width: 100%;
  max-width: 400px;
}
.djpr-svg-container svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

/* Tooltip */
.djpr-tooltip {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  background: rgba(13,12,26,0.96);
  border: 1px solid rgba(124,92,255,0.45);
  border-radius: 10px;
  padding: 10px 13px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #fff;
  min-width: 160px;
  max-width: 220px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  opacity: 0;
  transition: opacity .12s ease;
  line-height: 1.6;
}
.djpr-tooltip.visible { opacity: 1; }
.djpr-tooltip-date {
  font-size: 10px;
  color: rgba(124,92,255,.9);
  font-weight: 700;
  margin-bottom: 5px;
  letter-spacing: .5px;
}
.djpr-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: rgba(255,255,255,.7);
}
.djpr-tooltip-val {
  color: #fff;
  font-weight: 700;
}

/* Leyenda */
.djpr-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  justify-content: center;
  max-width: 400px;
}
.djpr-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: rgba(255,255,255,.6);
}
.djpr-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Estado vacío */
.djpr-empty {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255,255,255,.35);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.djpr-empty-icon {
  font-size: 36px;
  margin-bottom: 10px;
}
`;
    document.head.appendChild(s);
  }

  // ─── Construcción del SVG ─────────────────────────────────────────────────

  function buildSVG(entries, colorMode) {
    const SIZE     = 400;
    const CX       = SIZE / 2;
    const CY       = SIZE / 2;
    const INNER_R  = 52;   // radio del anillo más interior
    const OUTER_R  = 165;  // radio del anillo más exterior
    const LABEL_R  = OUTER_R + SPOKE_EXTRA + 14; // radio de labels de fecha

    const total = entries.length;
    if (!total) return null;

    // Cada entrada ocupa un ángulo proporcional al total (360°)
    const angleStep = 360 / total;

    const ns = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute("xmlns", ns);

    const defs = document.createElementNS(ns, "defs");

    // Gradiente radial para el centro decorativo
    const grad = document.createElementNS(ns, "radialGradient");
    grad.id = "djpr-center-grad";
    grad.setAttribute("cx", "50%");
    grad.setAttribute("cy", "50%");
    grad.setAttribute("r", "50%");
    [
      { off: "0%",   color: COLORS.gold,     opacity: "0.18" },
      { off: "100%", color: COLORS.gold,     opacity: "0"    },
    ].forEach(({ off, color, opacity }) => {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", off);
      stop.setAttribute("stop-color", color);
      stop.setAttribute("stop-opacity", opacity);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);

    // Filtro glow para los puntos activos
    const filter = document.createElementNS(ns, "filter");
    filter.id = "djpr-glow";
    filter.setAttribute("x", "-50%");
    filter.setAttribute("y", "-50%");
    filter.setAttribute("width", "200%");
    filter.setAttribute("height", "200%");
    const feBlur = document.createElementNS(ns, "feGaussianBlur");
    feBlur.setAttribute("stdDeviation", "3");
    feBlur.setAttribute("result", "blur");
    const feMerge = document.createElementNS(ns, "feMerge");
    ["blur", "SourceGraphic"].forEach(inp => {
      const n = document.createElementNS(ns, "feMergeNode");
      if (inp !== "SourceGraphic") n.setAttribute("in", inp);
      feMerge.appendChild(n);
    });
    filter.appendChild(feBlur);
    filter.appendChild(feMerge);
    defs.appendChild(filter);

    svg.appendChild(defs);

    // ── Fondo central con gradiente ──
    const bgCircle = document.createElementNS(ns, "circle");
    bgCircle.setAttribute("cx", CX);
    bgCircle.setAttribute("cy", CY);
    bgCircle.setAttribute("r", OUTER_R + 30);
    bgCircle.setAttribute("fill", "url(#djpr-center-grad)");
    svg.appendChild(bgCircle);

    // ── Anillos concéntricos ──
    for (let i = 0; i <= RINGS; i++) {
      const r = INNER_R + (i / RINGS) * (OUTER_R - INNER_R);
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", CX);
      circle.setAttribute("cy", CY);
      circle.setAttribute("r", r);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", COLORS.ring);
      circle.setAttribute("stroke-width", i === 0 || i === RINGS ? "1.5" : "1");
      svg.appendChild(circle);

      // Label de horas en el anillo (lado izquierdo)
      if (i > 0) {
        const labelPos = polarToXY(CX, CY, r, 270); // 270° = izquierda
        const lbl = document.createElementNS(ns, "text");
        lbl.setAttribute("x", labelPos.x - 4);
        lbl.setAttribute("y", labelPos.y + 3);
        lbl.setAttribute("text-anchor", "end");
        lbl.setAttribute("font-size", "8");
        lbl.setAttribute("fill", COLORS.ringLabel);
        lbl.setAttribute("font-family", "JetBrains Mono, monospace");
        lbl.textContent = `${BASE_HOURS + i}h`;
        svg.appendChild(lbl);
      }
    }

    // ── Radios (spokes) ──
    entries.forEach((_, idx) => {
      const angle = idx * angleStep;
      const inner = polarToXY(CX, CY, INNER_R, angle);
      const outer = polarToXY(CX, CY, OUTER_R + SPOKE_EXTRA, angle);
      const line  = document.createElementNS(ns, "line");
      line.setAttribute("x1", inner.x);
      line.setAttribute("y1", inner.y);
      line.setAttribute("x2", outer.x);
      line.setAttribute("y2", outer.y);
      line.setAttribute("stroke", COLORS.spoke);
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
    });

    // ── Polígono de datos ──
    const points = entries.map((entry, idx) => {
      const angle = idx * angleStep;
      const hours = clamp((entry.totalMinutes || 0) / 60, BASE_HOURS, MAX_HOURS);
      const r     = hoursToRadius(hours, INNER_R, OUTER_R);
      return polarToXY(CX, CY, r, angle);
    });

    // Área rellena (con baja opacidad)
    const polyFill = document.createElementNS(ns, "polygon");
    polyFill.setAttribute(
      "points",
      points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
    );
    polyFill.setAttribute("fill", COLORS.accentGlow);
    polyFill.setAttribute("stroke", "none");
    svg.appendChild(polyFill);

    // Contorno del polígono
    const polyStroke = document.createElementNS(ns, "polygon");
    polyStroke.setAttribute(
      "points",
      points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
    );
    polyStroke.setAttribute("fill", "none");
    polyStroke.setAttribute("stroke", COLORS.gold);
    polyStroke.setAttribute("stroke-width", "1.5");
    polyStroke.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyStroke);

    // ── Puntos individuales + labels de fecha ──
    const dotGroup = document.createElementNS(ns, "g");
    dotGroup.setAttribute("class", "djpr-dots");

    entries.forEach((entry, idx) => {
      const angle  = idx * angleStep;
      const hours  = clamp((entry.totalMinutes || 0) / 60, BASE_HOURS, MAX_HOURS);
      const r      = hoursToRadius(hours, INNER_R, OUTER_R);
      const pos    = polarToXY(CX, CY, r, angle);
      const color  = dotColor(entry, colorMode);

      // Aura del punto
      const aura = document.createElementNS(ns, "circle");
      aura.setAttribute("cx", pos.x);
      aura.setAttribute("cy", pos.y);
      aura.setAttribute("r", 6);
      aura.setAttribute("fill", color);
      aura.setAttribute("opacity", "0.25");
      dotGroup.appendChild(aura);

      // Punto principal
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", pos.x);
      dot.setAttribute("cy", pos.y);
      dot.setAttribute("r", 4);
      dot.setAttribute("fill", color);
      dot.setAttribute("stroke", "rgba(13,12,26,0.8)");
      dot.setAttribute("stroke-width", "1.5");
      dot.setAttribute("filter", "url(#djpr-glow)");
      dot.setAttribute("cursor", "pointer");
      dot.dataset.idx = idx;
      dotGroup.appendChild(dot);

      // Label de fecha (solo si hay espacio, cada N entradas)
      const showLabel = total <= 31 || idx % Math.ceil(total / 20) === 0;
      if (showLabel) {
        const lpos  = polarToXY(CX, CY, LABEL_R, angle);
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", lpos.x);
        label.setAttribute("y", lpos.y);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("font-size", "7.5");
        label.setAttribute("fill", COLORS.ringLabel);
        label.setAttribute("font-family", "JetBrains Mono, monospace");
        // Rotar el label para seguir el eje del spoke
        const rotAngle = angle > 180 ? angle - 90 : angle + 90;
        label.setAttribute(
          "transform",
          `rotate(${rotAngle - 90}, ${lpos.x}, ${lpos.y})`
        );
        label.textContent = formatDate(entry.date);
        svg.appendChild(label);
      }
    });

    svg.appendChild(dotGroup);

    // ── Centro decorativo (triángulo dorado tipo bujo) ──
    const centerGroup = document.createElementNS(ns, "g");
    const triH = INNER_R * 0.55;

    // Triángulo superior
    const tri1 = document.createElementNS(ns, "polygon");
    tri1.setAttribute(
      "points",
      `${CX},${CY - triH} ${CX - triH * 0.55},${CY + triH * 0.3} ${CX + triH * 0.55},${CY + triH * 0.3}`
    );
    tri1.setAttribute("fill", COLORS.gold);
    tri1.setAttribute("opacity", "0.22");
    centerGroup.appendChild(tri1);

    // Triángulo invertido (Art deco)
    const tri2 = document.createElementNS(ns, "polygon");
    tri2.setAttribute(
      "points",
      `${CX},${CY + triH * 0.9} ${CX - triH * 0.4},${CY - triH * 0.1} ${CX + triH * 0.4},${CY - triH * 0.1}`
    );
    tri2.setAttribute("fill", COLORS.gold);
    tri2.setAttribute("opacity", "0.12");
    centerGroup.appendChild(tri2);

    // Círculo central
    const innerCirc = document.createElementNS(ns, "circle");
    innerCirc.setAttribute("cx", CX);
    innerCirc.setAttribute("cy", CY);
    innerCirc.setAttribute("r", INNER_R * 0.32);
    innerCirc.setAttribute("fill", "none");
    innerCirc.setAttribute("stroke", COLORS.gold);
    innerCirc.setAttribute("stroke-width", "1");
    innerCirc.setAttribute("opacity", "0.4");
    centerGroup.appendChild(innerCirc);

    // Texto central
    const centerText = document.createElementNS(ns, "text");
    centerText.setAttribute("x", CX);
    centerText.setAttribute("y", CY + 1);
    centerText.setAttribute("text-anchor", "middle");
    centerText.setAttribute("dominant-baseline", "middle");
    centerText.setAttribute("font-size", "9");
    centerText.setAttribute("fill", COLORS.gold);
    centerText.setAttribute("opacity", "0.7");
    centerText.setAttribute("font-family", "JetBrains Mono, monospace");
    centerText.textContent = `${total}d`;
    centerGroup.appendChild(centerText);

    svg.appendChild(centerGroup);

    return { svg, entries, points };
  }

  // ─── Construcción de la leyenda ───────────────────────────────────────────

  function buildLegend(colorMode) {
    const wrap = document.createElement("div");
    wrap.className = "djpr-legend";

    let items = [];

    if (colorMode === "quality") {
      items = [
        { color: "#06d6a0", label: "Excelente (5)" },
        { color: "#7c5cff", label: "Bueno (4)"     },
        { color: "#ffd166", label: "Regular (3)"   },
        { color: "#ff9f1c", label: "Malo (2)"      },
        { color: "#ff4d6d", label: "Pésimo (1)"    },
      ];
    } else if (colorMode === "dreamType") {
      items = Object.entries(TYPE_COLORS)
        .filter(([k]) => k !== "")
        .map(([k, color]) => ({ color, label: dreamTypeLabel(k) }));
    } else if (colorMode === "emotion") {
      items = Object.entries(EMOTION_COLORS)
        .filter(([k]) => k !== "")
        .map(([k, color]) => ({ color, label: emotionLabel(k) }));
    } else if (colorMode === "clarity") {
      items = [
        { color: "#94a3b8", label: "Borroso"   },
        { color: "#a78bfa", label: "Parcial"   },
        { color: "#7c5cff", label: "Claro"     },
        { color: "#5c9eff", label: "Vívido"    },
        { color: "#06d6a0", label: "Hiper-real"},
      ];
    }

    items.forEach(({ color, label }) => {
      const item = document.createElement("div");
      item.className = "djpr-legend-item";
      item.innerHTML = `
        <div class="djpr-legend-dot" style="background:${color}"></div>
        <span>${label}</span>
      `;
      wrap.appendChild(item);
    });

    return wrap;
  }

  // ─── Tooltip ──────────────────────────────────────────────────────────────

  function createTooltip() {
    const tt = document.createElement("div");
    tt.className = "djpr-tooltip";
    document.body.appendChild(tt);
    return tt;
  }

  function showTooltip(tt, entry, x, y) {
    const hours   = ((entry.totalMinutes || 0) / 60).toFixed(1);
    const typeIcon = { normal:"🌙",lucid:"✨",nightmare:"😨",recurring:"🔄",vivid:"🎨",prophetic:"🔮" };
    const emoIcon  = { calm:"🌊",anxious:"😰",happy:"😊",confused:"🌀",energized:"⚡",melancholy:"🌧️",inspired:"💡",scared:"😱" };

    tt.innerHTML = `
      <div class="djpr-tooltip-date">${formatDate(entry.date)}</div>
      <div class="djpr-tooltip-row">
        <span>⏱ Horas</span>
        <span class="djpr-tooltip-val">${hours}h</span>
      </div>
      ${entry.quality != null ? `
      <div class="djpr-tooltip-row">
        <span>⭐ Calidad</span>
        <span class="djpr-tooltip-val">${entry.quality}/5</span>
      </div>` : ""}
      ${entry.dreamType ? `
      <div class="djpr-tooltip-row">
        <span>${typeIcon[entry.dreamType] || "🌙"} Tipo</span>
        <span class="djpr-tooltip-val">${dreamTypeLabel(entry.dreamType)}</span>
      </div>` : ""}
      ${entry.wakeEmotion ? `
      <div class="djpr-tooltip-row">
        <span>${emoIcon[entry.wakeEmotion] || "💜"} Emoción</span>
        <span class="djpr-tooltip-val">${emotionLabel(entry.wakeEmotion)}</span>
      </div>` : ""}
      ${entry.clarity != null ? `
      <div class="djpr-tooltip-row">
        <span>🔮 Claridad</span>
        <span class="djpr-tooltip-val">${entry.clarity}/5</span>
      </div>` : ""}
      ${entry.lucidMoment ? `<div class="djpr-tooltip-row"><span>✨ Momento lúcido</span></div>` : ""}
    `;

    // Posición segura dentro de la ventana
    const tw = 230, th = 160;
    const safeX = x + tw > window.innerWidth  ? x - tw - 12 : x + 12;
    const safeY = y + th > window.innerHeight ? y - th - 12 : y + 12;

    tt.style.left = `${safeX}px`;
    tt.style.top  = `${safeY}px`;
    tt.classList.add("visible");
  }

  function hideTooltip(tt) {
    tt.classList.remove("visible");
  }

  // ─── Render principal ─────────────────────────────────────────────────────

  function render(container, entries) {
    injectStyles();

    container.innerHTML = "";

    // Sin datos
    if (!entries || !entries.length) {
      const empty = document.createElement("div");
      empty.className = "djpr-empty";
      empty.innerHTML = `
        <div class="djpr-empty-icon">🌙</div>
        <div>Sin registros de sueño para mostrar.</div>
        <div style="margin-top:6px;opacity:.5">Registra tu primer sueño para ver el mapa radial.</div>
      `;
      container.appendChild(empty);
      return;
    }

    // Ordenar por fecha ascendente para que el gráfico sea cronológico
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

    const wrap = document.createElement("div");
    wrap.className = "djpr-wrap";

    // Estado local del modo de color
    let colorMode = "quality";

    // Controles de modo
    const controls = document.createElement("div");
    controls.className = "djpr-controls";
    COLOR_MODES.forEach(m => {
      const btn = document.createElement("button");
      btn.className = "djpr-mode-btn" + (m.id === colorMode ? " active" : "");
      btn.textContent = `${m.icon} ${m.label}`;
      btn.addEventListener("click", () => {
        colorMode = m.id;
        controls.querySelectorAll(".djpr-mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        refreshChart();
      });
      controls.appendChild(btn);
    });
    wrap.appendChild(controls);

    // Contenedor SVG
    const svgContainer = document.createElement("div");
    svgContainer.className = "djpr-svg-container";
    wrap.appendChild(svgContainer);

    // Leyenda
    const legendContainer = document.createElement("div");
    wrap.appendChild(legendContainer);

    container.appendChild(wrap);

    // Tooltip (montado en body para evitar clipping)
    const tooltip = createTooltip();

    // Limpiar tooltip al desmontar
    const cleanupObs = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        tooltip.remove();
        cleanupObs.disconnect();
      }
    });
    cleanupObs.observe(document.body, { childList: true, subtree: true });

    function refreshChart() {
      svgContainer.innerHTML = "";

      const result = buildSVG(sorted, colorMode);
      if (!result) return;

      const { svg, entries: ents } = result;
      svgContainer.appendChild(svg);

      // Actualizar leyenda
      legendContainer.innerHTML = "";
      legendContainer.appendChild(buildLegend(colorMode));

      // Eventos en los puntos
      svg.querySelectorAll(".djpr-dots circle[data-idx]").forEach(dot => {
        const idx   = parseInt(dot.dataset.idx, 10);
        const entry = ents[idx];

        dot.addEventListener("mouseenter", e => {
          dot.setAttribute("r", "6");
          showTooltip(tooltip, entry, e.clientX, e.clientY);
        });
        dot.addEventListener("mousemove", e => {
          showTooltip(tooltip, entry, e.clientX, e.clientY);
        });
        dot.addEventListener("mouseleave", () => {
          dot.setAttribute("r", "4");
          hideTooltip(tooltip);
        });

        // Touch support
        dot.addEventListener("touchstart", e => {
          const t = e.touches[0];
          showTooltip(tooltip, entry, t.clientX, t.clientY);
          e.preventDefault();
        }, { passive: false });
        dot.addEventListener("touchend", () => {
          setTimeout(() => hideTooltip(tooltip), 1800);
        });
      });
    }

    refreshChart();
  }

  // ─── Exposición pública ───────────────────────────────────────────────────

  window.DJP_Radial = { render };

})();

/**
 * natalWheel.js — Rueda de la carta natal en SVG
 * MemoryCarl / NeuroChat · Couch
 *
 * - El Ascendente queda a la izquierda y los signos avanzan en sentido antihorario,
 *   como en cualquier carta.
 * - Los planetas que caen juntos se separan y llevan su grado al lado.
 * - Aspectos con estilo según su naturaleza (tensión, armonía, menores).
 * - Modo "calor": las casas y planetas se iluminan según cuánto se activan en tus conversaciones.
 */

import { ZODIAC_SIGNS, PLANETS_CATALOG, ASPECT_TYPES } from "./couchStore.js";
import { chartPoints, ascendantDegree, absoluteDegree, effectiveAspects } from "./astroChart.js";

// Fuerza la versión de texto de los símbolos (sin emoji de colores en móvil)
const TEXT = "︎";

export const ELEMENT_COLORS = {
  fuego: "#f87171",
  tierra: "#4ade80",
  aire: "#facc15",
  agua: "#60a5fa",
};

/** Estilo de línea según el aspecto */
export function aspectStyle(aspectId) {
  if (aspectId === "cuadratura" || aspectId === "oposicion") return { color: "#f87171", width: 1.6, dash: "", group: "tension" };
  if (aspectId === "trigono" || aspectId === "sextil") return { color: "#60a5fa", width: 1.4, dash: "", group: "armonia" };
  if (aspectId === "conjuncion") return { color: "#c084fc", width: 1.4, dash: "", group: "conjuncion" };
  return { color: "#94a3b8", width: 0.9, dash: "3 3", group: "menores" };
}

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Separa puntos demasiado juntos manteniendo su orden.
 * @param {Array<{lon: number}>} pts - ya ordenados por longitud
 * @param {number} minSep - separación mínima en grados
 * @returns {number[]} longitudes de dibujo
 */
export function spreadLongitudes(pts, minSep = 8) {
  const n = pts.length;
  if (n < 2) return pts.map((p) => p.lon);
  const disp = pts.map((p) => p.lon);
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let diff = disp[j] - disp[i];
      if (j === 0) diff += 360;
      if (diff < minSep) {
        const push = (minSep - diff) / 2;
        disp[i] -= push;
        disp[j] += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return disp.map((d) => ((d % 360) + 360) % 360);
}

/**
 * Renderiza la rueda natal.
 * @param {object} chart
 * @param {{
 *   selected?: string|null,          // planeta seleccionado (resalta sus aspectos)
 *   hiddenGroups?: string[],         // grupos de aspectos ocultos: tension, armonia, conjuncion, menores
 *   heat?: { houses: Record<number, number>, planets: Record<string, number> } | null, // 0..1
 * }} [opts]
 */
export function renderNatalWheel(chart, opts = {}) {
  const { selected = null, hiddenGroups = [], heat = null } = opts;
  const W = 520;
  const cx = W / 2;
  const cy = W / 2;
  const R_OUT = 228;     // borde exterior de la banda de signos
  const R_SIGN = 194;    // borde interior de la banda de signos
  const R_GLYPH = 172;   // planetas
  const R_DEG = 149;     // grado del planeta
  const R_HOUSE = 134;   // borde interior del anillo de planetas
  const R_ASP = 112;     // círculo de aspectos
  const R_NUM = 123;     // números de casa

  const asc = ascendantDegree(chart);
  // Ángulo matemático: AC a la izquierda (180°), avanzando en sentido antihorario
  const pos = (lon, r) => {
    const t = ((180 + (lon - asc)) * Math.PI) / 180;
    return { x: r2(cx + r * Math.cos(t)), y: r2(cy - r * Math.sin(t)) };
  };
  const arc = (r1, r2_, a, b) => {
    // Sector anular de a a b (longitudes, b > a)
    const p1 = pos(a, r2_), p2 = pos(b, r2_), p3 = pos(b, r1), p4 = pos(a, r1);
    const large = (b - a) % 360 > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r2_} ${r2_} 0 ${large} 0 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${r1} ${r1} 0 ${large} 1 ${p4.x} ${p4.y} Z`;
  };

  const parts = [];

  // Fondo
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R_OUT}" fill="#0f0d19" stroke="rgba(255,255,255,.18)" />`);

  // Banda de signos
  ZODIAC_SIGNS.forEach((sign, i) => {
    const color = ELEMENT_COLORS[sign.element];
    parts.push(`<path d="${arc(R_SIGN, R_OUT, i * 30, i * 30 + 30)}" fill="${color}" fill-opacity=".1" stroke="rgba(255,255,255,.14)" stroke-width="1" />`);
    const g = pos(i * 30 + 15, (R_OUT + R_SIGN) / 2);
    parts.push(`<text x="${g.x}" y="${g.y}" font-size="17" fill="${color}" text-anchor="middle" dominant-baseline="central">${sign.symbol}${TEXT}<title>${esc(sign.name)}</title></text>`);
  });
  // Marcas cada 5°
  for (let d = 0; d < 360; d += 5) {
    const a = pos(d, R_SIGN), b = pos(d, R_SIGN - (d % 10 === 0 ? 6 : 3));
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(255,255,255,.22)" stroke-width="1" />`);
  }

  // Casas
  const cusps = [...(chart.houseCusps || [])].sort((a, b) => a.house - b.house)
    .map((h) => ({ house: h.house, lon: absoluteDegree(h.sign, h.degree, h.minutes, h.seconds) }));
  const maxHeat = heat ? 1 : 0;
  cusps.forEach((c, i) => {
    const next = cusps[(i + 1) % 12];
    let end = next ? next.lon : c.lon + 30;
    if (end <= c.lon) end += 360;
    if (heat && maxHeat) {
      const v = heat.houses?.[c.house] || 0;
      if (v > 0) parts.push(`<path d="${arc(0.01, R_HOUSE, c.lon, end)}" fill="#f59e0b" fill-opacity="${r2(0.06 + v * 0.5)}" />`);
    }
    const angular = [1, 4, 7, 10].includes(c.house);
    const a = pos(c.lon, angular ? R_ASP : R_HOUSE), b = pos(c.lon, R_SIGN);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${angular ? "#c084fc" : "rgba(255,255,255,.22)"}" stroke-width="${angular ? 2 : 1}" />`);
    const n = pos((c.lon + end) / 2, R_NUM);
    parts.push(`<text x="${n.x}" y="${n.y}" font-size="11" font-weight="700" fill="${heat && heat.houses?.[c.house] ? "#fde68a" : "rgba(255,255,255,.45)"}" text-anchor="middle" dominant-baseline="central">${c.house}</text>`);
    if (angular) {
      const tag = { 1: "AC", 4: "IC", 7: "DC", 10: "MC" }[c.house];
      const t = pos(c.lon, R_OUT + 13);
      parts.push(`<text x="${t.x}" y="${t.y}" font-size="11" font-weight="800" fill="#c084fc" text-anchor="middle" dominant-baseline="central">${tag}</text>`);
    }
  });
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R_HOUSE}" fill="none" stroke="rgba(255,255,255,.16)" />`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R_ASP}" fill="none" stroke="rgba(255,255,255,.1)" />`);

  // Planetas (los ejes AC/MC ya están dibujados como líneas)
  const pts = chartPoints(chart).filter((p) => !p.isAngle).sort((a, b) => a.lon - b.lon);
  const disp = spreadLongitudes(pts, 10);

  // Aspectos
  if (!heat) {
    for (const asp of effectiveAspects(chart)) {
      const a = pts.find((p) => p.id === asp.planet1Id);
      const b = pts.find((p) => p.id === asp.planet2Id);
      if (!a || !b) continue;
      const st = aspectStyle(asp.aspectId);
      if (hiddenGroups.includes(st.group)) continue;
      const touches = selected && (a.id === selected || b.id === selected);
      const opacity = selected ? (touches ? 1 : 0.08) : 0.75;
      const pa = pos(a.lon, R_ASP), pb = pos(b.lon, R_ASP);
      const name = ASPECT_TYPES.find((t) => t.id === asp.aspectId)?.name || asp.aspectId;
      parts.push(`<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${st.color}" stroke-width="${touches ? st.width + 1 : st.width}" stroke-opacity="${opacity}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""}><title>${esc(a.name)} ${esc(name.toLowerCase())} ${esc(b.name)}</title></line>`);
    }
  }

  pts.forEach((p, i) => {
    const d = disp[i];
    const isSel = selected === p.id;
    const dim = selected && !isSel && !effectiveAspects(chart).some((a) => (a.planet1Id === selected && a.planet2Id === p.id) || (a.planet2Id === selected && a.planet1Id === p.id));
    const tick1 = pos(p.lon, R_SIGN), tick2 = pos(p.lon, R_SIGN - 9);
    const g = pos(d, R_GLYPH);
    const dl = pos(d, R_DEG);
    const dot = pos(p.lon, R_ASP);
    const deg = Math.floor(p.lon % 30);
    const v = heat?.planets?.[p.id] || 0;
    parts.push(`
      <g class="couchPlanet${isSel ? " couchPlanet--sel" : ""}" data-planet="${esc(p.id)}" opacity="${dim ? 0.35 : 1}">
        <title>${esc(p.name)} en ${esc(ZODIAC_SIGNS.find((s) => s.id === p.sign)?.name || p.sign)} ${deg}°${p.house ? `, casa ${p.house}` : ""}${p.retro ? " (retrógrado)" : ""}</title>
        <line x1="${tick1.x}" y1="${tick1.y}" x2="${tick2.x}" y2="${tick2.y}" stroke="#e9d5ff" stroke-width="1.5" />
        ${Math.abs(d - p.lon) > 1 ? `<line x1="${tick2.x}" y1="${tick2.y}" x2="${g.x}" y2="${g.y}" stroke="rgba(233,213,255,.3)" stroke-width="1" />` : ""}
        ${v > 0 ? `<circle cx="${g.x}" cy="${g.y}" r="${r2(12 + v * 12)}" fill="#f59e0b" fill-opacity="${r2(0.15 + v * 0.45)}" />` : ""}
        ${isSel ? `<circle cx="${g.x}" cy="${g.y}" r="14" fill="rgba(192,132,252,.25)" stroke="#c084fc" stroke-width="1.5" />` : ""}
        <circle cx="${g.x}" cy="${g.y}" r="14" fill="transparent" />
        <text x="${g.x}" y="${g.y}" font-size="21" fill="#f5f3ff" text-anchor="middle" dominant-baseline="central">${p.symbol}${p.symbol.length === 1 ? TEXT : ""}</text>
        <text x="${dl.x}" y="${dl.y}" font-size="12" font-weight="600" fill="rgba(233,213,255,.8)" text-anchor="middle" dominant-baseline="central">${deg}°${p.retro ? "ʀ" : ""}</text>
        ${heat ? "" : `<circle cx="${dot.x}" cy="${dot.y}" r="2.2" fill="#e9d5ff" />`}
      </g>`);
  });

  const empty = !pts.length
    ? `<text x="${cx}" y="${cy}" font-size="13" fill="rgba(255,255,255,.4)" text-anchor="middle">Agrega tus planetas en "Datos"</text>`
    : "";

  return `<svg viewBox="-12 -12 ${W + 24} ${W + 24}" class="couchNatalSvg" role="img" aria-label="Rueda de la carta natal">${parts.join("")}${empty}</svg>`;
}

/** Catálogo de un planeta por id (para la UI) */
export function planetInfo(id) {
  return PLANETS_CATALOG.find((p) => p.id === id) || null;
}

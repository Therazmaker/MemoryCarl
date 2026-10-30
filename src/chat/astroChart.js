/**
 * astroChart.js — Cálculos sobre la carta natal (sin UI)
 * MemoryCarl / NeuroChat · Couch
 *
 * Grados absolutos, casas, regentes, aspectos automáticos y un resumen compacto
 * de la carta para el prompt (pensado para gastar pocos tokens).
 */

import { ZODIAC_SIGNS, PLANETS_CATALOG, ASPECT_TYPES } from "./couchStore.js";

/** Puntos que son ejes de la carta, no planetas */
export const ANGLE_POINTS = ["ascendente", "mediocielo"];

/** Regente moderno de cada signo */
export const SIGN_RULERS = {
  aries: "marte", tauro: "venus", geminis: "mercurio", cancer: "luna",
  leo: "sol", virgo: "mercurio", libra: "venus", escorpio: "pluton",
  sagitario: "jupiter", capricornio: "saturno", acuario: "urano", piscis: "neptuno",
};

/** Tema de cada casa (para la UI y los vínculos) */
export const HOUSE_THEMES = {
  1: "identidad y cuerpo",
  2: "dinero y recursos",
  3: "comunicación y estudios",
  4: "hogar y familia",
  5: "amor, creatividad y disfrute",
  6: "rutina, salud y trabajo diario",
  7: "pareja y socios",
  8: "crisis, deudas e intimidad",
  9: "viajes, estudios superiores y fe",
  10: "carrera y propósito",
  11: "amigos, grupos y futuro",
  12: "mundo interior y descanso",
};

/** Orbe máximo por aspecto; los luminares (Sol, Luna) suman 2° en los mayores */
const ASPECT_ORBS = {
  conjuncion: 8, oposicion: 8, trigono: 6, cuadratura: 6, sextil: 4, quincuncio: 2, semisextil: 2,
};
// Puntos sensibles: solo conjunciones cerradas
const MINOR_POINTS = ["nodo_norte", "nodo_sur", "lilith"];
// Planetas generacionales: sus aspectos entre sí los comparte toda una generación
const GENERATIONAL = ["urano", "neptuno", "pluton"];
const LUMINARIES = ["sol", "luna"];
const MAJOR_ASPECTS = ["conjuncion", "oposicion", "trigono", "cuadratura", "sextil"];

/**
 * Grados eclípticos absolutos (0–360) a partir de signo + grados + minutos + segundos.
 */
export function absoluteDegree(signId, degree = 0, minutes = 0, seconds = 0) {
  const signIdx = ZODIAC_SIGNS.findIndex((s) => s.id === signId);
  if (signIdx === -1) return 0;
  const deg = Math.max(0, Math.min(29, parseFloat(degree) || 0));
  const min = Math.max(0, Math.min(59, parseFloat(minutes) || 0)) / 60;
  const sec = Math.max(0, Math.min(59, parseFloat(seconds) || 0)) / 3600;
  return signIdx * 30 + deg + min + sec;
}

/** Distancia angular más corta entre dos longitudes (0–180). */
export function angularDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Longitud del Ascendente: cúspide de la casa 1 o, si no hay, el punto "ascendente". */
export function ascendantDegree(chart) {
  const c1 = (chart.houseCusps || []).find((h) => h.house === 1);
  const asc = (chart.planets || []).find((p) => p.planetId === "ascendente");
  if (asc) return absoluteDegree(asc.sign, asc.degree, asc.minutes, asc.seconds);
  if (c1) return absoluteDegree(c1.sign, c1.degree, c1.minutes, c1.seconds);
  return 0;
}

/** Casa en la que cae una longitud según las cúspides (1–12), o null. */
export function houseForDegree(deg, houseCusps = []) {
  if (houseCusps.length !== 12) return null;
  const cusps = [...houseCusps].sort((a, b) => a.house - b.house)
    .map((h) => absoluteDegree(h.sign, h.degree, h.minutes, h.seconds));
  for (let i = 0; i < 12; i++) {
    const start = cusps[i];
    const end = cusps[(i + 1) % 12];
    const span = (end - start + 360) % 360 || 360;
    if ((deg - start + 360) % 360 < span) return i + 1;
  }
  return null;
}

/**
 * Planetas de la carta con datos calculados: longitud, casa (la indicada o calculada), catálogo.
 * @returns {Array<{ id, name, symbol, sign, lon, house, retro, isAngle, raw }>}
 */
export function chartPoints(chart) {
  return (chart.planets || []).map((p) => {
    const cat = PLANETS_CATALOG.find((c) => c.id === p.planetId);
    if (!cat) return null;
    const lon = absoluteDegree(p.sign, p.degree, p.minutes, p.seconds);
    return {
      id: p.planetId,
      name: cat.name,
      symbol: cat.symbol,
      sign: p.sign,
      lon,
      house: Number(p.house) || houseForDegree(lon, chart.houseCusps),
      retro: Boolean(p.isRetrograde),
      isAngle: ANGLE_POINTS.includes(p.planetId),
      raw: p,
    };
  }).filter(Boolean);
}

/**
 * Calcula los aspectos entre todos los puntos de la carta.
 * @returns {Array<{ planet1Id, planet2Id, aspectId, orb, auto: true }>} ordenados por exactitud
 */
export function computeAspects(chart, { includeMinor = true } = {}) {
  const pts = chartPoints(chart);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i];
      const b = pts[j];
      // Nodo norte y sur siempre están en oposición; no aporta información
      if ([a.id, b.id].includes("nodo_norte") && [a.id, b.id].includes("nodo_sur")) continue;
      if (a.isAngle && b.isAngle) continue;
      if (GENERATIONAL.includes(a.id) && GENERATIONAL.includes(b.id)) continue;
      const minorPoint = MINOR_POINTS.includes(a.id) || MINOR_POINTS.includes(b.id);
      const withAngle = a.isAngle || b.isAngle;
      const dist = angularDistance(a.lon, b.lon);
      let best = null;
      for (const type of ASPECT_TYPES) {
        if (!includeMinor && !MAJOR_ASPECTS.includes(type.id)) continue;
        if (minorPoint && type.id !== "conjuncion") continue;
        if (withAngle && !["conjuncion", "oposicion"].includes(type.id)) continue;
        const bonus = MAJOR_ASPECTS.includes(type.id) && (LUMINARIES.includes(a.id) || LUMINARIES.includes(b.id)) ? 2 : 0;
        const maxOrb = minorPoint ? 3 : withAngle ? 5 : (ASPECT_ORBS[type.id] ?? 2) + bonus;
        const orb = Math.abs(dist - type.angle);
        if (orb <= maxOrb && (!best || orb < best.orb)) best = { type, orb };
      }
      if (best) out.push({ planet1Id: a.id, planet2Id: b.id, aspectId: best.type.id, orb: Math.round(best.orb * 100) / 100, auto: true });
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

/** Modo de aspectos: los cargados a mano mandan si existen, salvo que se elija "auto". */
export function aspectMode(chart) {
  if (chart.aspectMode === "auto" || chart.aspectMode === "manual") return chart.aspectMode;
  return (chart.aspects || []).length ? "manual" : "auto";
}

/** Aspectos que se muestran y usan: manuales o calculados según el modo. */
export function effectiveAspects(chart) {
  if (aspectMode(chart) === "manual") {
    const pts = chartPoints(chart);
    return (chart.aspects || []).map((asp) => {
      const a = pts.find((p) => p.id === asp.planet1Id);
      const b = pts.find((p) => p.id === asp.planet2Id);
      const type = ASPECT_TYPES.find((t) => t.id === asp.aspectId);
      const orb = a && b && type ? Math.abs(angularDistance(a.lon, b.lon) - type.angle) : null;
      return { ...asp, orb: orb == null ? null : Math.round(orb * 100) / 100 };
    });
  }
  return computeAspects(chart);
}

/** Planetas (no ejes) que están en una casa. */
export function planetsInHouse(chart, house) {
  return chartPoints(chart).filter((p) => !p.isAngle && p.house === house).map((p) => p.id);
}

/** Regente de una casa según el signo de su cúspide. */
export function houseRuler(chart, house) {
  const cusp = (chart.houseCusps || []).find((h) => h.house === house);
  return cusp ? SIGN_RULERS[cusp.sign] || null : null;
}

/** true si la carta tiene datos suficientes para usarse. */
export function hasChartData(chart) {
  return chartPoints(chart).filter((p) => !p.isAngle).length >= 3;
}

/**
 * Resumen compacto de la carta para el prompt (~150–200 tokens).
 * Ej: "☉ Acu 12° C9 · ☽ Pis 15° C10 · ... | AC Gém 5° · MC Acu 20° | ☉☍♂ · ☽□♃ ..."
 */
export function chartSummaryForPrompt(chart, { maxAspects = 6 } = {}) {
  const short = (signId) => (ZODIAC_SIGNS.find((s) => s.id === signId)?.name || signId).slice(0, 3);
  const pts = chartPoints(chart);
  const planets = pts.filter((p) => !p.isAngle)
    .map((p) => `${p.name} ${short(p.sign)} ${Math.floor(p.lon % 30)}°${p.house ? ` C${p.house}` : ""}${p.retro ? " R" : ""}`);
  const angles = pts.filter((p) => p.isAngle).map((p) => `${p.id === "ascendente" ? "AC" : "MC"} ${short(p.sign)} ${Math.floor(p.lon % 30)}°`);
  const aspects = effectiveAspects(chart)
    .filter((a) => MAJOR_ASPECTS.includes(a.aspectId))
    .slice(0, maxAspects)
    .map((a) => {
      const n1 = PLANETS_CATALOG.find((c) => c.id === a.planet1Id)?.name || a.planet1Id;
      const n2 = PLANETS_CATALOG.find((c) => c.id === a.planet2Id)?.name || a.planet2Id;
      const t = ASPECT_TYPES.find((x) => x.id === a.aspectId)?.name || a.aspectId;
      return `${n1} ${t.toLowerCase()} ${n2}`;
    });
  return [planets.join(" · "), angles.join(" · "), aspects.length ? `Aspectos: ${aspects.join("; ")}` : ""]
    .filter(Boolean).join("\n");
}

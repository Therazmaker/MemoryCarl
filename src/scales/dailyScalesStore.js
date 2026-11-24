/**
 * dailyScalesStore.js — Bitácora 1–10 del Home
 * MemoryCarl · Home › Bitácora
 *
 * localStorage "memorycarl_daily_scales_v1" = { days: { "YYYY-MM-DD": { energy, stress, ..., updatedAt } }, hidden: [] }
 * Sueño y Ánimo no se guardan aquí: salen del registro de sueño y de las caras del mood.
 * Se sube a Supabase como módulo "daily_scales" (app_modules) y se une por día (gana el más reciente).
 */

export const SCALES_KEY = "memorycarl_daily_scales_v1";

/** Las líneas del gráfico. auto = se calcula de otro registro (no se marca a mano). */
export const SCALE_SERIES = [
  { id: "sleep",  label: "Sueño",   icon: "🌙", color: "#8b7cf6", auto: true,  hint: "De tu registro de sueño (calidad ×2)" },
  { id: "mood",   label: "Ánimo",   icon: "😊", color: "#f472b6", auto: true,  hint: "Promedio de las caras del día" },
  { id: "energy", label: "Energía", icon: "⚡", color: "#22c55e", hint: "1 = arrastrándome · 10 = a tope" },
  { id: "stress", label: "Estrés",  icon: "😰", color: "#f97316", hint: "1 = en calma · 10 = a reventar" },
  { id: "focus",  label: "Enfoque", icon: "🎯", color: "#38bdf8", hint: "1 = disperso · 10 = en la zona" },
  { id: "food",   label: "Comida",  icon: "🍽️", color: "#eab308", hint: "Qué tan bien comí hoy" },
  { id: "water",  label: "Agua",    icon: "💧", color: "#60a5fa", hint: "Vasos de agua (10 o más = 10)" },
  { id: "body",   label: "Dolor",   icon: "🤕", color: "#ef4444", hint: "1 = nada · 10 = mucho dolor" },
];

const MANUAL_IDS = SCALE_SERIES.filter((s) => !s.auto).map((s) => s.id);

const empty = () => ({ days: {}, hidden: [] });

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SCALES_KEY) || "null");
    return {
      days: v?.days && typeof v.days === "object" ? v.days : {},
      hidden: Array.isArray(v?.hidden) ? v.hidden : [],
    };
  } catch (_e) { return empty(); }
};
const write = (d) => { try { localStorage.setItem(SCALES_KEY, JSON.stringify(d)); } catch (_e) {} };

export const loadScales = read;
export function saveScales(d) { write({ days: d.days || {}, hidden: d.hidden || [] }); }

const clamp10 = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(1, Math.min(10, Math.round(x * 10) / 10));
};

/** Guarda los valores marcados de un día (null o "" borra ese valor). */
export function setDayScales(iso, values) {
  const d = read();
  const cur = { ...(d.days[iso] || {}) };
  for (const id of MANUAL_IDS) {
    if (!(id in values)) continue;
    const v = values[id];
    if (v === null || v === "" || v === undefined) delete cur[id];
    else { const n = clamp10(v); if (n !== null) cur[id] = n; }
  }
  const before = d.days[iso] || {};
  const same = MANUAL_IDS.every((id) => (before[id] ?? null) === (cur[id] ?? null));
  if (same) return before;
  cur.updatedAt = new Date().toISOString();
  d.days[iso] = cur;
  write(d);
  return cur;
}

export function toggleHidden(id) {
  const d = read();
  d.hidden = d.hidden.includes(id) ? d.hidden.filter((x) => x !== id) : [...d.hidden, id];
  write(d);
  return d.hidden;
}

/** Sueño de un día en 1–10: calidad (1–5) ×2; sin calidad, por horas (8 h = 10). */
export function sleepScore(entries) {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return null;
  const withQ = list.filter((e) => Number(e.quality) > 0);
  if (withQ.length) return clamp10((withQ.reduce((s, e) => s + Number(e.quality), 0) / withQ.length) * 2);
  const mins = list.reduce((s, e) => s + (Number(e.totalMinutes) || 0), 0);
  if (mins <= 0) return null;
  return clamp10((mins / 60 / 8) * 10);
}

/** Ánimo de un día en 1–10: promedio del puntaje de cada cara registrada. */
export function moodScore(entries, scoreOf) {
  const scores = (entries || []).map((e) => scoreOf(e?.spriteId)).filter((n) => Number.isFinite(n) && n > 0);
  if (!scores.length) return null;
  return clamp10(scores.reduce((s, n) => s + n, 0) / scores.length);
}

/** Energía sacada de las caras (1–5 ×2), para cuando no la marcaste a mano. */
export function moodEnergy(entries) {
  const en = (entries || []).map((e) => Number(e?.energy)).filter((n) => n > 0);
  if (!en.length) return null;
  return clamp10((en.reduce((s, n) => s + n, 0) / en.length) * 2);
}

/**
 * Arma los valores de cada línea para una lista de días.
 * ctx = { sleepLog: [{date, quality, totalMinutes}], moodDaily: {iso: entry|entry[]}, moodScoreOf: (spriteId)=>number }
 * Devuelve { [seriesId]: Array<number|null> } en el mismo orden que isoDays.
 */
export function buildSeries(isoDays, ctx, store = read()) {
  const sleepBy = new Map();
  for (const e of ctx.sleepLog || []) {
    const k = String(e?.date || "").slice(0, 10);
    if (!k) continue;
    if (!sleepBy.has(k)) sleepBy.set(k, []);
    sleepBy.get(k).push(e);
  }
  const moodOf = (iso) => {
    const v = (ctx.moodDaily || {})[iso];
    return !v ? [] : Array.isArray(v) ? v : [v];
  };
  const out = {};
  for (const s of SCALE_SERIES) out[s.id] = [];
  for (const iso of isoDays) {
    const day = store.days[iso] || {};
    const moods = moodOf(iso);
    out.sleep.push(sleepScore(sleepBy.get(iso)));
    out.mood.push(moodScore(moods, ctx.moodScoreOf || (() => null)));
    for (const id of MANUAL_IDS) {
      let v = Number.isFinite(Number(day[id])) && day[id] !== null && day[id] !== "" ? Number(day[id]) : null;
      if (v === null && id === "energy") v = moodEnergy(moods);
      out[id].push(v);
    }
  }
  return out;
}

/** Payload para la nube (null si no hay nada: así no pisa la copia de la nube). */
export function scalesPayload() {
  const d = read();
  if (!Object.keys(d.days).length && !d.hidden.length) return null;
  return d;
}

/** Une lo de la nube con lo local por día (gana el más reciente). */
export function mergeScales(local, cloud) {
  const days = { ...(local?.days || {}) };
  let changed = false;
  for (const [iso, v] of Object.entries(cloud?.days || {})) {
    if (!v || typeof v !== "object") continue;
    const cur = days[iso];
    if (!cur || String(v.updatedAt || "") > String(cur.updatedAt || "")) { days[iso] = v; changed = true; }
  }
  const hidden = Array.isArray(local?.hidden) ? local.hidden : [];
  return { days, hidden, changed };
}

/**
 * Rellena los días vacíos con el promedio de los días que sí tienen dato,
 * para que la línea no quede cortada. Los días después de hoy (resto del mes) también.
 * Devuelve { values, est, avg } — est[i] = true si ese punto es estimado. Sin ningún dato: avg = null.
 */
export function fillWithAverage(values, todayIdx = values.length - 1) {
  const real = values.filter((v, i) => v !== null && v !== undefined && i <= todayIdx);
  if (!real.length) return { values: values.map(() => null), est: values.map(() => false), avg: null };
  const avg = Math.round((real.reduce((s, v) => s + v, 0) / real.length) * 10) / 10;
  const est = values.map((v, i) => i > todayIdx || v === null || v === undefined);
  return { values: values.map((v, i) => (est[i] ? avg : v)), est, avg };
}

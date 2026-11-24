/**
 * userStatusBlock.js — "Estado actual del usuario" para el prompt de NeuroChat
 * MemoryCarl / NeuroChat
 *
 * Lo que Carl sabe de cómo estás ahora: el último sueño, las caras de hoy y la Bitácora 1–10.
 * Todo con la fecha LOCAL (no la de Londres) y leyendo los campos que la app guarda de verdad:
 *   sleepLog:  [{ date: "YYYY-MM-DD", totalMinutes, quality: 1–5, start, end }]
 *   moodDaily: { "YYYY-MM-DD": [{ spriteId, label, energy: 1–5, activities, note, ts }] }  (o un solo objeto, formato viejo)
 */

import { todayLocalStr } from "./lifeDates.js";
import { SCALE_SERIES, loadScales } from "../scales/dailyScalesStore.js";

const FACE_LABEL = {
  incredible: "increíble", good: "bien", meh: "meh", bad: "mal", horrible: "horrible",
  happy: "feliz", pleased: "contento", confused: "confundido", sad: "triste", wtf: "WTF", angry: "enojado", irritated: "irritado",
};

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function shiftDay(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return todayLocalStr(new Date(y, m - 1, d + days, 12));
}

function hourLabel(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** El último sueño registrado (suma las siestas/tramos de ese mismo día). */
export function lastSleepLine(sleepLog, today) {
  const list = (Array.isArray(sleepLog) ? sleepLog : [])
    .map((e) => ({
      date: String(e?.date || "").slice(0, 10),
      minutes: Number(e?.totalMinutes ?? e?.total_minutes ?? 0) || 0,
      quality: Number(e?.quality) > 0 ? Number(e.quality) : null,
    }))
    .filter((e) => e.date && e.minutes > 0);
  if (!list.length) return null;
  const date = list.reduce((max, e) => (e.date > max ? e.date : max), "");
  const same = list.filter((e) => e.date === date);
  const minutes = same.reduce((s, e) => s + e.minutes, 0);
  const q = same.filter((e) => e.quality !== null);
  const quality = q.length ? Math.round((q.reduce((s, e) => s + e.quality, 0) / q.length) * 10) / 10 : null;
  const when = date === today ? "hoy" : date === shiftDay(today, -1) ? "ayer" : date;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `🌙 Último sueño registrado (${when}): ${h} h${m ? ` ${m} min` : ""}${quality !== null ? `, calidad ${fmtNum(quality)}/5` : ""}`;
}

/** Las caras de hoy, en orden, con hora y energía. */
export function moodTodayLine(moodDaily, today) {
  const raw = moodDaily && typeof moodDaily === "object" ? moodDaily[today] : null;
  const entries = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const parts = entries
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const label = String(e.label || FACE_LABEL[e.spriteId] || e.spriteId || "").trim();
      if (!label) return "";
      const hour = e.ts ? hourLabel(e.ts) : "";
      const energy = Number(e.energy) > 0 ? `, energía ${e.energy}/5` : "";
      return `${label}${hour ? ` (${hour}${energy})` : energy ? ` (${energy.slice(2)})` : ""}`;
    })
    .filter(Boolean);
  if (!parts.length) return null;
  return `😊 Ánimo hoy: ${parts.join(" → ")}`;
}

/**
 * La Bitácora 1–10 (lo que el usuario marca a mano): lo de hoy y el promedio de los últimos 7 días.
 * Sueño y ánimo no van aquí (ya salen arriba, de sus propios registros).
 */
export function scalesLines(store, today) {
  const days = store?.days && typeof store.days === "object" ? store.days : {};
  const manual = SCALE_SERIES.filter((s) => !s.auto);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, -i));
  const todayVals = [];
  const avgVals = [];
  for (const s of manual) {
    const t = Number(days[today]?.[s.id]);
    if (days[today]?.[s.id] != null && Number.isFinite(t)) todayVals.push(`${s.label.toLowerCase()} ${fmtNum(t)}`);
    const vals = week.map((d) => days[d]?.[s.id]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    if (vals.length >= 2) avgVals.push(`${s.label.toLowerCase()} ${fmtNum(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10)}`);
  }
  const out = [];
  if (todayVals.length) out.push(`📓 Bitácora de hoy (1–10): ${todayVals.join(", ")}`);
  if (avgVals.length) out.push(`📓 Bitácora, promedio últimos 7 días: ${avgVals.join(", ")}`);
  return out;
}

/**
 * Bloque completo para el prompt ("" si no hay nada).
 * @param {{ sleepLog?: any[], moodDaily?: object, scales?: object, now?: Date }} input
 */
export function buildUserStatusBlock({ sleepLog, moodDaily, scales, now = new Date() } = {}) {
  const today = todayLocalStr(now);
  const lines = [
    lastSleepLine(sleepLog, today),
    moodTodayLine(moodDaily, today),
    ...scalesLines(scales ?? loadScales(), today),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n\n## ESTADO ACTUAL DEL USUARIO\nEn la Bitácora, estrés y dolor: más alto = peor. Energía, enfoque, comida y agua: más alto = mejor.\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

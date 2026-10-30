/**
 * lifeDates.js — Fechas en hora local para la capa de continuidad (Ahora)
 * MemoryCarl / NeuroChat
 *
 * toISOString() devuelve la fecha UTC: en Perú, desde las 7 pm ya sería "mañana".
 * Estas utilidades usan siempre la fecha local del dispositivo.
 */

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Fecha local en formato YYYY-MM-DD.
 * @param {Date} [date]
 * @returns {string}
 */
export function todayLocalStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fecha de hoy en texto largo, para el prompt: "jueves 30 de octubre de 2026 (2026-10-30)".
 * @param {Date} [date]
 * @returns {string}
 */
export function todayLongStr(date = new Date()) {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()} (${todayLocalStr(date)})`;
}

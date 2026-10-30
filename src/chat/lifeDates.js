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

/**
 * Marca con `updatedAt` los elementos que cambiaron respecto a la versión guardada.
 * Sirve para fusionar con la copia de la nube sin perder los cambios más recientes.
 * @param {Array} next - lista a guardar (se modifica en el sitio)
 * @param {Array} prev - lista guardada anteriormente
 * @returns {Array} next
 */
export function stampUpdatedAt(next, prev = []) {
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  const before = new Map((Array.isArray(prev) ? prev : []).filter((x) => x?.id).map((x) => [x.id, strip(x)]));
  const now = new Date().toISOString();
  for (const item of next) {
    if (item?.id && before.get(item.id) !== strip(item)) item.updatedAt = now;
  }
  return next;
}

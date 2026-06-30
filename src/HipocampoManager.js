/**
 * HipocampoManager.js — Capa 2: El Hipocampo (Memoria Secuencial)
 *
 * Gestiona el buffer histórico de partidos y construye los tensores
 * secuenciales [ventanaTiempo, inputSize] que alimentan la capa LSTM
 * del BrainModel.
 *
 * Almacenamiento: usa chrome.storage.local cuando está disponible (extensión),
 * con fallback a localStorage para entornos web.
 */

import { BrainPreprocessor } from "./BrainPreprocessor.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Número de partidos hacia atrás que recuerda el Hipocampo (por defecto). */
export const VENTANA_TIEMPO_DEFAULT = 5;

/** Importancia por tipo de torneo — usada para detectar rotaciones estratégicas. */
export const IMPORTANCIA_TORNEO = {
  continental: 1.0,  // Champions / Europa / Libertadores
  league:      0.7,  // Liga doméstica
  cup:         0.3,  // Copa nacional (FA Cup, Copa del Rey…)
  friendly:    0.1,  // Amistoso
};

// ─── Utilidades de almacenamiento ─────────────────────────────────────────────

/**
 * Lee una clave del almacenamiento disponible.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function storageGet(key) {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => resolve(result[key]));
    });
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Escribe una clave en el almacenamiento disponible.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
async function storageSet(key, value) {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // silently ignore quota errors
  }
}

// ─── Preprocesado del historial ───────────────────────────────────────────────

/**
 * Aplica padding de ceros al historial para que siempre tenga exactamente
 * `ventanaTiempo` entradas. Los partidos más recientes se colocan al final.
 *
 * @param {number[][]} vectores — Array de vectores de estado (más antiguo primero)
 * @param {number} inputSize
 * @param {number} ventanaTiempo
 * @returns {number[][]} Array de longitud `ventanaTiempo`
 */
export function aplicarPadding(vectores, inputSize, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  const ceroVector = Array(inputSize).fill(0);
  const recortado  = vectores.slice(-ventanaTiempo);
  const padding    = ventanaTiempo - recortado.length;
  return [...Array(padding).fill(ceroVector), ...recortado];
}

/**
 * Convierte un array de snapshots de partido (objetos con las mismas propiedades
 * que acepta `BrainPreprocessor.createStateVector`) en una secuencia de vectores
 * normalizados con padding.
 *
 * @param {object[]} snapshots — Snapshots en orden cronológico (más antiguo primero)
 * @param {number} [ventanaTiempo]
 * @returns {number[][]} Matriz [ventanaTiempo × inputSize]
 */
export function preprocesarHistorial(snapshots, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  const vectores = (snapshots || []).map((snap) =>
    BrainPreprocessor.createStateVector(snap)
  );
  const inputSize = BrainPreprocessor.getVectorLabels().length; // 9
  return aplicarPadding(vectores, inputSize, ventanaTiempo);
}

// ─── Análisis de racha ────────────────────────────────────────────────────────

/**
 * Detecta si el Pulse ha tenido una tendencia descendente (fatiga crónica).
 *
 * @param {object[]} snapshots — Snapshots ordenados del más antiguo al más reciente
 * @returns {boolean} `true` si el Pulse ha bajado de forma sostenida
 */
export function detectarDegradacionPulse(snapshots) {
  if (!snapshots || snapshots.length < 2) return false;
  const pulses = snapshots.map((s) => s.pulse ?? 50);
  // Al menos la mitad de los cambios consecutivos son negativos
  let bajadas = 0;
  for (let i = 1; i < pulses.length; i++) {
    if (pulses[i] < pulses[i - 1]) bajadas++;
  }
  return bajadas >= Math.ceil((pulses.length - 1) / 2);
}

/**
 * Calcula el "Score de Confianza" basado en la racha de resiliencia:
 * cuántos de los últimos partidos el equipo remontó (momentum positivo
 * después de un valor bajo de Pulse o resiliencia).
 *
 * @param {object[]} snapshots
 * @returns {number} Valor en [0, 1]
 */
export function calcularScoreConfianza(snapshots) {
  if (!snapshots || snapshots.length === 0) return 0.5;
  let remontadas = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const pulseBajo   = (prev.pulse ?? 50) < 50;
    const rebote      = (curr.pulse ?? 50) > (prev.pulse ?? 50);
    const momentumAlza = (curr.momentum ?? 0) > 0;
    if (pulseBajo && rebote && momentumAlza) remontadas++;
  }
  return Math.min(1, 0.5 + remontadas * 0.15);
}

/**
 * Detecta si el equipo rotó (jugó con suplentes) en torneos de baja
 * importancia recientemente, lo que implica que los titulares están frescos.
 *
 * @param {object[]} snapshots
 * @returns {boolean}
 */
export function detectarRotacionEstrategica(snapshots) {
  if (!snapshots || snapshots.length === 0) return false;
  // Busca si algún partido reciente tuvo baja importancia de torneo (<= 0.3)
  // y alta fatiga, lo que indica que se usó un equipo alternativo
  return snapshots.some(
    (s) => (s.importancia_torneo ?? 0.5) <= 0.3 && (s.fatiga ?? 50) >= 60
  );
}

/**
 * Genera un texto de insight sobre la tendencia del equipo basado en su historial.
 *
 * @param {object[]} snapshots
 * @returns {string}
 */
export function generarInsightTendencia(snapshots) {
  if (!snapshots || snapshots.length === 0) {
    return "Sin historial disponible.";
  }

  const degradacion  = detectarDegradacionPulse(snapshots);
  const confianza    = calcularScoreConfianza(snapshots);
  const rotacion     = detectarRotacionEstrategica(snapshots);

  const partes = [];

  if (degradacion) {
    partes.push("Fatiga física acumulada");
  } else {
    partes.push("Alza física");
  }

  if (confianza >= 0.65) {
    partes.push("racha psicológica positiva");
  } else if (confianza <= 0.4) {
    partes.push("racha psicológica negativa");
  }

  if (rotacion) {
    partes.push("titulares frescos (rotación estratégica detectada)");
  }

  return `Tendencia: ${partes.join(", ")}.`;
}

// ─── HipocampoManager ─────────────────────────────────────────────────────────

/**
 * Gestiona el historial de partidos de un equipo en el almacenamiento local.
 */
export class HipocampoManager {
  /**
   * Clave de almacenamiento para el historial de un equipo.
   * @param {string} equipoID
   * @returns {string}
   */
  static _storageKey(equipoID) {
    return `historial_${equipoID}`;
  }

  /**
   * Obtiene los últimos `ventanaTiempo` snapshots del equipo y los convierte
   * en una secuencia de vectores normalizados lista para la capa LSTM.
   *
   * @param {string} equipoID
   * @param {number} [ventanaTiempo]
   * @returns {Promise<{ secuencia: number[][], snapshots: object[], insight: string }>}
   */
  static async obtenerHistorial(equipoID, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
    const key      = HipocampoManager._storageKey(equipoID);
    const raw      = await storageGet(key);
    const snapshots = Array.isArray(raw) ? raw.slice(-ventanaTiempo) : [];
    const secuencia = preprocesarHistorial(snapshots, ventanaTiempo);
    const insight   = generarInsightTendencia(snapshots);
    return { secuencia, snapshots, insight };
  }

  /**
   * Persiste un nuevo snapshot de partido en el historial del equipo.
   * Mantiene como máximo `maxSnapshots` entradas (por defecto 10).
   *
   * @param {string} equipoID
   * @param {object} snapshot — Objeto con las mismas propiedades que acepta `BrainPreprocessor.createStateVector`
   * @param {number} [maxSnapshots=10]
   * @returns {Promise<void>}
   */
  static async guardarSnapshot(equipoID, snapshot, maxSnapshots = 10) {
    const key       = HipocampoManager._storageKey(equipoID);
    const raw       = await storageGet(key);
    const historial = Array.isArray(raw) ? raw : [];
    historial.push({ ...snapshot, timestamp: Date.now() });
    // Mantener solo los más recientes
    const recortado = historial.slice(-maxSnapshots);
    await storageSet(key, recortado);
  }

  /**
   * Borra el historial almacenado de un equipo.
   * @param {string} equipoID
   * @returns {Promise<void>}
   */
  static async limpiarHistorial(equipoID) {
    await storageSet(HipocampoManager._storageKey(equipoID), []);
  }

  /**
   * Extrae los valores de Pulse de los snapshots para usarlos en una
   * gráfica Sparkline (Momentum Tracker).
   *
   * @param {object[]} snapshots
   * @returns {number[]} Array de valores de Pulse (0-100)
   */
  static extraerSeriesPulse(snapshots) {
    return (snapshots || []).map((s) => s.pulse ?? 50);
  }
}

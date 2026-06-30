/**
 * BrainPreprocessor.js — Capa de Percepción (Data Ingestion)
 * Transforma estadísticas y texto de relatos en tensores normalizados
 * listos para ser procesados por BrainModel.js.
 */

// ─── Paso 1: Vector de Estado de Equipo ─────────────────────────────────────

export class BrainPreprocessor {
  /**
   * Normaliza un valor al rango [0, 1].
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  static normalize(value, min, max) {
    if (max === min) return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  }

  /**
   * Construye el vector de estado del equipo a partir de sus métricas.
   * Todas las componentes quedan normalizadas en [0, 1].
   *
   * @param {{
   *   pulse: number,          // 0-100  — Pulso psicológico del plantel
   *   fatiga: number,         // 0-100  — Carga física acumulada
   *   resiliencia: number,    // 0-100  — Factor psicológico de resiliencia
   *   agresividad?: number,   // 0-100  — Agresividad táctica
   *   volatilidad?: number,   // 0-100  — Volatilidad del rendimiento
   *   edadMedia?: number,     // 17-40  — Edad media del plantel
   *   importancia_torneo: number, // 0-1  — Importancia del torneo (FA Cup=0.1, UCL=1.0)
   *   diasDescanso?: number,  // 0-14  — Días de descanso desde último partido
   *   momentum: number,       // -1 a 1 — Tendencia de rendimiento reciente
   * }} data
   * @returns {number[]} Vector numérico normalizado listo para ser tensor
   */
  static createStateVector(data) {
    return [
      this.normalize(data.pulse,           0,  100),  // [0] Pulso de plantilla
      this.normalize(data.fatiga,          0,  100),  // [1] Carga física
      this.normalize(data.resiliencia,     0,  100),  // [2] Resiliencia psicológica
      this.normalize(data.agresividad ?? 50, 0, 100), // [3] Agresividad táctica
      this.normalize(data.volatilidad ?? 50, 0, 100), // [4] Volatilidad de rendimiento
      this.normalize(data.edadMedia ?? 26, 17,  40),  // [5] Edad media del plantel
      Math.min(1, Math.max(0, data.importancia_torneo ?? 0.5)), // [6] Importancia torneo
      this.normalize(data.diasDescanso ?? 3, 0,  14), // [7] Días de descanso
      this.normalize(data.momentum,        -1,   1),  // [8] Tendencia de rendimiento
    ];
  }

  /**
   * Devuelve los nombres de cada dimensión del vector de estado.
   * @returns {string[]}
   */
  static getVectorLabels() {
    return [
      "Pulse",
      "Fatiga",
      "Resiliencia",
      "Agresividad",
      "Volatilidad",
      "Edad Media",
      "Importancia Torneo",
      "Días Descanso",
      "Momentum",
    ];
  }
}

// ─── Paso 2: Traductor de Relatos (Mini-Cerebro NLP) ────────────────────────

/** Diccionario de palabras clave → delta de intensidad de juego */
export const RELATO_DICTIONARY = {
  "presión alta":    0.20,
  "presion alta":    0.20,
  "ritmo lento":    -0.10,
  "contraataque":    0.15,
  "rotación":       -0.30,
  "rotacion":       -0.30,
  "lesión":          0.10,
  "lesion":          0.10,
  "gol":             0.12,
  "penalti":         0.08,
  "expulsión":       0.15,
  "expulsion":       0.15,
  "tarjeta roja":    0.15,
  "tarjeta amarilla":0.05,
  "fuera de juego":  0.03,
  "remate":          0.06,
  "bloqueo":         0.04,
  "parada":          0.05,
  "disparo":         0.06,
  "falta":           0.04,
  "córner":          0.04,
  "corner":          0.04,
  "dominio":         0.08,
  "posesión":        0.05,
  "posesion":        0.05,
  "urgencia":        0.10,
  "empuje":          0.08,
  "calma":          -0.05,
  "tiempo muerto":  -0.08,
  "sustitución":    -0.05,
  "sustitucion":    -0.05,
};

/**
 * Analiza las líneas de un relato y devuelve un score de Intensidad de Juego.
 * @param {string[]} lineasRelato — Array de líneas del relato (ej. ["45' Gol de Mbappé", ...])
 * @returns {number} Score en [0, 1] donde 0.5 es intensidad neutra
 */
export function analizarRelato(lineasRelato) {
  let scoreIntensidad = 0.5; // Base neutra
  lineasRelato.forEach(linea => {
    const lineaLower = linea.toLowerCase();
    for (const [palabra, valor] of Object.entries(RELATO_DICTIONARY)) {
      if (lineaLower.includes(palabra)) {
        scoreIntensidad += valor;
      }
    }
  });
  return Math.min(Math.max(scoreIntensidad, 0), 1);
}

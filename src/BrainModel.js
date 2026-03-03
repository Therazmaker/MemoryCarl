/**
 * BrainModel.js — Capas de Percepción e Hipocampo
 * Construye y expone el modelo TensorFlow.js con:
 *   - Capa 1 (Percepción): capa densa que transforma un vector de estado.
 *   - Capa 2 (Hipocampo): capa LSTM que procesa la secuencia histórica de partidos.
 *
 * Requiere que @tensorflow/tfjs esté disponible como `tf` en el scope global
 * (cargado vía CDN en index.html) o como módulo importado.
 */

import { BrainPreprocessor, analizarRelato } from "./BrainPreprocessor.js";
import {
  HipocampoManager,
  preprocesarHistorial,
  aplicarPadding,
  detectarDegradacionPulse,
  calcularScoreConfianza,
  detectarRotacionEstrategica,
  generarInsightTendencia,
  VENTANA_TIEMPO_DEFAULT,
  IMPORTANCIA_TORNEO,
} from "./HipocampoManager.js";

// Re-export helpers so consumers can import from a single entry point
export {
  BrainPreprocessor,
  analizarRelato,
  HipocampoManager,
  preprocesarHistorial,
  aplicarPadding,
  detectarDegradacionPulse,
  calcularScoreConfianza,
  detectarRotacionEstrategica,
  generarInsightTendencia,
  VENTANA_TIEMPO_DEFAULT,
  IMPORTANCIA_TORNEO,
};

// ─── Paso 3: Capa de Entrada en TensorFlow.js ────────────────────────────────

/**
 * Crea el modelo secuencial con la Primera Capa (Percepción).
 * @param {number} [inputSize=9] — Tamaño del Vector de Estado
 * @returns {Promise<tf.Sequential>}
 */
export async function crearCapaEntrada(inputSize = 9) {
  if (typeof tf === "undefined") {
    throw new Error(
      "TensorFlow.js no está disponible. " +
      "Asegúrate de cargar https://cdn.jsdelivr.net/npm/@tensorflow/tfjs antes de usar BrainModel."
    );
  }

  const model = tf.sequential();

  // PRIMERA CAPA: Capa Densa de Percepción
  model.add(tf.layers.dense({
    inputShape:  [inputSize],
    units:       32,
    activation:  "relu",
    name:        "percepcion_inicial",
  }));

  console.log(
    `[BrainModel] Primera capa del cerebro lista. ` +
    `inputSize=${inputSize}, units=32, activation=relu`
  );
  return model;
}

// ─── Capa 2: Hipocampo (Memoria Secuencial) ───────────────────────────────────

/**
 * Añade la Capa 2 (Hipocampo) a un modelo secuencial existente de TensorFlow.js.
 * Esta capa LSTM procesa la secuencia histórica de partidos para detectar
 * tendencias de fatiga, rachas psicológicas y jerarquía de torneos.
 *
 * El tensor de entrada debe tener forma [ventanaTiempo, inputSize].
 *
 * @param {tf.Sequential} model — Modelo al que se añade la capa
 * @param {number} inputSize — Número de variables por partido (tamaño del vector de estado)
 * @param {number} [ventanaTiempo] — Número de partidos hacia atrás que recuerda el hipocampo
 * @returns {tf.Sequential} El mismo modelo con la Capa 2 añadida
 */
export function añadirCapaHipocampo(model, inputSize, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  // SEGUNDA CAPA: LSTM — Memoria Secuencial
  model.add(tf.layers.lstm({
    units:           64,               // "Neuronas" de memoria
    returnSequences: false,            // Solo nos interesa el resumen final de la racha
    inputShape:      [ventanaTiempo, inputSize],
    name:            "hipocampo_secuencial",
  }));

  // Capa de normalización para estabilizar el aprendizaje de la racha
  model.add(tf.layers.batchNormalization());

  console.log(
    `[BrainModel] Capa 2: Hipocampo (Memoria) integrada. ` +
    `ventanaTiempo=${ventanaTiempo}, inputSize=${inputSize}, units=64`
  );
  return model;
}

/**
 * Construye el modelo completo con ambas capas:
 *   Capa 1 — Percepción (Dense 32, relu)
 *   Capa 2 — Hipocampo (LSTM 64 + BatchNorm)
 *
 * La entrada es una secuencia de `ventanaTiempo` vectores de estado de tamaño `inputSize`.
 * Internamente se aplana la salida del LSTM y se pasa por la capa Densa.
 *
 * @param {number} [inputSize=9]
 * @param {number} [ventanaTiempo]
 * @returns {Promise<tf.Sequential>}
 */
export async function crearModeloCompleto(inputSize = 9, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  if (typeof tf === "undefined") {
    throw new Error(
      "TensorFlow.js no está disponible. " +
      "Asegúrate de cargar https://cdn.jsdelivr.net/npm/@tensorflow/tfjs antes de usar BrainModel."
    );
  }

  const model = tf.sequential();

  // CAPA 2: Hipocampo — la LSTM acepta directamente la secuencia de vectores de estado
  añadirCapaHipocampo(model, inputSize, ventanaTiempo);

  // CAPA 1: Percepción — proyecta la representación del hipocampo (64 unidades) a 32
  model.add(tf.layers.dense({
    units:      32,
    activation: "relu",
    name:       "percepcion_inicial",
  }));

  console.log(
    `[BrainModel] Modelo completo listo. ` +
    `ventanaTiempo=${ventanaTiempo}, inputSize=${inputSize}`
  );
  return model;
}

// ─── API de conveniencia ─────────────────────────────────────────────────────

/**
 * Pipeline completo: datos de equipo + relato → tensor de entrada.
 *
 * @param {{
 *   pulse: number, fatiga: number, resiliencia: number,
 *   agresividad?: number, volatilidad?: number, edadMedia?: number,
 *   importancia_torneo: number, diasDescanso?: number, momentum: number
 * }} teamData
 * @param {string[]} [lineasRelato=[]] — Líneas del relato del partido
 * @returns {{ vector: number[], intensidad: number, tensor: tf.Tensor2D }}
 */
export function buildInputTensor(teamData, lineasRelato = []) {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  const intensidad  = analizarRelato(lineasRelato);
  const baseVector  = BrainPreprocessor.createStateVector(teamData);

  // Blend momentum (index 8 in state vector) with relato intensity
  const vector = [...baseVector];
  vector[8] = Math.min(1, Math.max(0, (vector[8] + intensidad) / 2));

  const tensor = tf.tensor2d([vector]);
  return { vector, intensidad, tensor };
}

/**
 * Pipeline secuencial: historial de partidos → tensor 3D para la capa LSTM.
 *
 * @param {object[]} snapshots — Array de snapshots en orden cronológico (más antiguo primero)
 * @param {number} [ventanaTiempo]
 * @returns {{ secuencia: number[][], insight: string, tensor: tf.Tensor3D }}
 */
export function buildSequenceTensor(snapshots, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  const secuencia = preprocesarHistorial(snapshots, ventanaTiempo);
  const insight   = generarInsightTendencia(snapshots);
  const tensor    = tf.tensor3d([secuencia]); // shape: [1, ventanaTiempo, inputSize]
  return { secuencia, insight, tensor };
}

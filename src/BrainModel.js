/**
 * BrainModel.js — Primera Capa: Capa de Percepción
 * Construye y expone el modelo TensorFlow.js con la capa densa inicial
 * que transforma vectores de estado en representaciones internas.
 *
 * Requiere que @tensorflow/tfjs esté disponible como `tf` en el scope global
 * (cargado vía CDN en index.html) o como módulo importado.
 */

import { BrainPreprocessor, analizarRelato } from "./BrainPreprocessor.js";

// Re-export helpers so consumers can import from a single entry point
export { BrainPreprocessor, analizarRelato };

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

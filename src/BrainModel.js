/**
 * BrainModel.js — Capas de Percepción, Hipocampo y Córtex Prefrontal
 * Construye y expone el modelo TensorFlow.js con:
 *   - Capa 1 (Percepción): capa densa que transforma un vector de estado.
 *   - Capa 2 (Hipocampo): capa LSTM que procesa la secuencia histórica de partidos.
 *   - Capa 3 (Córtex Prefrontal): capas densas con Dropout para la decisión final.
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

// ─── Capa 3: Córtex Prefrontal (Decisión) ────────────────────────────────────

/**
 * Añade la Capa 3 (Córtex Prefrontal) a un modelo secuencial existente.
 * Esta capa densa realiza la fusión de toda la información y emite una
 * predicción final de 3 clases: [P(Victoria), P(Empate), P(Derrota)].
 *
 * Usa Dropout (20%) para que el cerebro sea flexible y no se obsesione
 * con un solo dato. L2 regularization en la capa de integración evita
 * el sobreajuste a rachas cortas.
 *
 * @param {tf.Sequential} model — Modelo al que se añade la capa
 * @returns {tf.Sequential} El mismo modelo con la Capa 3 añadida
 */
export function añadirCortexPrefrontal(model) {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  // Capa de integración (Fusión de ideas)
  model.add(tf.layers.dense({
    units: 128,
    activation: "relu",
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
  }));

  // Dropout del 20% para asegurar que el cerebro sea "flexible"
  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(tf.layers.dense({
    units: 64,
    activation: "relu",
  }));

  // CAPA DE SALIDA: probabilidades que suman 100%
  // Salida: [Prob. Victoria, Prob. Empate, Prob. Derrota]
  model.add(tf.layers.dense({
    units: 3,
    activation: "softmax",
    name: "decision_final",
  }));

  console.log("Capa 3: Córtex Prefrontal (Decisión) activo.");
  return model;
}

/**
 * Construye el cerebro completo (Capas 1 + 2 + 3) y lo compila listo para
 * entrenamiento o inferencia.
 *
 * Arquitectura:
 *   Capa 2 — Hipocampo (LSTM 64 + BatchNorm)       ← memoria secuencial
 *   Capa 1 — Percepción (Dense 32, relu)            ← extracción de estado actual
 *   Capa 3 — Córtex Prefrontal (Dense 128 → Dropout → Dense 64 → Softmax 3)
 *
 * @param {number} [inputSize=9]   — Número de variables por partido
 * @param {number} [ventanaTiempo] — Partidos hacia atrás que recuerda el Hipocampo
 * @returns {Promise<tf.Sequential>} Modelo compilado
 */
export async function crearCerebroCompleto(inputSize = 9, ventanaTiempo = VENTANA_TIEMPO_DEFAULT) {
  if (typeof tf === "undefined") {
    throw new Error(
      "TensorFlow.js no está disponible. " +
      "Asegúrate de cargar https://cdn.jsdelivr.net/npm/@tensorflow/tfjs antes de usar BrainModel."
    );
  }

  const cerebro = tf.sequential();

  // Capa 2: Hipocampo — la LSTM acepta directamente la secuencia de vectores de estado
  añadirCapaHipocampo(cerebro, inputSize, ventanaTiempo);

  // Capa 1: Percepción — proyecta la representación del hipocampo (64 unidades) a 32
  cerebro.add(tf.layers.dense({
    units:      32,
    activation: "relu",
    name:       "percepcion_inicial",
  }));

  // Capa 3: Córtex Prefrontal — fusión y decisión final
  añadirCortexPrefrontal(cerebro);

  cerebro.compile({
    optimizer: tf.train.adam(0.001),
    loss:      "categoricalCrossentropy",
    metrics:   ["accuracy"],
  });

  console.log(
    `[BrainModel] Cerebro completo compilado. ` +
    `ventanaTiempo=${ventanaTiempo}, inputSize=${inputSize}`
  );
  return cerebro;
}

// ─── Intuition Gauge (Medidor de Intuición) ───────────────────────────────────

/**
 * Aplica el "Criterio de Importancia" sobre la predicción bruta del modelo y
 * devuelve el veredicto final con su nivel de confianza y modo de juego.
 *
 * Lógica de penalización:
 *   Si hay degradación de Pulse (fatiga crónica) Y el próximo torneo es de alta
 *   importancia (>= 0.7), el Córtex baja la probabilidad de victoria y sube la
 *   de empate, prediciendo un juego de baja intensidad ("Modo Ahorro").
 *
 * @param {number[]} prediccion     — [pVictoria, pEmpate, pDerrota] del modelo (suman 1)
 * @param {object[]} snapshots      — Historial de partidos (más antiguo primero)
 * @param {string|null} [proximoTorneo=null] — Tipo del próximo torneo:
 *   "continental" | "league" | "cup" | "friendly"
 * @returns {{
 *   prediccion: number[],
 *   modoAhorro: boolean,
 *   confianza: number,
 *   etiqueta: string
 * }}
 */
export function calcularIntuitionGauge(prediccion, snapshots, proximoTorneo = null) {
  const degradacion      = detectarDegradacionPulse(snapshots);
  const confianzaBase    = calcularScoreConfianza(snapshots);
  const importanciaProx  = proximoTorneo != null
    ? (IMPORTANCIA_TORNEO[proximoTorneo] ?? 0.5)
    : 0.5;

  let ajustada    = [...prediccion];
  let modoAhorro  = false;

  // Penalización: fatiga crónica + partido de alto riesgo próximo
  if (degradacion && importanciaProx >= 0.7) {
    modoAhorro = true;
    ajustada[0] = Math.max(0, ajustada[0] - 0.15); // baja probabilidad de victoria
    ajustada[1] = Math.min(1, ajustada[1] + 0.15); // sube probabilidad de empate
    // Re-normalizar para que sumen 1
    const suma = ajustada.reduce((a, b) => a + b, 0);
    if (suma > 0) ajustada = ajustada.map((p) => p / suma);
  }

  // Confianza: claridad de la predicción ponderada por la racha psicológica
  const confianza = Math.round(Math.max(...ajustada) * confianzaBase * 100);

  return {
    prediccion: ajustada,
    modoAhorro,
    confianza,
    etiqueta: modoAhorro ? "⚠️ Modo Ahorro" : "✅ Máxima Intensidad",
  };
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

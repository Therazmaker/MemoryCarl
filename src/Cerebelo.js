/**
 * Cerebelo.js — Capa de Refinamiento y Módulo de Feedback
 *
 * El Cerebelo actúa como un mecanismo de "Puerta de Verificación" (Gating)
 * entre la predicción del Córtex Prefrontal (Capa 3) y el resultado del
 * Simulador Estadístico.  Cuando ambas fuentes discrepan por encima del
 * umbral de error, el Cerebelo suaviza la predicción final, baja la confianza
 * y clasifica la causa de la discrepancia (ruido aleatorio vs. fallo lógico).
 *
 * Semáforo de Coherencia:
 *   🟢 Verde  — IA y Simulador coinciden. Predicción sólida.
 *   🟡 Amarillo — Discrepancia moderada (fatiga / prioridad de torneo).
 *   🔴 Rojo   — Discrepancia total. Posible noticia de última hora.
 */

/** Umbral por defecto para considerar que existe una discrepancia significativa. */
export const UMBRAL_ERROR_DEFAULT = 0.2;

/**
 * Clasifica si una discrepancia se debe a ruido aleatorio o a un fallo lógico.
 *
 * Criterio heurístico:
 *   - Si la diferencia máxima supera 2× el umbral → fallo lógico (marca para
 *     que el Hipocampo le dé más peso en el futuro).
 *   - Si la diferencia está entre 1× y 2× el umbral → ruido aleatorio (el
 *     partido no debe usarse como ejemplo de aprendizaje).
 *
 * @param {number} maxDiferencia — Diferencia absoluta máxima entre la predicción de la IA y el resultado del Simulador
 * @param {number} umbral        — Umbral de error configurado
 * @returns {"logico" | "ruido" | "ninguno"}
 */
export function clasificarDiscrepancia(maxDiferencia, umbral) {
  if (maxDiferencia > umbral * 2) return "logico";
  if (maxDiferencia > umbral)     return "ruido";
  return "ninguno";
}

/**
 * Devuelve el semáforo de coherencia en función del tipo de discrepancia y
 * del flag de modo-ahorro que puede proceder del IntuitionGauge.
 *
 * @param {"logico" | "ruido" | "ninguno"} tipoDiscrepancia
 * @param {boolean} [modoAhorro=false]
 * @returns {{ color: "verde" | "amarillo" | "rojo", emoji: string, mensaje: string }}
 */
export function calcularSemaforo(tipoDiscrepancia, modoAhorro = false) {
  if (tipoDiscrepancia === "logico") {
    return {
      color:   "rojo",
      emoji:   "🔴",
      mensaje: "Discrepancia total. El Cerebelo sugiere revisar si hubo una noticia de última hora (lesión o rotación masiva).",
    };
  }
  if (tipoDiscrepancia === "ruido" || modoAhorro) {
    return {
      color:   "amarillo",
      emoji:   "🟡",
      mensaje: "La IA detecta cansancio/prioridad que el simulador ignora. Confianza moderada.",
    };
  }
  return {
    color:   "verde",
    emoji:   "🟢",
    mensaje: "IA y Simulador coinciden. Predicción sólida.",
  };
}

/**
 * Clase principal del Cerebelo.
 *
 * @example
 * const cerebelo = new Cerebelo();
 * const veredicto = cerebelo.refinar([0.7, 0.2, 0.1], [0.3, 0.4, 0.3]);
 * console.log(veredicto);
 */
export class Cerebelo {
  /**
   * @param {number} [umbralError] — Discrepancia máxima permitida por componente
   *   antes de activar el ajuste de suavizado.  Valor por defecto: 0.2.
   */
  constructor(umbralError = UMBRAL_ERROR_DEFAULT) {
    this.umbralError = umbralError;
  }

  /**
   * Refina la predicción del Córtex con el resultado del Simulador.
   *
   * @param {number[]} prediccionIA        — [P(Victoria), P(Empate), P(Derrota)] del Córtex
   * @param {number[]} resultadoSimulador  — [P(Victoria), P(Empate), P(Derrota)] del Simulador
   * @param {boolean}  [modoAhorro=false]  — Flag procedente del IntuitionGauge
   * @returns {{
   *   resultadoFinal:    number[],
   *   alertaAnomalia:    boolean,
   *   confianza:         string,
   *   tipoDiscrepancia:  "logico" | "ruido" | "ninguno",
   *   semaforo:          { color: string, emoji: string, mensaje: string },
   *   marcarParaAprendizaje: boolean
   * }}
   */
  refinar(prediccionIA, resultadoSimulador, modoAhorro = false) {
    if (!Array.isArray(prediccionIA) || !Array.isArray(resultadoSimulador)) {
      throw new TypeError("prediccionIA y resultadoSimulador deben ser arrays.");
    }
    if (prediccionIA.length !== resultadoSimulador.length) {
      throw new RangeError("prediccionIA y resultadoSimulador deben tener la misma longitud.");
    }

    const ajuste            = [];
    let   anomaliaDetectada = false;
    let   maxDiferencia     = 0;

    for (let i = 0; i < prediccionIA.length; i++) {
      const diferencia = Math.abs(prediccionIA[i] - resultadoSimulador[i]);
      if (diferencia > maxDiferencia) maxDiferencia = diferencia;

      if (diferencia > this.umbralError) {
        anomaliaDetectada = true;
        // Suavizado: punto medio entre la IA y el simulador
        ajuste[i] = (prediccionIA[i] + resultadoSimulador[i]) / 2;
      } else {
        ajuste[i] = prediccionIA[i];
      }
    }

    const tipoDiscrepancia = clasificarDiscrepancia(maxDiferencia, this.umbralError);
    const semaforo         = calcularSemaforo(tipoDiscrepancia, modoAhorro);

    // ── Filtro de Ruido (Backpropagation Interno) ─────────────────────────────
    // "logico"  → el Hipocampo debe darle más peso a este partido
    // "ruido"   → evento aleatorio, NO debe usarse para entrenar
    // "ninguno" → datos coherentes, uso normal
    const marcarParaAprendizaje = tipoDiscrepancia === "logico";

    return {
      resultadoFinal:        ajuste,
      alertaAnomalia:        anomaliaDetectada,
      confianza:             anomaliaDetectada ? "Baja (Discrepancia detectada)" : "Alta",
      tipoDiscrepancia,
      semaforo,
      marcarParaAprendizaje,
    };
  }
}

export default Cerebelo;

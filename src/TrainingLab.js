/**
 * TrainingLab.js — Sala de Entrenamiento
 *
 * Convierte el historial de partidos en tensores TensorFlow.js, ejecuta el
 * ciclo de entrenamiento del cerebro en lotes y guarda el modelo resultante
 * en localStorage para que persista entre sesiones del navegador/extensión.
 *
 * Requiere que @tensorflow/tfjs esté disponible como `tf` en el scope global
 * (cargado vía CDN en index.html) o como módulo importado.
 */

// ─── Paso 1: Preparación de Tensores (X e Y) ─────────────────────────────────

/**
 * Convierte el historial de partidos en tensores de entrada (xs) y salida (ys)
 * listos para ser usados por `model.fit()`.
 *
 * @param {Array<{vectorEstado: number[][], resultadoCategorico: number[]}>} historialPartidos
 *   Array de partidos.  Cada elemento debe tener:
 *   - `vectorEstado`        — Matriz [ventana_tiempo × numero_metricas] (Capa 1 y 2)
 *   - `resultadoCategorico` — One-hot [1,0,0] Victoria | [0,1,0] Empate | [0,0,1] Derrota
 * @returns {{ xs: tf.Tensor3D, ys: tf.Tensor2D }}
 */
export function prepararDataset(historialPartidos) {
  if (typeof tf === "undefined") {
    throw new Error(
      "TensorFlow.js no está disponible. " +
      "Asegúrate de cargar https://cdn.jsdelivr.net/npm/@tensorflow/tfjs antes de usar TrainingLab."
    );
  }
  if (!Array.isArray(historialPartidos) || historialPartidos.length === 0) {
    throw new Error("historialPartidos debe ser un array no vacío.");
  }

  return tf.tidy(() => {
    const inputs  = [];
    const outputs = [];

    historialPartidos.forEach(partido => {
      // X: El vector que creamos en la Capa 1 y 2
      // Debe tener forma [ventana_tiempo, numero_metricas]
      inputs.push(partido.vectorEstado);

      // Y: El resultado real que queremos que aprenda (One-hot encoding)
      // [1, 0, 0] = Victoria, [0, 1, 0] = Empate, [0, 0, 1] = Derrota
      outputs.push(partido.resultadoCategorico);
    });

    return {
      xs: tf.tensor3d(inputs),  // Tensor 3D para la memoria LSTM
      ys: tf.tensor2d(outputs), // Tensor 2D para la decisión final
    };
  });
}

// ─── Paso 3: Ciclo de Entrenamiento ──────────────────────────────────────────

/**
 * Ejecuta el ciclo de entrenamiento del modelo con los hiperparámetros de la
 * Sala de Entrenamiento:
 *   - epochs: 100
 *   - batchSize: 16
 *   - shuffle: true   (mezcla los partidos para evitar aprender el orden cronológico)
 *   - validationSplit: 0.15 (15 % de partidos para el "examen sorpresa")
 *
 * El progreso se imprime en la consola al final de cada epoch.
 *
 * @param {tf.LayersModel}  modelo    — El cerebro compilado (crearCerebroCompleto)
 * @param {Array<{vectorEstado: number[][], resultadoCategorico: number[]}>} historial
 * @returns {Promise<tf.History>}
 */
export async function ejecutarEntrenamiento(modelo, historial) {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  const { xs, ys } = prepararDataset(historial);

  console.log("🧠 Sala de Entrenamiento: Iniciando aprendizaje...");

  const infoEntrenamiento = await modelo.fit(xs, ys, {
    epochs:          100,
    batchSize:       16,
    shuffle:         true,
    validationSplit: 0.15,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        // Esto lo verás en la consola de la extensión
        console.log(
          `Paso ${epoch + 1}: Error = ${logs.loss.toFixed(4)} | ` +
          `Precisión = ${(logs.acc ?? logs.accuracy ?? 0).toFixed(4)}`
        );
      },
      onTrainEnd: () => {
        console.log("✅ Entrenamiento completado. El cerebro ha evolucionado.");
      },
    },
  });

  // Limpieza de memoria para no saturar la extensión
  xs.dispose();
  ys.dispose();

  return infoEntrenamiento;
}

// ─── Paso 4: Guardado de la "Sabiduría" ──────────────────────────────────────

/**
 * Guarda el modelo entrenado en localStorage para que el cerebro no olvide
 * lo aprendido al cerrar el navegador o la pestaña de FútbolLab.
 *
 * @param {tf.LayersModel} modelo
 * @param {string} [clave='localstorage://futbollab-brain-v1']
 * @returns {Promise<void>}
 */
export async function guardarProgreso(modelo, clave = "localstorage://futbollab-brain-v1") {
  if (typeof tf === "undefined") {
    throw new Error("TensorFlow.js no disponible.");
  }

  await modelo.save(clave);
  console.log("💾 Conocimiento guardado en el almacenamiento local.");
}

// ─── Paso 5: Trigger de UI ────────────────────────────────────────────────────

/**
 * Punto de entrada principal para el botón "Entrenar" de la UI de FútbolLab.
 *
 * Flujo:
 *  1. Bloquea las predicciones mientras entrena.
 *  2. Carga el historial desde la fuente indicada.
 *  3. Ejecuta `ejecutarEntrenamiento()`.
 *  4. Guarda el modelo actualizado.
 *  5. Notifica el resultado y desbloquea las predicciones.
 *
 * @param {{
 *   modelo:          tf.LayersModel,
 *   cargarHistorial: () => Promise<Array<{vectorEstado: number[][], resultadoCategorico: number[]}>>,
 *   onBloquear?:     () => void,
 *   onDesbloquear?:  () => void,
 *   onNotificar?:    (mensaje: string) => void,
 *   claveGuardado?:  string
 * }} opciones
 * @returns {Promise<tf.History>}
 */
export async function entrenarDesdeUI({
  modelo,
  cargarHistorial,
  onBloquear     = () => {},
  onDesbloquear  = () => {},
  onNotificar    = (msg) => console.log(msg),
  claveGuardado  = "localstorage://futbollab-brain-v1",
} = {}) {
  if (!modelo) {
    throw new Error("entrenarDesdeUI: 'modelo' es requerido.");
  }
  if (typeof cargarHistorial !== "function") {
    throw new Error("entrenarDesdeUI: 'cargarHistorial' debe ser una función.");
  }
  // 1. Bloquear predicciones: el cerebro está ocupado
  onBloquear();

  try {
    // 2. Cargar historial desde la base de datos
    const historial = await cargarHistorial();

    // 3. Ejecutar el entrenamiento
    const infoEntrenamiento = await ejecutarEntrenamiento(modelo, historial);

    // 4. Guardar el modelo actualizado
    await guardarProgreso(modelo, claveGuardado);

    // 5. Notificar al usuario
    onNotificar(
      `🧠 Cerebro actualizado con los últimos ${historial.length} partidos.`
    );

    return infoEntrenamiento;
  } finally {
    // Siempre desbloquear, incluso si ocurre un error
    onDesbloquear();
  }
}

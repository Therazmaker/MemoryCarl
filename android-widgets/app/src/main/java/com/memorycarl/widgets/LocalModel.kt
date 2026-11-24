package com.memorycarl.widgets

import android.content.Context
import android.net.Uri
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.File

/**
 * El modelo que corre dentro del teléfono (Gemma, archivo .task de MediaPipe / LiteRT).
 * No es el cerebro de Carl: solo ordena y propone. La palabra final la tiene Claude.
 *
 * El archivo lo eliges tú una vez (lo bajas de Hugging Face o Kaggle) y se copia a la carpeta
 * privada de la app. Nada sale del teléfono.
 */
object LocalModel {
    private const val MIN_BYTES = 50L * 1024 * 1024

    fun file(ctx: Context): File = File(File(ctx.filesDir, "models"), "model.task")
    fun isReady(ctx: Context): Boolean = file(ctx).let { it.exists() && it.length() > MIN_BYTES }
    fun name(ctx: Context): String = ctx.getSharedPreferences("mc_widgets", Context.MODE_PRIVATE).getString("modelName", "") ?: ""

    fun sizeLabel(ctx: Context): String {
        val mb = file(ctx).length() / (1024 * 1024)
        return if (mb >= 1024) String.format(java.util.Locale.US, "%.1f GB", mb / 1024.0) else "$mb MB"
    }

    /** Copia el archivo elegido (con avance en %). Lanza error si no parece un modelo. */
    fun importFrom(ctx: Context, uri: Uri, displayName: String, onProgress: (Int) -> Unit) {
        val total = try {
            ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        } catch (e: Exception) {
            -1L
        }
        val dir = File(ctx.filesDir, "models").apply { mkdirs() }
        val tmp = File(dir, "model.task.part")
        ctx.contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { out ->
                val buf = ByteArray(1 shl 20)
                var copied = 0L
                var lastPct = -1
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    copied += n
                    if (total > 0) {
                        val pct = (copied * 100 / total).toInt()
                        if (pct != lastPct) { lastPct = pct; onProgress(pct) }
                    }
                }
            }
        } ?: error("No pude abrir el archivo")
        if (tmp.length() < MIN_BYTES) {
            tmp.delete()
            error("Ese archivo es muy chico para ser un modelo (¿elegiste el .task?)")
        }
        close()
        val dest = file(ctx)
        dest.delete()
        if (!tmp.renameTo(dest)) error("No pude guardar el modelo")
        ctx.getSharedPreferences("mc_widgets", Context.MODE_PRIVATE).edit().putString("modelName", displayName).apply()
    }

    fun delete(ctx: Context) {
        close()
        file(ctx).delete()
        ctx.getSharedPreferences("mc_widgets", Context.MODE_PRIVATE).edit().remove("modelName").apply()
    }

    // El modelo cargado se reusa mientras la app esté abierta (cargarlo tarda unos segundos)
    private var engine: LlmInference? = null

    @Synchronized
    private fun engine(ctx: Context): LlmInference {
        engine?.let { return it }
        val opts = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(file(ctx).absolutePath)
            .setMaxTokens(1536)
            .build()
        return LlmInference.createFromOptions(ctx.applicationContext, opts).also { engine = it }
    }

    /** Pregunta al modelo y devuelve el texto completo. Correr fuera del hilo de la pantalla. */
    @Synchronized
    fun generate(ctx: Context, prompt: String): String {
        if (!isReady(ctx)) error("No hay modelo")
        val llm = engine(ctx)
        // Temperatura baja: para ordenar datos conviene que no improvise
        val sessionOpts = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTemperature(0.2f)
            .setTopK(20)
            .build()
        val session = LlmInferenceSession.createFromOptions(llm, sessionOpts)
        return try {
            session.addQueryChunk(prompt)
            session.generateResponse()
        } finally {
            session.close()
        }
    }

    @Synchronized
    fun close() {
        try { engine?.close() } catch (_: Exception) {}
        engine = null
    }
}

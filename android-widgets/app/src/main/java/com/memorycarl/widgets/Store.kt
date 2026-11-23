package com.memorycarl.widgets

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Una tarea tal como la muestran los widgets y las notificaciones. */
data class TaskInfo(val id: String, val text: String, val remindAt: Long?, val stepsDone: Int, val stepsTotal: Int)

/**
 * Lo que la app guarda en el teléfono:
 * - la configuración (la API key va cifrada),
 * - la cola de registros por enviar (si no hay internet, esperan aquí),
 * - el último resumen que publicó MemoryCarl,
 * - lo que se hizo desde aquí y MemoryCarl todavía no aplicó (para mostrarlo ya).
 */
object Store {
    const val DEFAULT_URL = "https://memory-carl.vercel.app"
    private const val PLAIN = "mc_widgets"
    private const val SECRET = "mc_widgets_secret"
    private var secretPrefs: SharedPreferences? = null

    private fun plain(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PLAIN, Context.MODE_PRIVATE)

    @Synchronized
    private fun secret(ctx: Context): SharedPreferences {
        secretPrefs?.let { return it }
        val p = try {
            val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            EncryptedSharedPreferences.create(
                SECRET, alias, ctx.applicationContext,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            // Algunos teléfonos fallan con el almacén de llaves: se guarda en privado igual
            ctx.applicationContext.getSharedPreferences("${SECRET}_fallback", Context.MODE_PRIVATE)
        }
        secretPrefs = p
        return p
    }

    // ---------------------------------------------------------------- configuración

    fun serverUrl(ctx: Context): String = plain(ctx).getString("url", DEFAULT_URL) ?: DEFAULT_URL
    fun apiKey(ctx: Context): String = secret(ctx).getString("key", "") ?: ""
    fun isConfigured(ctx: Context) = serverUrl(ctx).isNotBlank() && apiKey(ctx).isNotBlank()

    fun saveConfig(ctx: Context, url: String, key: String) {
        plain(ctx).edit().putString("url", url.trim().trimEnd('/')).apply()
        if (key.isNotBlank()) secret(ctx).edit().putString("key", key.trim()).apply()
    }

    fun lastSync(ctx: Context): Long = plain(ctx).getLong("lastSync", 0L)
    fun setLastSync(ctx: Context, t: Long) = plain(ctx).edit().putLong("lastSync", t).apply()
    fun lastError(ctx: Context): String = plain(ctx).getString("lastError", "") ?: ""
    fun setLastError(ctx: Context, e: String) = plain(ctx).edit().putString("lastError", e).apply()

    // ---------------------------------------------------------------- cola de envíos

    fun newId(): String = "w_" + UUID.randomUUID().toString().replace("-", "")

    @Synchronized
    fun outbox(ctx: Context): JSONArray = try {
        JSONArray(plain(ctx).getString("outbox", "[]"))
    } catch (e: Exception) {
        JSONArray()
    }

    @Synchronized
    fun enqueue(ctx: Context, kind: String, data: JSONObject): String {
        val id = newId()
        val list = outbox(ctx)
        list.put(JSONObject().put("id", id).put("kind", kind).put("ts", System.currentTimeMillis()).put("data", data))
        plain(ctx).edit().putString("outbox", list.toString()).apply()
        return id
    }

    @Synchronized
    fun removeFromOutbox(ctx: Context, ids: Set<String>) {
        if (ids.isEmpty()) return
        val list = outbox(ctx)
        val keep = JSONArray()
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            if (o.optString("id") !in ids) keep.put(o)
        }
        plain(ctx).edit().putString("outbox", keep.toString()).apply()
    }

    // ---------------------------------------------------------------- resumen de MemoryCarl

    fun summary(ctx: Context): JSONObject? = try {
        plain(ctx).getString("summary", null)?.let { JSONObject(it) }
    } catch (e: Exception) {
        null
    }

    fun saveSummary(ctx: Context, s: JSONObject) {
        plain(ctx).edit().putString("summary", s.toString()).apply()
        // Lo que MemoryCarl ya aplicó deja de hacer falta guardarlo aquí
        val ids = tasksRaw(s).map { it.id }.toSet()
        val done = localDone(ctx).filter { it in ids }.toSet()
        plain(ctx).edit().putStringSet("doneLocal", done).apply()
    }

    /** Ajusta el resumen guardado sin esperar a MemoryCarl (ej. un gasto recién anotado). */
    fun patchSummary(ctx: Context, fn: (JSONObject) -> Unit) {
        val s = summary(ctx) ?: return
        fn(s)
        plain(ctx).edit().putString("summary", s.toString()).apply()
    }

    private fun tasksRaw(s: JSONObject?): List<TaskInfo> {
        val arr = s?.optJSONArray("tasks") ?: return emptyList()
        val out = mutableListOf<TaskInfo>()
        for (i in 0 until arr.length()) {
            val t = arr.optJSONObject(i) ?: continue
            val id = t.optString("id")
            if (id.isBlank()) continue
            val at = t.optString("remindAt", "").let { if (it.isBlank()) null else parseIso(it) }
            out.add(TaskInfo(id, t.optString("text"), at, t.optInt("stepsDone", 0), t.optInt("stepsTotal", 0)))
        }
        return out
    }

    /** Tareas pendientes: las del resumen, sin las que marcaste aquí y con la hora pospuesta aquí. */
    fun tasks(ctx: Context): List<TaskInfo> {
        val done = localDone(ctx)
        val snoozes = localSnoozes(ctx)
        val now = System.currentTimeMillis()
        return tasksRaw(summary(ctx))
            .filter { it.id !in done }
            .map { t -> snoozes[t.id]?.takeIf { it > now }?.let { t.copy(remindAt = it) } ?: t }
    }

    fun localDone(ctx: Context): Set<String> = plain(ctx).getStringSet("doneLocal", emptySet()) ?: emptySet()
    fun markDoneLocal(ctx: Context, id: String) {
        plain(ctx).edit().putStringSet("doneLocal", localDone(ctx) + id).apply()
    }

    fun localSnoozes(ctx: Context): Map<String, Long> = try {
        val o = JSONObject(plain(ctx).getString("snoozes", "{}") ?: "{}")
        o.keys().asSequence().associateWith { o.optLong(it) }
    } catch (e: Exception) {
        emptyMap()
    }

    fun snoozeLocal(ctx: Context, id: String, at: Long) {
        val now = System.currentTimeMillis()
        val o = JSONObject()
        localSnoozes(ctx).filter { it.value > now }.forEach { (k, v) -> o.put(k, v) }
        o.put(id, at)
        plain(ctx).edit().putString("snoozes", o.toString()).apply()
    }

    fun scheduledIds(ctx: Context): Set<String> = plain(ctx).getStringSet("scheduled", emptySet()) ?: emptySet()
    fun setScheduledIds(ctx: Context, ids: Set<String>) = plain(ctx).edit().putStringSet("scheduled", ids).apply()

    fun parseIso(s: String): Long? = try {
        java.time.Instant.parse(s).toEpochMilli()
    } catch (e: Exception) {
        null
    }
}

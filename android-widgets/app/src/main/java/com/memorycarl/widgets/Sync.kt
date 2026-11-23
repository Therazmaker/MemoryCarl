package com.memorycarl.widgets

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/** Llamadas al servidor de MemoryCarl (Vercel). */
object Api {
    data class Response(val code: Int, val body: String) {
        val ok get() = code in 200..299
        fun message(): String = try {
            JSONObject(body).optString("message", "HTTP $code")
        } catch (e: Exception) {
            "HTTP $code"
        }
    }

    fun request(ctx: Context, method: String, path: String, body: String? = null): Response {
        val conn = URL(Store.serverUrl(ctx).trimEnd('/') + path).openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 25000
            conn.setRequestProperty("Authorization", "Bearer " + Store.apiKey(ctx))
            conn.setRequestProperty("Content-Type", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            Response(code, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * Sincroniza: manda lo que está en la cola (de a 50) y baja el resumen. Después actualiza los
 * widgets y reprograma los avisos. Si no hay internet, WorkManager lo reintenta solo.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        if (!Store.isConfigured(ctx)) return Result.success()
        var ok = true
        try {
            ok = sendOutbox(ctx) && ok
            val s = Api.request(ctx, "GET", "/api/widget/summary")
            if (s.ok) {
                JSONObject(s.body).optJSONObject("data")?.let { Store.saveSummary(ctx, it) }
                Store.setLastSync(ctx, System.currentTimeMillis())
                Store.setLastError(ctx, "")
            } else {
                Store.setLastError(ctx, s.message())
                ok = false
            }
        } catch (e: Exception) {
            Store.setLastError(ctx, e.message ?: "Sin conexión")
            ok = false
        }
        Widgets.updateAll(ctx)
        Reminders.reschedule(ctx)
        return if (ok) Result.success() else Result.retry()
    }

    private fun sendOutbox(ctx: Context): Boolean {
        val all = Store.outbox(ctx)
        if (all.length() == 0) return true
        var ok = true
        var i = 0
        while (i < all.length()) {
            val chunk = JSONArray()
            for (j in i until minOf(i + 50, all.length())) chunk.put(all.get(j))
            i += 50
            val r = Api.request(ctx, "POST", "/api/widget/inbox", JSONObject().put("items", chunk).toString())
            val done = mutableSetOf<String>()
            try {
                val j = JSONObject(r.body)
                j.optJSONArray("accepted")?.let { a -> for (k in 0 until a.length()) done.add(a.optString(k)) }
                // Lo que el servidor rechaza por inválido no se va a arreglar reintentando
                j.optJSONArray("rejected")?.let { a -> for (k in 0 until a.length()) a.optJSONObject(k)?.optString("id")?.let { if (it.isNotBlank()) done.add(it) } }
            } catch (e: Exception) {
                // respuesta que no es JSON: se reintenta después
            }
            Store.removeFromOutbox(ctx, done)
            if (!r.ok) {
                Store.setLastError(ctx, r.message())
                ok = false
            }
        }
        return ok
    }

    companion object {
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Sincroniza apenas haya internet. */
        fun now(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("sync_now", ExistingWorkPolicy.REPLACE, req)
        }

        /** Cada 15 minutos (lo mínimo que permite Android). */
        fun schedulePeriodic(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(network).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("sync_periodic", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}

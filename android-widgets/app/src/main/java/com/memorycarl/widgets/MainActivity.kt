package com.memorycarl.widgets

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Configuración: servidor y API key (la misma de Ajustes de NeuroChat), permisos para los
 * avisos, prueba de notificación y cómo poner los widgets.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Reminders.ensureChannel(this)
        val col = Ui.column(this, 20)
        col.addView(Ui.text(this, "✨ MemoryCarl Widgets", 22f, bold = true))
        col.addView(Ui.text(this, "Gastos y diario desde la pantalla de inicio, y avisos de tus tareas en el teléfono y el reloj.", 14f, muted = true))
        col.addView(Ui.spacer(this, 12))

        col.addView(Ui.text(this, "Servidor", 13f, muted = true))
        val url = Ui.input(this, Store.DEFAULT_URL, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        url.setText(Store.serverUrl(this))
        col.addView(url)
        col.addView(Ui.text(this, "API key (la misma que pusiste en Ajustes de NeuroChat)", 13f, muted = true))
        val key = Ui.input(this, if (Store.apiKey(this).isNotBlank()) "•••••••• (guardada; escribe para cambiarla)" else "Tu API key", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        col.addView(key)
        col.addView(Ui.button(this, "Guardar y probar", primary = true) {
            Store.saveConfig(this, url.text.toString().ifBlank { Store.DEFAULT_URL }, key.text.toString())
            key.setText("")
            testConnection()
        })

        status = Ui.text(this, "", 14f)
        col.addView(status)
        col.addView(Ui.spacer(this, 12))

        col.addView(Ui.text(this, "Avisos", 17f, bold = true))
        col.addView(Ui.button(this, "Permitir notificaciones") { askNotifications() })
        if (Build.VERSION.SDK_INT in 31..32) {
            col.addView(Ui.button(this, "Permitir avisos a la hora exacta") {
                startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            })
        }
        col.addView(Ui.button(this, "Probar un aviso") {
            Reminders.notify(this, TaskInfo("prueba_aviso", "Así se ve un aviso de MemoryCarl", System.currentTimeMillis(), 1, 3))
            if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) Toast.makeText(this, "Primero permite las notificaciones", Toast.LENGTH_LONG).show()
        })
        col.addView(Ui.button(this, "Sincronizar ahora") {
            SyncWorker.now(this)
            Toast.makeText(this, "Sincronizando…", Toast.LENGTH_SHORT).show()
            status.postDelayed({ refreshStatus() }, 4000)
        })
        col.addView(Ui.spacer(this, 12))

        col.addView(Ui.text(this, "Cómo poner los widgets", 17f, bold = true))
        col.addView(Ui.text(this, "1. Mantén presionada la pantalla de inicio → Widgets.\n2. Busca \"MemoryCarl Widgets\" y arrastra: 💸 Gasto rápido, 📓 Diario o ✅ Hoy.\n3. Lo que registres llega a MemoryCarl la próxima vez que la abras.", 14f))
        col.addView(Ui.spacer(this, 8))
        col.addView(Ui.text(this, "En el reloj", 17f, bold = true))
        col.addView(Ui.text(this, "En la app de tu reloj (Mi Fitness, Zepp…) entra a Notificaciones y activa \"MemoryCarl Widgets\". Los avisos te llegan al reloj con su vibración.", 14f))

        setContentView(ScrollView(this).apply { addView(col) })
        SyncWorker.schedulePeriodic(this)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshStatus()
    }

    private fun refreshStatus() {
        val parts = mutableListOf<String>()
        parts.add(if (Store.isConfigured(this)) "✓ Configurada" else "Falta la API key")
        val last = Store.lastSync(this)
        if (last > 0) parts.add("Última sincronización: " + SimpleDateFormat("d MMM HH:mm", Locale("es", "PE")).format(Date(last)))
        val pending = Store.outbox(this).length()
        if (pending > 0) parts.add("$pending registro(s) esperando internet")
        val err = Store.lastError(this)
        if (err.isNotBlank()) parts.add("⚠️ $err")
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) parts.add("⚠️ Notificaciones apagadas")
        if (Build.VERSION.SDK_INT >= 31) {
            val am = getSystemService(AlarmManager::class.java)
            if (am != null && !am.canScheduleExactAlarms()) parts.add("⚠️ Avisos exactos sin permiso (pueden llegar unos minutos tarde)")
        }
        status.text = parts.joinToString("\n")
    }

    private fun testConnection() {
        status.text = "Probando…"
        Thread {
            val msg = try {
                val r = Api.request(this, "GET", "/api/widget/summary")
                if (r.ok) {
                    org.json.JSONObject(r.body).optJSONObject("data")?.let { Store.saveSummary(this, it) }
                    Store.setLastSync(this, System.currentTimeMillis())
                    Store.setLastError(this, "")
                    "✓ Conectado con MemoryCarl"
                } else {
                    Store.setLastError(this, r.message())
                    "⚠️ ${r.message()}"
                }
            } catch (e: Exception) {
                "⚠️ No pude conectar: ${e.message}"
            }
            runOnUiThread {
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                refreshStatus()
                Widgets.updateAll(this)
                Reminders.reschedule(this)
                SyncWorker.now(this)
            }
        }.start()
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        } else if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } else {
            Toast.makeText(this, "✓ Ya están permitidas", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshStatus()
    }
}

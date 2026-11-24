package com.memorycarl.widgets

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
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
    private lateinit var widgetsInfo: TextView
    private lateinit var modelInfo: TextView

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

        col.addView(Ui.text(this, "🧠 Modelo local (Gemma)", 17f, bold = true))
        col.addView(Ui.text(this, "Un modelo chico que corre en el teléfono, sin internet. Entiende lo que cuentas en \"Cuéntame tu día\" y propone los números de tu Bitácora. No reemplaza a Carl: solo ordena.", 13f, muted = true))
        modelInfo = Ui.text(this, "", 14f)
        col.addView(modelInfo)
        col.addView(Ui.button(this, "🧠 Cuéntame tu día", primary = true) { startActivity(Intent(this, DayActivity::class.java)) })
        col.addView(Ui.button(this, "Elegir archivo del modelo (.task)") {
            startActivityForResult(
                Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),
                PICK_MODEL,
            )
        })
        col.addView(Ui.button(this, "Quitar el modelo") {
            LocalModel.delete(this)
            refreshModel()
            Toast.makeText(this, "Modelo quitado", Toast.LENGTH_SHORT).show()
        })
        col.addView(Ui.text(this, "Cómo conseguirlo: en Hugging Face busca \"litert-community/Gemma3-1B-IT\", acepta la licencia de Google y descarga gemma3-1b-it-int4.task (unos 550 MB). Después tócalo aquí arriba en \"Elegir archivo\". Es el mismo archivo que usa la app Google AI Edge Gallery.", 13f, muted = true))
        col.addView(Ui.spacer(this, 12))

        col.addView(Ui.text(this, "Poner los widgets", 17f, bold = true))
        widgetsInfo = Ui.text(this, "", 13f, muted = true)
        col.addView(widgetsInfo)
        col.addView(Ui.button(this, "Poner 💸 Gasto rápido") { pinWidget(ExpenseWidget::class.java) })
        col.addView(Ui.button(this, "Poner 📓 Diario") { pinWidget(JournalWidget::class.java) })
        col.addView(Ui.button(this, "Poner ✅ Hoy") { pinWidget(TodayWidget::class.java) })
        col.addView(Ui.text(this, "Si no pasa nada al tocarlos: en Ajustes → Apps → MemoryCarl Widgets → Otros permisos, activa \"Atajos de la pantalla de inicio\" y vuelve a intentar. También puedes mantener presionada la pantalla de inicio → Widgets y buscar \"MemoryCarl Widgets\".\nLo que registres llega a MemoryCarl la próxima vez que la abras.", 13f, muted = true))
        col.addView(Ui.spacer(this, 8))
        col.addView(Ui.text(this, "En el reloj", 17f, bold = true))
        col.addView(Ui.text(this, "En la app de tu reloj (Mi Fitness, Zepp…) entra a Notificaciones y activa \"MemoryCarl Widgets\". Los avisos te llegan al reloj con su vibración.", 14f))

        setContentView(ScrollView(this).apply { addView(col) })
        SyncWorker.schedulePeriodic(this)
        refreshStatus()
        refreshModel()
    }

    private fun refreshModel() {
        modelInfo.text = if (LocalModel.isReady(this)) "✓ Modelo listo: ${LocalModel.name(this).ifBlank { "model.task" }} (${LocalModel.sizeLabel(this)})" else "Sin modelo todavía"
    }

    @Deprecated("Activity clásica")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_MODEL || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        val name = try {
            contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (e: Exception) {
            null
        } ?: "model.task"
        modelInfo.text = "Copiando $name…"
        Thread {
            val msg = try {
                LocalModel.importFrom(this, uri, name) { pct -> runOnUiThread { modelInfo.text = "Copiando $name… $pct%" } }
                "🧠 Modelo listo"
            } catch (e: Throwable) {
                "⚠️ ${e.message ?: "No se pudo copiar"}"
            }
            runOnUiThread {
                refreshModel()
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    companion object {
        private const val PICK_MODEL = 42
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
        // Cuántos widgets de esta app reconoce Android (si son 3, el problema es la lista del launcher)
        if (::widgetsInfo.isInitialized) {
            val mgr = AppWidgetManager.getInstance(this)
            val known = try { mgr.getInstalledProvidersForPackage(packageName, null).size } catch (e: Exception) { -1 }
            val placed = listOf(ExpenseWidget::class.java, JournalWidget::class.java, TodayWidget::class.java)
                .sumOf { mgr.getAppWidgetIds(ComponentName(this, it)).size }
            widgetsInfo.text = "Android reconoce $known widgets de esta app · tienes $placed en tu pantalla" +
                if (mgr.isRequestPinAppWidgetSupported) "" else "\nTu pantalla de inicio no deja ponerlos desde aquí: usa la lista de widgets."
        }
    }

    /** Pide a la pantalla de inicio que ponga el widget (sin pasar por la lista de widgets). */
    private fun pinWidget(cls: Class<*>) {
        val mgr = AppWidgetManager.getInstance(this)
        val ok = try {
            mgr.isRequestPinAppWidgetSupported && mgr.requestPinAppWidget(ComponentName(this, cls), null, null)
        } catch (e: Exception) {
            false
        }
        Toast.makeText(
            this,
            if (ok) "Confirma en la pantalla que aparece" else "Tu pantalla de inicio no lo permitió: activa \"Atajos de la pantalla de inicio\" en los permisos de la app",
            Toast.LENGTH_LONG,
        ).show()
        status.postDelayed({ refreshStatus() }, 3000)
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

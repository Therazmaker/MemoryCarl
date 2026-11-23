package com.memorycarl.widgets

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Avisos de tareas: una alarma del teléfono por cada tarea con hora (funciona sin internet).
 * Cuando suena, sale una notificación con ✓ Hecho, ⏰ 15 min y Mañana. Los relojes que copian
 * las notificaciones del teléfono (Mi Fitness, Zepp…) la muestran también.
 */
object Reminders {
    const val CHANNEL = "tareas"
    private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    private const val HORIZON = 14L * 24 * 3600 * 1000

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Tareas", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Avisos de tus tareas del Magic ToDo"
            ch.enableVibration(true)
            nm.createNotificationChannel(ch)
        }
    }

    fun timeLabel(at: Long): String {
        val now = Calendar.getInstance()
        val c = Calendar.getInstance().apply { timeInMillis = at }
        val hm = SimpleDateFormat("HH:mm", Locale("es", "PE")).format(Date(at))
        val sameDay = now.get(Calendar.YEAR) == c.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == c.get(Calendar.DAY_OF_YEAR)
        now.add(Calendar.DAY_OF_YEAR, 1)
        val tomorrow = now.get(Calendar.YEAR) == c.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == c.get(Calendar.DAY_OF_YEAR)
        return when {
            sameDay -> "hoy $hm"
            tomorrow -> "mañana $hm"
            else -> SimpleDateFormat("EEE d MMM HH:mm", Locale("es", "PE")).format(Date(at))
        }
    }

    private fun alarmIntent(ctx: Context, t: TaskInfo): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java)
            .setAction("com.memorycarl.widgets.REMIND.${t.id}")
            .putExtra("id", t.id)
            .putExtra("text", t.text)
            .putExtra("stepsDone", t.stepsDone)
            .putExtra("stepsTotal", t.stepsTotal)
            .putExtra("at", t.remindAt ?: 0L)
        return PendingIntent.getBroadcast(ctx, t.id.hashCode(), i, FLAGS)
    }

    private fun schedule(ctx: Context, am: AlarmManager, t: TaskInfo) {
        val at = t.remindAt ?: return
        val pi = alarmIntent(ctx, t)
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    /** Programa los avisos de las próximas 2 semanas y quita los que ya no van. */
    fun reschedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val now = System.currentTimeMillis()
        val next = mutableSetOf<String>()
        for (t in Store.tasks(ctx)) {
            val at = t.remindAt ?: continue
            if (at <= now || at > now + HORIZON) continue
            schedule(ctx, am, t)
            next.add(t.id)
        }
        for (old in Store.scheduledIds(ctx) - next) {
            val pi = PendingIntent.getBroadcast(
                ctx, old.hashCode(),
                Intent(ctx, ReminderReceiver::class.java).setAction("com.memorycarl.widgets.REMIND.$old"),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            if (pi != null) am.cancel(pi)
        }
        Store.setScheduledIds(ctx, next)
    }

    @SuppressLint("MissingPermission")
    fun notify(ctx: Context, t: TaskInfo) {
        ensureChannel(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        val open = PendingIntent.getActivity(
            ctx, 900,
            Intent(Intent.ACTION_VIEW, Uri.parse(Store.serverUrl(ctx))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            FLAGS,
        )
        val sub = if (t.stepsTotal > 0) "Pasos: ${t.stepsDone} de ${t.stepsTotal}" else "Magic ToDo"
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(t.text)
            .setContentText(sub)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "✓ Hecho", ActionReceiver.pending(ctx, ActionReceiver.DONE, t))
            .addAction(0, "⏰ 15 min", ActionReceiver.pending(ctx, ActionReceiver.SNOOZE, t))
            .addAction(0, "Mañana", ActionReceiver.pending(ctx, ActionReceiver.TOMORROW, t))
            .build()
        try {
            nm.notify(t.id.hashCode(), n)
        } catch (e: SecurityException) {
            // sin permiso de notificaciones
        }
    }
}

/** Suena una alarma: muestra el aviso. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        // Si ya la marcaste aquí, no avisa
        if (id in Store.localDone(ctx)) return
        val t = TaskInfo(
            id, intent.getStringExtra("text") ?: "Tarea", intent.getLongExtra("at", 0L),
            intent.getIntExtra("stepsDone", 0), intent.getIntExtra("stepsTotal", 0),
        )
        Reminders.notify(ctx, t)
    }
}

/** ✓ Hecho, ⏰ 15 min y Mañana (desde la notificación o el widget). */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val text = intent.getStringExtra("text") ?: "Tarea"
        NotificationManagerCompat.from(ctx).cancel(id.hashCode())
        when (intent.getStringExtra("op")) {
            DONE -> {
                Store.enqueue(ctx, "task_done", JSONObject().put("taskId", id))
                Store.markDoneLocal(ctx, id)
            }
            SNOOZE, TOMORROW -> {
                val base = System.currentTimeMillis()
                val at = if (intent.getStringExtra("op") == SNOOZE) base + 15 * 60 * 1000L else {
                    val orig = intent.getLongExtra("at", 0L).takeIf { it > 0 } ?: base
                    Calendar.getInstance().apply {
                        timeInMillis = orig
                        val keepH = get(Calendar.HOUR_OF_DAY)
                        val keepM = get(Calendar.MINUTE)
                        timeInMillis = base
                        add(Calendar.DAY_OF_YEAR, 1)
                        set(Calendar.HOUR_OF_DAY, keepH)
                        set(Calendar.MINUTE, keepM)
                        set(Calendar.SECOND, 0)
                    }.timeInMillis
                }
                Store.enqueue(ctx, "task_snooze", JSONObject().put("taskId", id).put("remindAt", java.time.Instant.ofEpochMilli(at).toString()))
                Store.snoozeLocal(ctx, id, at)
            }
        }
        Reminders.reschedule(ctx)
        Widgets.updateAll(ctx)
        SyncWorker.now(ctx)
        android.widget.Toast.makeText(ctx, if (intent.getStringExtra("op") == DONE) "✓ $text" else "⏰ Te aviso de nuevo", android.widget.Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val DONE = "done"
        const val SNOOZE = "snooze"
        const val TOMORROW = "tomorrow"

        fun pending(ctx: Context, op: String, t: TaskInfo): PendingIntent {
            val i = Intent(ctx, ActionReceiver::class.java)
                .setAction("com.memorycarl.widgets.$op.${t.id}")
                .putExtra("op", op)
                .putExtra("id", t.id)
                .putExtra("text", t.text)
                .putExtra("at", t.remindAt ?: 0L)
            return PendingIntent.getBroadcast(ctx, (op + t.id).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}

/** Al prender el teléfono o actualizar la app, las alarmas se vuelven a programar. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Reminders.reschedule(ctx)
        SyncWorker.schedulePeriodic(ctx)
        Widgets.updateAll(ctx)
    }
}

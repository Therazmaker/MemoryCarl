package com.memorycarl.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.util.Locale

class ExpenseWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { Widgets.renderExpense(ctx, mgr, it) }
        SyncWorker.schedulePeriodic(ctx)
    }
}

class JournalWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { Widgets.renderJournal(ctx, mgr, it) }
        SyncWorker.schedulePeriodic(ctx)
    }
}

class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { Widgets.renderToday(ctx, mgr, it) }
        SyncWorker.schedulePeriodic(ctx)
    }
}

object Widgets {
    private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    fun soles(v: Double): String = "S/ " + String.format(Locale.US, "%,.2f", v)

    fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        mgr.getAppWidgetIds(ComponentName(ctx, ExpenseWidget::class.java)).forEach { renderExpense(ctx, mgr, it) }
        mgr.getAppWidgetIds(ComponentName(ctx, JournalWidget::class.java)).forEach { renderJournal(ctx, mgr, it) }
        mgr.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java)).forEach { renderToday(ctx, mgr, it) }
    }

    private fun openActivity(ctx: Context, cls: Class<*>, req: Int): PendingIntent {
        val i = Intent(ctx, cls).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        return PendingIntent.getActivity(ctx, req, i, FLAGS)
    }

    fun renderExpense(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_expense)
        val s = Store.summary(ctx)
        val rw = s?.optJSONObject("runway")
        when {
            !Store.isConfigured(ctx) -> {
                v.setTextViewText(R.id.free, "MemoryCarl")
                v.setTextViewText(R.id.sub, "Toca para configurar")
            }
            rw != null -> {
                v.setTextViewText(R.id.free, soles(rw.optDouble("free", 0.0)))
                val perDay = rw.optDouble("perDay", 0.0)
                val label = rw.optString("paydayLabel", "")
                v.setTextViewText(R.id.sub, "${soles(perDay)} por día" + if (label.isNotBlank()) " · cobro $label" else "")
            }
            else -> {
                v.setTextViewText(R.id.free, "S/ —")
                val last = s?.optJSONObject("lastExpense")
                v.setTextViewText(R.id.sub, if (last != null) "Último: ${soles(last.optDouble("amount", 0.0))} ${last.optString("category")}" else "Abre MemoryCarl para ver tu saldo")
            }
        }
        v.setOnClickPendingIntent(R.id.btn_add, openActivity(ctx, if (Store.isConfigured(ctx)) ExpenseActivity::class.java else MainActivity::class.java, 101))
        v.setOnClickPendingIntent(R.id.root, openActivity(ctx, MainActivity::class.java, 100))
        mgr.updateAppWidget(id, v)
    }

    fun renderJournal(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_journal)
        v.setOnClickPendingIntent(R.id.btn_write, openActivity(ctx, if (Store.isConfigured(ctx)) JournalActivity::class.java else MainActivity::class.java, 201))
        v.setOnClickPendingIntent(R.id.root, openActivity(ctx, if (Store.isConfigured(ctx)) JournalActivity::class.java else MainActivity::class.java, 202))
        mgr.updateAppWidget(id, v)
    }

    private val rows = intArrayOf(R.id.row1, R.id.row2, R.id.row3, R.id.row4)
    private val texts = intArrayOf(R.id.task1, R.id.task2, R.id.task3, R.id.task4)
    private val dones = intArrayOf(R.id.done1, R.id.done2, R.id.done3, R.id.done4)

    fun renderToday(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_today)
        val tasks = Store.tasks(ctx).sortedBy { it.remindAt ?: Long.MAX_VALUE }.take(4)
        v.setViewVisibility(R.id.empty, if (tasks.isEmpty()) View.VISIBLE else View.GONE)
        v.setTextViewText(R.id.empty, if (Store.isConfigured(ctx)) "Nada pendiente 🎉" else "Toca para configurar")
        for (i in rows.indices) {
            val t = tasks.getOrNull(i)
            if (t == null) {
                v.setViewVisibility(rows[i], View.GONE)
                continue
            }
            v.setViewVisibility(rows[i], View.VISIBLE)
            val extra = buildList {
                t.remindAt?.let { add("⏰ " + Reminders.timeLabel(it)) }
                if (t.stepsTotal > 0) add("${t.stepsDone}/${t.stepsTotal}")
            }.joinToString(" · ")
            v.setTextViewText(texts[i], if (extra.isBlank()) t.text else "${t.text}\n$extra")
            v.setOnClickPendingIntent(dones[i], ActionReceiver.pending(ctx, ActionReceiver.DONE, t))
        }
        v.setOnClickPendingIntent(R.id.root, openActivity(ctx, MainActivity::class.java, 300))
        mgr.updateAppWidget(id, v)
    }
}

package com.memorycarl.widgets

import android.app.AlarmManager
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.concurrent.Executors

/** Pruebas de la app de widgets con Android simulado (datos inventados). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WidgetsAppTest {
    private lateinit var ctx: Context
    private var server: MockWebServer? = null
    private val received = mutableListOf<JSONObject>()

    @Before
    fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(ctx)
        ctx.getSharedPreferences("mc_widgets", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @After
    fun tearDown() {
        server?.shutdown()
    }

    private fun summary(vararg tasks: JSONObject) = JSONObject()
        .put("accounts", JSONArray().put(JSONObject().put("id", "acc1").put("name", "Billetera")))
        .put("lastAccountId", "acc1")
        .put("totalBalance", 122.91)
        .put("categories", JSONArray().put("Comida").put("Transporte"))
        .put("runway", JSONObject().put("free", 120.5).put("perDay", 17.2).put("paydayLabel", "el lun 30"))
        .put("tasks", JSONArray().apply { tasks.forEach { put(it) } })

    private fun task(id: String, text: String, inMinutes: Long? = null) = JSONObject().put("id", id).put("text", text).apply {
        if (inMinutes != null) put("remindAt", Instant.ofEpochMilli(System.currentTimeMillis() + inMinutes * 60000).toString())
    }

    @Test
    fun colaYTareasLocales() {
        val id = Store.enqueue(ctx, "expense", JSONObject().put("amount", 8.5))
        assertTrue(id.startsWith("w_") && id.length in 8..64)
        assertEquals(1, Store.outbox(ctx).length())
        Store.removeFromOutbox(ctx, setOf(id))
        assertEquals(0, Store.outbox(ctx).length())

        Store.saveSummary(ctx, summary(task("t1", "Llamar al banco", 60), task("t2", "Planchar")))
        assertEquals(listOf("t1", "t2"), Store.tasks(ctx).map { it.id })
        Store.markDoneLocal(ctx, "t2")
        assertEquals(listOf("t1"), Store.tasks(ctx).map { it.id })
        val later = System.currentTimeMillis() + 3 * 3600000
        Store.snoozeLocal(ctx, "t1", later)
        assertEquals(later, Store.tasks(ctx).first().remindAt)
        // Cuando MemoryCarl ya no la tiene (la aplicó), deja de guardarse como hecha aquí
        Store.saveSummary(ctx, summary(task("t1", "Llamar al banco", 60)))
        assertFalse("t2" in Store.localDone(ctx))
    }

    @Test
    fun avisosSeProgramanYSeQuitan() {
        Store.saveSummary(ctx, summary(task("t1", "Llamar al banco", 30), task("t2", "Sin hora"), task("t3", "Muy lejos", 60L * 24 * 30)))
        Reminders.reschedule(ctx)
        val am = shadowOf(ctx.getSystemService(AlarmManager::class.java))
        assertEquals(1, am.scheduledAlarms.size)
        assertEquals(setOf("t1"), Store.scheduledIds(ctx))
        Store.markDoneLocal(ctx, "t1")
        Reminders.reschedule(ctx)
        assertEquals(0, am.scheduledAlarms.size)
    }

    @Test
    fun botonesDeLaNotificacion() {
        Store.saveConfig(ctx, "https://ejemplo.test", "clave")
        Store.saveSummary(ctx, summary(task("t1", "Llamar al banco", 5)))
        fun send(op: String) = ActionReceiver().onReceive(
            ctx,
            Intent(ctx, ActionReceiver::class.java).putExtra("op", op).putExtra("id", "t1").putExtra("text", "Llamar al banco")
                .putExtra("at", System.currentTimeMillis()),
        )
        send(ActionReceiver.SNOOZE)
        val snooze = Store.outbox(ctx).getJSONObject(0)
        assertEquals("task_snooze", snooze.getString("kind"))
        val at = Instant.parse(snooze.getJSONObject("data").getString("remindAt")).toEpochMilli()
        assertTrue(at - System.currentTimeMillis() in (14 * 60000L)..(16 * 60000L))
        send(ActionReceiver.DONE)
        assertEquals("task_done", Store.outbox(ctx).getJSONObject(1).getString("kind"))
        assertTrue(Store.tasks(ctx).isEmpty())
    }

    @Test
    fun avisoSeMuestra() {
        Reminders.notify(ctx, TaskInfo("t1", "Llamar al banco", System.currentTimeMillis(), 1, 3))
        val nm = shadowOf(ctx.getSystemService(android.app.NotificationManager::class.java))
        val n = nm.allNotifications.single()
        assertEquals("Llamar al banco", n.extras.getString("android.title"))
        assertEquals(3, n.actions.size)
        assertEquals("✓ Hecho", n.actions[0].title.toString())
    }

    @Test
    fun sincronizaConElServidor() {
        val http = MockWebServer()
        http.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                assertEquals("Bearer clave-prueba", request.getHeader("Authorization"))
                return when (request.path) {
                    "/api/widget/inbox" -> {
                        val body = JSONObject(request.body.readUtf8())
                        received.add(body)
                        val ids = JSONArray()
                        val items = body.getJSONArray("items")
                        for (i in 0 until items.length()) ids.put(items.getJSONObject(i).getString("id"))
                        MockResponse().setBody(JSONObject().put("status", "ok").put("accepted", ids).put("rejected", JSONArray()).toString())
                    }
                    "/api/widget/summary" -> MockResponse().setBody(JSONObject().put("status", "ok").put("data", summary(task("t9", "Pagar la luz", 120))).toString())
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        http.start()
        server = http
        Store.saveConfig(ctx, http.url("/").toString(), "clave-prueba")
        Store.enqueue(ctx, "expense", JSONObject().put("amount", 8.5).put("category", "Comida"))
        Store.enqueue(ctx, "journal", JSONObject().put("text", "Escrito desde el widget"))

        val worker = TestWorkerBuilder.from(ctx, SyncWorker::class.java, Executors.newSingleThreadExecutor()).build()
        val result = worker.doWork()
        assertEquals(ListenableWorker.Result.success(), result)
        assertEquals(2, received.single().getJSONArray("items").length())
        assertEquals(0, Store.outbox(ctx).length())
        assertEquals("Pagar la luz", Store.tasks(ctx).single().text)
        assertEquals("", Store.lastError(ctx))
    }

    @Test
    fun widgetsMuestranElResumen() {
        Store.saveConfig(ctx, "https://ejemplo.test", "clave")
        Store.saveSummary(ctx, summary(task("t1", "Llamar al banco", 30), task("t2", "Planchar")))
        val mgr = shadowOf(AppWidgetManager.getInstance(ctx))
        val expenseId = mgr.createWidget(ExpenseWidget::class.java, R.layout.widget_expense)
        val todayId = mgr.createWidget(TodayWidget::class.java, R.layout.widget_today)
        Widgets.updateAll(ctx)
        val ev = mgr.getViewFor(expenseId)
        // Muestra el TOTAL de Finanzas, no lo "libre hasta el cobro" (que puede ser negativo)
        assertEquals("S/ 122.91", ev.findViewById<TextView>(R.id.free).text.toString())
        assertEquals("Próximo cobro el lun 30", ev.findViewById<TextView>(R.id.sub).text.toString())
        val tv = mgr.getViewFor(todayId)
        assertTrue(tv.findViewById<TextView>(R.id.task1).text.toString().startsWith("Llamar al banco"))
        assertEquals("Planchar", tv.findViewById<TextView>(R.id.task2).text.toString())
        assertEquals(android.view.View.GONE, tv.findViewById<android.view.View>(R.id.row3).visibility)
    }
}

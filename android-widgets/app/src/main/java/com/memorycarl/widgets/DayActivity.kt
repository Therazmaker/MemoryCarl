package com.memorycarl.widgets

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import org.json.JSONObject
import java.time.LocalDate

/**
 * 🧠 "Cuéntame tu día": escribes o dictas cómo te fue; Gemma (en el teléfono, sin internet)
 * propone los números de la Bitácora 1–10; tú los revisas y se mandan a MemoryCarl.
 */
class DayActivity : Activity() {
    private var text = ""
    private var dayOffset = 0 // 0 = hoy, -1 = ayer
    private val values = linkedMapOf<String, Int>()
    private var summary = ""
    private var source = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showInput()
    }

    private fun setScreen(col: LinearLayout) = setContentView(ScrollView(this).apply { addView(col) })

    // ---------------------------------------------------------------- 1. contar

    private fun showInput() {
        val col = Ui.column(this, 20)
        col.addView(Ui.text(this, "🧠 Cuéntame tu día", 20f, bold = true))
        col.addView(
            Ui.text(
                this,
                if (LocalModel.isReady(this)) "Escribe o dicta con el micrófono del teclado. Gemma lo entiende aquí mismo, sin internet."
                else "Escribe o dicta. Sin modelo solo entiendo números dichos tal cual (\"estrés 8\"); el resto lo marcas tú. Puedes elegir el modelo en la app.",
                13f, muted = true,
            ),
        )
        val input = Ui.input(this, "¿Cómo dormiste, cómo estás, cómo comiste, qué te dolió…?", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
        input.minLines = 4
        input.maxLines = 10
        input.gravity = Gravity.TOP or Gravity.START
        input.setText(text)
        col.addView(input)

        val status = Ui.text(this, "", 13f, muted = true)
        col.addView(status)
        col.addView(Ui.spacer(this, 8))

        val actions = Ui.row(this)
        actions.addView(Ui.button(this, "Cancelar") { finish() })
        lateinit var go: Button
        go = Ui.button(this, if (LocalModel.isReady(this)) "Entender" else "Seguir", primary = true) {
            val t = input.text.toString().trim()
            if (t.isEmpty()) {
                input.error = "Cuéntame algo"
                return@button
            }
            text = t
            go.isEnabled = false
            status.text = if (LocalModel.isReady(this)) "🧠 Pensando… (la primera vez tarda un poco más)" else ""
            Thread {
                val started = System.currentTimeMillis()
                var err: String? = null
                val model = if (LocalModel.isReady(this)) {
                    try {
                        DayParse.parseModel(LocalModel.generate(this, DayParse.prompt(t)))
                    } catch (e: Throwable) {
                        err = e.message ?: e.javaClass.simpleName
                        null
                    }
                } else null
                val r = DayParse.merge(model, t)
                val secs = (System.currentTimeMillis() - started) / 1000.0
                runOnUiThread {
                    values.clear()
                    values.putAll(r.values)
                    summary = r.summary
                    source = when {
                        err != null -> "⚠️ Gemma falló ($err). Revisa y marca a mano."
                        model != null -> "🧠 Gemma propuso esto en ${String.format(java.util.Locale.US, "%.1f", secs)} s. Revisa antes de guardar."
                        else -> "Marca lo que quieras (toca un número otra vez para quitarlo)."
                    }
                    showReview()
                }
            }.start()
        }
        go.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = Ui.dp(this@DayActivity, 8) }
        actions.addView(go)
        col.addView(actions)
        setScreen(col)
        Ui.focus(this, input)
    }

    // ---------------------------------------------------------------- 2. revisar

    private fun showReview() {
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        val col = Ui.column(this, 20)
        col.addView(Ui.text(this, "🧠 Revisa tu día", 20f, bold = true))
        col.addView(Ui.text(this, source, 13f, muted = true))

        // ¿De qué día hablas?
        val days = Ui.chipRow(this, col)
        val dayButtons = mutableListOf<Button>()
        listOf(0 to "Hoy", -1 to "Ayer").forEach { (off, label) ->
            val b = Ui.chip(this, label) { btn ->
                dayOffset = off
                dayButtons.forEach { Ui.setChipOn(it, it == btn) }
            }
            dayButtons.add(b)
            days.addView(b)
            Ui.setChipOn(b, off == dayOffset)
        }

        for (s in DayParse.SCALES) {
            val head = Ui.row(this)
            val label = Ui.text(this, "${s.emoji} ${s.label}", 15f, bold = true)
            label.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            head.addView(label)
            val value = Ui.text(this, values[s.id]?.toString() ?: "–", 16f, bold = true)
            head.addView(value)
            col.addView(Ui.spacer(this, 6))
            col.addView(head)
            col.addView(Ui.text(this, s.hint, 12f, muted = true))
            val row = Ui.chipRow(this, col)
            val buttons = mutableListOf<Button>()
            for (n in 1..10) {
                val b = Ui.chip(this, n.toString()) { _ ->
                    if (values[s.id] == n) values.remove(s.id) else values[s.id] = n
                    buttons.forEachIndexed { i, bb -> Ui.setChipOn(bb, values[s.id] == i + 1) }
                    value.text = values[s.id]?.toString() ?: "–"
                }
                b.setPadding(Ui.dp(this, 10), 0, Ui.dp(this, 10), 0)
                buttons.add(b)
                row.addView(b)
                Ui.setChipOn(b, values[s.id] == n)
            }
        }

        col.addView(Ui.spacer(this, 10))
        if (summary.isNotBlank()) col.addView(Ui.text(this, "📝 $summary", 14f))
        val toJournal = CheckBox(this).apply {
            text = "Guardar también lo que contaste en el Diario"
            isChecked = true
        }
        col.addView(toJournal)
        col.addView(Ui.spacer(this, 8))

        val actions = Ui.row(this)
        actions.addView(Ui.button(this, "‹ Editar") { showInput() })
        val save = Ui.button(this, "Guardar", primary = true) {
            val date = LocalDate.now().plusDays(dayOffset.toLong()).toString()
            if (values.isEmpty() && !toJournal.isChecked) {
                Toast.makeText(this, "No hay nada que guardar", Toast.LENGTH_SHORT).show()
                return@button
            }
            if (values.isNotEmpty()) {
                val v = JSONObject()
                values.forEach { (k, n) -> v.put(k, n) }
                Store.enqueue(this, "scales", JSONObject().put("date", date).put("values", v))
            }
            if (toJournal.isChecked && text.isNotBlank()) {
                val prefix = if (dayOffset == -1) "(Sobre ayer) " else ""
                Store.enqueue(this, "journal", JSONObject().put("text", prefix + text))
            }
            SyncWorker.now(this)
            Toast.makeText(this, "📓 Anotado en tu Bitácora", Toast.LENGTH_SHORT).show()
            finish()
        }
        save.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = Ui.dp(this@DayActivity, 8) }
        actions.addView(save)
        col.addView(actions)
        setScreen(col)
    }
}

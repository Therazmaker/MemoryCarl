package com.memorycarl.widgets

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.Toast
import org.json.JSONObject

/** Ventanita "＋ Gasto": monto, categoría, cuenta y nota. */
class ExpenseActivity : Activity() {
    private var category = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val s = Store.summary(this)
        val col = Ui.column(this, 20)
        col.addView(Ui.text(this, "💸 Nuevo gasto", 20f, bold = true))
        s?.optJSONObject("runway")?.let { rw ->
            col.addView(Ui.text(this, "Te quedan ${Widgets.soles(rw.optDouble("free", 0.0))} hasta el cobro", 13f, muted = true))
        }

        val amount = Ui.input(this, "Monto (S/)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
        amount.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 28f)
        col.addView(amount)

        col.addView(Ui.text(this, "Categoría", 13f, muted = true))
        val cats = mutableListOf<String>()
        s?.optJSONArray("categories")?.let { a -> for (i in 0 until a.length()) cats.add(a.optString(i)) }
        if (cats.isEmpty()) cats.addAll(listOf("Comida", "Transporte", "Mercado", "Salud", "Casa", "Otros"))
        category = cats.first()
        val chips = Ui.chipRow(this, col)
        val buttons = mutableListOf<Button>()
        for (c in cats) {
            val b = Ui.chip(this, c) { btn ->
                category = c
                buttons.forEach { Ui.setChipOn(it, it == btn) }
            }
            buttons.add(b)
            chips.addView(b)
        }
        Ui.setChipOn(buttons.first(), true)

        // Cuenta: la última que usaste viene marcada
        val accIds = mutableListOf<String>()
        val accNames = mutableListOf<String>()
        s?.optJSONArray("accounts")?.let { a ->
            for (i in 0 until a.length()) a.optJSONObject(i)?.let { accIds.add(it.optString("id")); accNames.add(it.optString("name")) }
        }
        val spinner = Spinner(this)
        if (accIds.isNotEmpty()) {
            col.addView(Ui.spacer(this))
            col.addView(Ui.text(this, "Cuenta", 13f, muted = true))
            spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, accNames)
            val last = s?.optString("lastAccountId", "") ?: ""
            accIds.indexOf(last).takeIf { it >= 0 }?.let { spinner.setSelection(it) }
            col.addView(spinner)
        }

        val note = Ui.input(this, "Nota (opcional)")
        col.addView(note)
        col.addView(Ui.spacer(this, 12))

        val actions = Ui.row(this)
        actions.addView(Ui.button(this, "Cancelar") { finish() })
        val save = Ui.button(this, "Guardar", primary = true) {
            val value = amount.text.toString().replace(",", ".").toDoubleOrNull()
            if (value == null || value <= 0) {
                amount.error = "Pon el monto"
                return@button
            }
            val data = JSONObject().put("amount", value).put("category", category).put("note", note.text.toString().trim())
            if (accIds.isNotEmpty()) data.put("accountId", accIds[spinner.selectedItemPosition])
            Store.enqueue(this, "expense", data)
            // Se ve al instante en el widget, sin esperar a MemoryCarl
            Store.patchSummary(this) { sum ->
                sum.optJSONObject("runway")?.let { rw -> rw.put("free", rw.optDouble("free", 0.0) - value) }
                sum.put("lastExpense", JSONObject().put("amount", value).put("category", category))
            }
            Widgets.updateAll(this)
            SyncWorker.now(this)
            Toast.makeText(this, "💸 Anotado: ${Widgets.soles(value)} $category", Toast.LENGTH_SHORT).show()
            finish()
        }
        save.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = Ui.dp(this@ExpenseActivity, 8) }
        actions.addView(save)
        col.addView(actions)

        setContentView(ScrollView(this).apply { addView(col) })
        Ui.focus(this, amount)
    }
}

/** Ventanita "📓 Diario": texto (se puede dictar con el micrófono del teclado) y ánimo. */
class JournalActivity : Activity() {
    private var mood: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val s = Store.summary(this)
        val col = Ui.column(this, 20)
        col.addView(Ui.text(this, "📓 Diario", 20f, bold = true))
        col.addView(Ui.text(this, "Escribe o dicta con el micrófono del teclado", 13f, muted = true))

        val text = Ui.input(this, "¿Qué pasó? ¿Cómo estás?", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
        text.minLines = 4
        text.maxLines = 10
        text.gravity = android.view.Gravity.TOP or android.view.Gravity.START
        col.addView(text)

        col.addView(Ui.text(this, "Ánimo (opcional)", 13f, muted = true))
        val moods = mutableListOf<Pair<String, String>>()
        s?.optJSONArray("moods")?.let { a ->
            for (i in 0 until a.length()) a.optJSONObject(i)?.let { moods.add(it.optString("id") to "${it.optString("emoji")} ${it.optString("label")}") }
        }
        if (moods.isEmpty()) {
            moods.addAll(listOf("great" to "😄 Genial", "good" to "🙂 Bien", "meh" to "😐 Normal", "low" to "😕 Bajón", "sad" to "😢 Triste", "angry" to "😠 Enojo", "anxious" to "😰 Ansiedad", "tired" to "😴 Cansancio"))
        }
        val chips = Ui.chipRow(this, col)
        val buttons = mutableListOf<Button>()
        for ((id, label) in moods) {
            val b = Ui.chip(this, label) { btn ->
                mood = if (mood == id) null else id
                buttons.forEach { Ui.setChipOn(it, it == btn && mood == id) }
            }
            buttons.add(b)
            chips.addView(b)
        }
        col.addView(Ui.spacer(this, 12))

        val actions = Ui.row(this)
        actions.addView(Ui.button(this, "Cancelar") { finish() })
        val save = Ui.button(this, "Guardar", primary = true) {
            val t = text.text.toString().trim()
            if (t.isEmpty()) {
                text.error = "Escribe algo"
                return@button
            }
            val data = JSONObject().put("text", t)
            mood?.let { data.put("mood", it) }
            Store.enqueue(this, "journal", data)
            SyncWorker.now(this)
            Toast.makeText(this, "📓 Guardado en tu Diario", Toast.LENGTH_SHORT).show()
            finish()
        }
        save.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = Ui.dp(this@JournalActivity, 8) }
        actions.addView(save)
        col.addView(actions)

        setContentView(ScrollView(this).apply { addView(col) })
        Ui.focus(this, text)
    }
}

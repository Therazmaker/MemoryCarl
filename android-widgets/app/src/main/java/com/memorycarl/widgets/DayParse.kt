package com.memorycarl.widgets

/**
 * "Cuéntame tu día": convierte lo que cuentas en números de la Bitácora 1–10.
 *
 * Gemma (el modelo local) lee el texto y propone; si no hay modelo o se confunde, unas reglas simples
 * sacan los números que dijiste tal cual ("estrés 8", "6 vasos de agua"). Lo que dices explícito
 * siempre gana. Al final tú revisas todo antes de guardar.
 *
 * Kotlin puro (sin Android) para poder probarlo.
 */
object DayParse {
    /** Las escalas que se marcan a mano en la Bitácora (mismos ids que la app web). */
    data class Scale(val id: String, val label: String, val emoji: String, val key: String, val hint: String, val words: List<String>)

    val SCALES = listOf(
        Scale("energy", "Energía", "⚡", "energia", "1 = sin fuerzas, 10 = a tope", listOf("energia", "energía")),
        Scale("stress", "Estrés", "😰", "estres", "1 = en calma, 10 = a reventar", listOf("estres", "estrés", "ansiedad", "estresado")),
        Scale("focus", "Enfoque", "🎯", "enfoque", "1 = disperso, 10 = muy concentrado", listOf("enfoque", "concentracion", "concentración", "foco")),
        Scale("food", "Comida", "🍽️", "comida", "1 = comí muy mal, 10 = comí muy bien", listOf("comida", "alimentacion", "alimentación")),
        Scale("water", "Agua", "💧", "agua", "número de vasos de agua (10 o más = 10)", listOf("agua")),
        Scale("body", "Dolor", "🤕", "dolor", "1 = nada de dolor, 10 = mucho dolor", listOf("dolor")),
    )

    data class Result(val values: Map<String, Int>, val summary: String, val fromModel: Boolean)

    private const val MAX_INPUT = 1500

    /** La pregunta para Gemma (con su formato de conversación). */
    fun prompt(text: String): String {
        val clean = text.replace("\"", "'").trim().take(MAX_INPUT)
        val scales = SCALES.joinToString("\n") { "${it.key}: ${it.hint}" }
        return """<start_of_turn>user
Lee lo que una persona contó de su día y ponle un número del 1 al 10 a cada cosa, SOLO si lo menciona o se deduce con claridad. Si no se sabe, escribe "-". No inventes.
$scales
resumen: una frase corta de cómo fue el día

Ejemplo:
Texto: "Dormí poco y estoy muerto. El trabajo me tiene loco, pero almorcé rico. Me duele la cabeza."
energia: 3
estres: 8
enfoque: -
comida: 7
agua: -
dolor: 6
resumen: Día cansado y estresante, con dolor de cabeza.

Texto: "$clean"<end_of_turn>
<start_of_turn>model
"""
    }

    private val LINE = Regex("""^\s*[-*•]?\s*(energ[ií]a|estr[eé]s|enfoque|comida|agua|dolor|resumen)\s*[:=]\s*(.*)$""", RegexOption.IGNORE_CASE)

    private fun keyToId(k: String): String? {
        val n = k.lowercase().replace("í", "i").replace("é", "e")
        return when (n) {
            "energia" -> "energy"
            "estres" -> "stress"
            "enfoque" -> "focus"
            "comida" -> "food"
            "agua" -> "water"
            "dolor" -> "body"
            "resumen" -> "summary"
            else -> null
        }
    }

    /** Lee la respuesta de Gemma ("estres: 8" por línea). Ignora lo que invente después. */
    fun parseModel(raw: String): Result {
        val values = linkedMapOf<String, Int>()
        var summary = ""
        for (line in raw.replace("<end_of_turn>", "\n").lines()) {
            // Si empieza a inventar otro ejemplo, se corta ahí
            if ((values.isNotEmpty() || summary.isNotEmpty()) && line.trim().startsWith("Texto", ignoreCase = true)) break
            val m = LINE.find(line) ?: continue
            val id = keyToId(m.groupValues[1]) ?: continue
            val v = m.groupValues[2].trim().trim('"', '*')
            if (id == "summary") {
                if (summary.isEmpty() && v != "-") summary = v.take(200)
                continue
            }
            if (values.containsKey(id)) continue
            val n = Regex("""\d{1,2}""").find(v)?.value?.toIntOrNull() ?: continue
            if (n < 1) continue
            values[id] = n.coerceAtMost(10)
        }
        return Result(values, summary, fromModel = true)
    }

    /** Números dichos tal cual: "estrés 8", "estrés en 8", "energía: 3/10", "6 vasos de agua". */
    fun parseRules(text: String): Map<String, Int> {
        val t = text.lowercase()
        val out = linkedMapOf<String, Int>()
        Regex("""(\d{1,2})\s*vasos?""").find(t)?.groupValues?.get(1)?.toIntOrNull()?.let { if (it >= 1) out["water"] = it.coerceAtMost(10) }
        for (s in SCALES) {
            if (out.containsKey(s.id)) continue
            for (w in s.words) {
                val m = Regex("""${Regex.escape(w)}\w*\s*(?:en|de|:|=|como)?\s*(?:un|una)?\s*(\d{1,2})(?:\s*/\s*10)?\b""").find(t) ?: continue
                val n = m.groupValues[1].toIntOrNull() ?: continue
                if (n in 1..10) {
                    out[s.id] = n
                    break
                }
            }
        }
        return out
    }

    /** Junta lo de Gemma con lo dicho tal cual (lo explícito gana). */
    fun merge(model: Result?, text: String): Result {
        val rules = parseRules(text)
        val values = linkedMapOf<String, Int>()
        model?.values?.forEach { (k, v) -> values[k] = v }
        rules.forEach { (k, v) -> values[k] = v }
        return Result(values, model?.summary ?: "", fromModel = model != null)
    }
}

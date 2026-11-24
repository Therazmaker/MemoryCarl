package com.memorycarl.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Cuéntame tu día": leer a Gemma y los números dichos tal cual (datos inventados). */
class DayParseTest {
    @Test
    fun leeLaRespuestaDeGemmaYCortaSiInventaOtroEjemplo() {
        val raw = """
            energia: 4
            estrés: 9
            enfoque: -
            comida: 6/10
            agua: 12
            dolor: -
            resumen: Día pesado en el trabajo, poca energía.

            Texto: "Otro día inventado"
            energia: 10
        """.trimIndent()
        val r = DayParse.parseModel(raw)
        assertEquals(mapOf("energy" to 4, "stress" to 9, "food" to 6, "water" to 10), r.values)
        assertEquals("Día pesado en el trabajo, poca energía.", r.summary)
    }

    @Test
    fun respuestaSinFormatoNoRompeNada() {
        val r = DayParse.parseModel("No puedo saberlo con lo que contaste.")
        assertTrue(r.values.isEmpty())
        assertEquals("", r.summary)
    }

    @Test
    fun reglasSacanLosNumerosDichosTalCual() {
        val r = DayParse.parseRules("Hoy el estrés en 8, energía: 3/10, tomé 6 vasos de agua y dolor de 2")
        assertEquals(mapOf("water" to 6, "energy" to 3, "stress" to 8, "body" to 2), r)
        assertTrue(DayParse.parseRules("Me fue bien, nada más").isEmpty())
        assertTrue("fuera de rango no cuenta", DayParse.parseRules("estrés 15").isEmpty())
    }

    @Test
    fun loDichoTalCualGanaALoQueDeduceGemma() {
        val model = DayParse.Result(mapOf("stress" to 5, "food" to 7), "Día normal", fromModel = true)
        val r = DayParse.merge(model, "estrés 9 la verdad")
        assertEquals(mapOf("stress" to 9, "food" to 7), r.values)
        assertEquals("Día normal", r.summary)
        assertEquals(mapOf("stress" to 9), DayParse.merge(null, "estrés 9").values)
    }

    @Test
    fun laPreguntaLlevaElTextoYElFormatoDeGemma() {
        val p = DayParse.prompt("Hoy dije \"basta\"")
        assertTrue(p.startsWith("<start_of_turn>user"))
        assertTrue(p.trimEnd().endsWith("<start_of_turn>model"))
        assertTrue(p.contains("Texto: \"Hoy dije 'basta'\""))
    }
}

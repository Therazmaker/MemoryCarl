/**
 * carlTools.js — Herramientas con las que Carl busca en la historia del usuario
 * MemoryCarl / NeuroChat
 *
 * Carl (Claude) decide cuándo usarlas. La búsqueda corre en el teléfono (lifeSearch.js),
 * así que solo se paga por el texto que Carl lee de vuelta.
 */

import { searchMemories, readMemory, searchNeurons, memoryTimeline } from "../memory/lifeSearch.js";

export const CARL_TOOL_LIMITS = { maxRounds: 4, maxCallsPerTurn: 8 };

const dateProp = (desc) => ({ type: "string", description: `${desc}: AAAA, AAAA-MM o AAAA-MM-DD. Opcional.` });

export const CARL_TOOLS = [
  {
    name: "buscar_memorias",
    description:
      "Busca en las memorias del usuario: entradas de su diario (incluye un diario antiguo de 2022-2025) y momentos guardados desde el chat. " +
      "Úsala cuando el usuario mencione algo del pasado, una persona, un lugar o un tema recurrente, pregunte '¿te acuerdas…?', " +
      "o cuando te falte contexto para entender lo que dice. La búsqueda es por palabras: prueba sinónimos o nombres si no encuentras nada. " +
      "Sin consulta, devuelve las memorias de un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Palabras a buscar, por ejemplo 'entrevista trabajo' o 'Lucas cumpleaños'." },
        desde: dateProp("Fecha mínima"),
        hasta: dateProp("Fecha máxima"),
        limite: { type: "integer", description: "Cuántas devolver, 1 a 10. Por defecto 6." },
      },
    },
  },
  {
    name: "leer_memoria",
    description: "Lee el texto completo de una memoria encontrada con buscar_memorias, cuando el fragmento no alcanza.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "El id de la memoria." } },
      required: ["id"],
    },
  },
  {
    name: "buscar_neuronas",
    description:
      "Busca en el grafo de neuronas del usuario (personas, patrones, creencias, hábitos, etapas) y muestra con qué está conectada cada una. " +
      "Úsala para entender quién es alguien o qué patrón se repite.",
    input_schema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Nombre o tema, por ejemplo 'hermano' o 'deudas'." },
        limite: { type: "integer", description: "Cuántas devolver, 1 a 10. Por defecto 6." },
      },
      required: ["consulta"],
    },
  },
  {
    name: "linea_de_tiempo",
    description:
      "Mapa de la vida del usuario: cuántas memorias hay por mes o año (de un tema, si se indica), sus etiquetas más repetidas, " +
      "emociones y algunos títulos. Úsala para ver etapas, cuándo empezó o terminó algo y patrones a lo largo del tiempo.",
    input_schema: {
      type: "object",
      properties: {
        tema: { type: "string", description: "Tema a seguir en el tiempo. Opcional." },
        desde: dateProp("Desde"),
        hasta: dateProp("Hasta"),
        agrupar: { type: "string", enum: ["month", "year"], description: "Por mes o por año. Por defecto mes." },
      },
    },
  },
];

const clampInt = (v, lo, hi, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const dateOrEmpty = (v) => (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v || "")) ? String(v) : "");

/** Texto corto para mostrar al usuario qué buscó Carl. */
export function describeToolCall(name, input = {}) {
  const range = [input.desde, input.hasta].filter(Boolean).join(" → ");
  switch (name) {
    case "buscar_memorias": return `Buscó en tus memorias${input.consulta ? `: “${input.consulta}”` : ""}${range ? ` (${range})` : ""}`;
    case "leer_memoria": return "Leyó una memoria completa";
    case "buscar_neuronas": return `Buscó en tu grafo: “${input.consulta || ""}”`;
    case "linea_de_tiempo": return `Revisó tu línea de tiempo${input.tema ? `: “${input.tema}”` : ""}${range ? ` (${range})` : ""}`;
    default: return name;
  }
}

/**
 * Ejecuta una herramienta. data = { memories, neurons }.
 * Devuelve { content: string (JSON para Claude), summary: { label, count, ids } }.
 */
export function runCarlTool(name, input = {}, data = {}) {
  const memories = Array.isArray(data.memories) ? data.memories : [];
  const neurons = Array.isArray(data.neurons) ? data.neurons : [];
  const label = describeToolCall(name, input);
  try {
    if (name === "buscar_memorias") {
      const res = searchMemories(memories, {
        query: String(input.consulta || ""),
        from: dateOrEmpty(input.desde),
        to: dateOrEmpty(input.hasta),
        limit: clampInt(input.limite, 1, 10, 6),
      }, neurons);
      return {
        content: JSON.stringify(res.length ? { resultados: res } : { resultados: [], nota: "Nada encontrado. Prueba otras palabras, un nombre o quita el filtro de fechas." }),
        summary: { label, count: res.length, ids: res.map((r) => r.id) },
      };
    }
    if (name === "leer_memoria") {
      const m = readMemory(memories, String(input.id || ""));
      return { content: JSON.stringify(m || { error: "No existe una memoria con ese id." }), summary: { label, count: m ? 1 : 0, ids: m ? [m.id] : [] } };
    }
    if (name === "buscar_neuronas") {
      const res = searchNeurons(neurons, { query: String(input.consulta || ""), limit: clampInt(input.limite, 1, 10, 6) });
      return { content: JSON.stringify({ resultados: res }), summary: { label, count: res.length, ids: [] } };
    }
    if (name === "linea_de_tiempo") {
      const res = memoryTimeline(memories, {
        query: String(input.tema || ""),
        from: dateOrEmpty(input.desde),
        to: dateOrEmpty(input.hasta),
        by: input.agrupar === "year" ? "year" : "month",
      });
      const total = res.reduce((s, b) => s + b.count, 0);
      return { content: JSON.stringify({ total, periodos: res.slice(-36) }), summary: { label, count: total, ids: [] } };
    }
    return { content: JSON.stringify({ error: `Herramienta desconocida: ${name}` }), summary: { label, count: 0, ids: [] }, isError: true };
  } catch (err) {
    return { content: JSON.stringify({ error: err?.message || "Error en la búsqueda" }), summary: { label, count: 0, ids: [] }, isError: true };
  }
}

export const CARL_TOOLS_PROMPT = `

## TU MEMORIA LARGA (herramientas)
Tienes herramientas para buscar en la historia del usuario: buscar_memorias, leer_memoria, buscar_neuronas y linea_de_tiempo.
- Úsalas cuando lo que dice el usuario toque su pasado, una persona, un patrón o algo que no está en el contexto de arriba. No las uses para charla trivial.
- Busca antes de pedirle que te explique algo que podría estar en sus memorias: la idea es que no tenga que repetirte el contexto.
- Varias búsquedas cortas funcionan mejor que una larga; si no encuentras, prueba sinónimos, el nombre de la persona o un rango de fechas.
- Las memorias del diario antiguo son PASADO: menciónalas con su fecha ("en marzo de 2024 escribiste…"), no como si pasaran hoy.
- Si ves un patrón que se repite en el tiempo, dilo con ejemplos concretos y fechas, y sin juzgar.
- Después de buscar, responde normalmente y mantén el formato de siempre (incluido el bloque ---NEURON_ACTIONS--- al final).`;

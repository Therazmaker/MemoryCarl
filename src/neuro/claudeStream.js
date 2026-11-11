/**
 * claudeStream.js — Lectura del stream SSE de la API de mensajes de Claude y mensajes
 * de error entendibles. Sin dependencias (se puede probar en Node).
 * MemoryCarl / NeuroChat
 */

export class RepairError extends Error {}

/** Traduce errores de la API a mensajes entendibles. */
export function friendlyApiError(status, message = "") {
  const m = String(message || "");
  if (status === 401) return "La API key de Claude no es válida. Revísala en Ajustes de NeuroChat.";
  if (status === 403) return "La API key no tiene permiso para usar este modelo.";
  if (status === 404) return "El modelo no está disponible para tu cuenta.";
  if (status === 413) return "El grafo es demasiado grande para enviarlo de una vez.";
  if (status === 429) return "Claude está recibiendo demasiadas solicitudes. Espera un minuto y vuelve a intentar.";
  if (status === 529 || status === 503) return "Claude está saturado en este momento. Intenta de nuevo en unos minutos.";
  if (status >= 500) return "Claude tuvo un error interno. Intenta de nuevo.";
  if (/credit|billing|balance/i.test(m)) return "Tu cuenta de Anthropic no tiene saldo disponible.";
  return m ? `Claude rechazó la solicitud: ${m}` : `Error HTTP ${status}`;
}

/**
 * Lee un stream SSE de la API de mensajes. Devuelve { text, stopReason }.
 * Exportada para las pruebas.
 */
export async function readMessageStream(body, { onActivity = () => {}, signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;
  const blockTypes = new Map();

  const handle = (raw) => {
    const dataLines = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    if (!dataLines.length) return;
    let ev;
    try { ev = JSON.parse(dataLines.join("\n")); } catch (_e) { return; }
    switch (ev.type) {
      case "message_start":
        // Un reintento del servidor (fallback) empieza un mensaje nuevo: se descarta lo anterior
        text = "";
        blockTypes.clear();
        break;
      case "content_block_start":
        blockTypes.set(ev.index, ev.content_block?.type);
        if (ev.content_block?.type === "text" && ev.content_block.text) text += ev.content_block.text;
        break;
      case "content_block_delta":
        if (ev.delta?.type === "text_delta" && blockTypes.get(ev.index) !== "thinking") {
          text += ev.delta.text || "";
          onActivity("writing", text.length);
        } else {
          onActivity("thinking", text.length);
        }
        break;
      case "message_delta":
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        break;
      case "error":
        throw new RepairError(friendlyApiError(ev.error?.type === "overloaded_error" ? 529 : 500, ev.error?.message));
      default:
        break;
    }
  };

  for (;;) {
    if (signal?.aborted) throw new RepairError("Se canceló el análisis.");
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handle(chunk);
    }
  }
  if (buffer.trim()) handle(buffer);
  return { text, stopReason };
}


/**
 * Parsea e intenta reparar respuestas JSON de LLMs que tengan comas finales
 * o estén truncadas por límite de tokens.
 */
export function safeParseJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Respuesta vacía o no válida.");
  }

  let cleaned = text.trim();

  // Quitar bloques de código Markdown ```json ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Ubicar delimitadores de JSON principal
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else {
      cleaned = cleaned.substring(firstBrace);
    }
  }

  const removeTrailingCommas = (str) => str.replace(/,\s*([\}\]])/g, "$1");

  // Intento 1: Parseo directo limpiando comas sobrantes
  try {
    return JSON.parse(removeTrailingCommas(cleaned));
  } catch (err1) {
    // Intento 2: Reparación de JSON truncado por límite de tokens
    const repaired = repairTruncatedJSON(removeTrailingCommas(cleaned));
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (_) {}
    }
    throw new Error(`Error parseando respuesta JSON de Claude: ${err1.message}`);
  }
}

/**
 * Reconstruye estructuras JSON truncadas intentando cerrar comillas, llaves y corchetes pendientes.
 */
export function repairTruncatedJSON(jsonStr) {
  let str = jsonStr.trim();

  // Cerrar comilla si quedó a mitad de un string
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = char === "\\" && !escaped;
  }
  if (inString) {
    str += '"';
  }

  // Eliminar coma o propiedad incompleta al final
  str = str.replace(/,\s*$/, "");
  str = str.replace(/,\s*"[^"]*"?\s*:?\s*$/, "");

  // Balancear llaves y corchetes
  const stack = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = char === "\\" && !escaped;

    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" && stack[stack.length - 1] === "{") {
        stack.pop();
      } else if (char === "]" && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === "{") str += "}";
    if (last === "[") str += "]";
  }

  return str;
}

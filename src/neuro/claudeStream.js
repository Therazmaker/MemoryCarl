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


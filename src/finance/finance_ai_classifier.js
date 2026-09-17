import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const VALID_LABELS = [
  "fixed_obligation",
  "mobility",
  "maintenance",
  "silent_leak_candidate",
  "debt_related",
  "micro_outflow"
];

const SYSTEM_PROMPT = "Eres un clasificador de movimientos financieros personales en soles peruanos (PEN). Tu unica tarea es devolver un objeto JSON con la clasificacion de UN movimiento. Reglas estrictas: Responde SOLO con JSON valido. Sin texto antes ni despues. Sin backticks. Sin explicaciones. El campo derivedLabels SOLO puede contener valores de esta lista cerrada: " + JSON.stringify(VALID_LABELS) + ". Si ninguna etiqueta aplica, devuelve derivedLabels como array vacio. NO inventes etiquetas nuevas. isEssential es true si el gasto es una obligacion fija o de mantenimiento basico (vivienda, servicios, alimentacion, salud), false en cualquier otro caso. isRecurring es true solo si el gasto se repite mensualmente de forma predecible (alquiler, servicios, suscripciones), false para gastos puntuales o variables. isDebtRelated es true solo si el movimiento esta directamente relacionado a pagar o generar una deuda (prestamo, tarjeta de credito, cuota de credito), false en cualquier otro caso. No agregues campos que no se pidan. No cambies los nombres de los campos. No agregues comentarios dentro del JSON. Formato de salida exacto y unico: {isEssential: boolean, isRecurring: boolean, isDebtRelated: boolean, derivedLabels: string[]}";

function buildUserPrompt(datos) {
  var category = datos.category;
  var note = datos.note;
  var amount = datos.amount;
  var direction = datos.direction;
  return "Movimiento a clasificar: categoria: " + (category || "") + ". nota: " + (note || "") + ". monto: " + amount + ". tipo: " + direction + " (income = ingreso, expense = gasto, debt = deuda). Devuelve solo el JSON pedido.";
}

function isShapeValid(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.isEssential !== "boolean") return false;
  if (typeof obj.isRecurring !== "boolean") return false;
  if (typeof obj.isDebtRelated !== "boolean") return false;
  if (!Array.isArray(obj.derivedLabels)) return false;
  if (!obj.derivedLabels.every(function(l){ return VALID_LABELS.includes(l); })) return false;
  return true;
}

export async function classifyMovementWithAI(datos) {
  if (!isOllamaConfigured()) return null;

  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function(){ controller.abort(); }, 8000);

    var res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.apiKey
      },
      body: JSON.stringify({
        model: settings.model || "gpt-oss:120b",
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(datos) }
        ],
        options: {
          temperature: 0.3
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    var json = await res.json();
    var rawContent = (json && json.message && json.message.content) || (json && json.content) || "";
    var parsed = JSON.parse(rawContent);

    if (!isShapeValid(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const VALID_LABELS = [
  "fixed_obligation",
  "mobility",
  "maintenance",
  "silent_leak_candidate",
  "debt_related",
  "micro_outflow"
];

const VALID_CONTEXTS = ["urgencia", "planificado", "inversion", "ocio"];
const VALID_DEBT_DIRECTIONS = ["presto_yo", "me_prestan"];

const SYSTEM_PROMPT = "Eres un clasificador de movimientos financieros personales en soles peruanos (PEN). Tu unica tarea es devolver un objeto JSON con la clasificacion de UN movimiento. Reglas estrictas: Responde SOLO con JSON valido. Sin texto antes ni despues. Sin backticks. Sin explicaciones. El campo derivedLabels SOLO puede contener valores de esta lista cerrada: " + JSON.stringify(VALID_LABELS) + ". Si ninguna etiqueta aplica, devuelve derivedLabels como array vacio. NO inventes etiquetas nuevas. isEssential es true si el gasto es una obligacion fija o de mantenimiento basico (vivienda, servicios, alimentacion, salud), false en cualquier otro caso. isRecurring es true solo si el gasto se repite mensualmente de forma predecible (alquiler, servicios, suscripciones), false para gastos puntuales o variables. isDebtRelated es true solo si el movimiento esta directamente relacionado a pagar o generar una deuda (prestamo, tarjeta de credito, cuota de credito), false en cualquier otro caso. counterparty: el nombre propio de la persona involucrada, tal como aparece en el texto. Si el texto no menciona a ninguna persona, devuelve null. NO inventes nombres. NO uses roles genericos como 'amigo' o 'familiar' si no hay un nombre propio: en ese caso devuelve null. debtDirection: solo uno de estos dos valores exactos: 'presto_yo' (el usuario le presto dinero a alguien y espera que se lo devuelvan) o 'me_prestan' (alguien le presto dinero al usuario, o el usuario esta pagando una deuda). Si el movimiento no es una deuda entre personas, devuelve null. context: solo uno de estos valores exactos: 'urgencia', 'planificado', 'inversion', 'ocio'. Si ninguno aplica claramente, devuelve null. No fuerces un valor. sourceRef: una descripcion corta (2-5 palabras) de donde salio el dinero de este movimiento, SOLO si el texto lo menciona explicitamente (ej. 'con lo de Jhon', 'del sueldo', 'de la venta de pantalones', 'del extra del sabado'). Si el texto no menciona el origen del dinero, devuelve null. NO inventes un origen. sourceRef solo aplica a gastos (direction expense); si direction es income o el texto no da esa informacion, devuelve null. Si un dato no esta en el texto, el valor correcto es null. Devolver null es preferible a adivinar. Formato de salida exacto y unico: {\"isEssential\": boolean, \"isRecurring\": boolean, \"isDebtRelated\": boolean, \"derivedLabels\": string[], \"counterparty\": string|null, \"debtDirection\": string|null, \"context\": string|null, \"sourceRef\": string|null}";

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
  // New fields — null or undefined is acceptable; wrong type/value is not
  if (obj.counterparty != null && typeof obj.counterparty !== "string") return false;
  if (obj.debtDirection != null && !VALID_DEBT_DIRECTIONS.includes(obj.debtDirection)) return false;
  if (obj.context != null && !VALID_CONTEXTS.includes(obj.context)) return false;
  if (obj.sourceRef != null && typeof obj.sourceRef !== "string") return false;
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

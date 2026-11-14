/**
 * basketBrain.js — El cerebro de La Canasta (IA: Claude, y Gemini de respaldo)
 * MemoryCarl · Compras
 *
 * Cada mensaje del chat lo entiende una IA con el contexto real: la biblioteca (nombres,
 * precios, unidades), el ritmo de compra, el dinero hasta el cobro, las rutinas y la
 * conversación reciente. La IA devuelve JSON con la intención y los datos ya interpretados;
 * la app arma con eso las tarjetas de siempre (lista, compra, ¿me alcanza?, rutina).
 * Si no hay clave o la IA falla, se usan las reglas locales.
 */

export const BRAIN_INTENTS = ["compra", "lista", "me_alcanza", "rutina", "pregunta"];
const MEALS = ["desayuno", "almuerzo", "cena", "snack_trabajo", "merienda_ninos", "otro"];

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null; };
const str = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const money = (n) => `S/ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

/** Contexto compacto para la IA. */
export function brainContext({ products = [], rhythm = new Map(), runway = null, routines = [], chat = [], now = new Date() } = {}) {
  const lib = (products || []).filter((p) => p && p.name).slice(0, 400)
    .map((p) => `${p.id}|${str(p.name, 60)}|${Number(p.price) || 0}|${/kg|kilo/i.test(String(p.unit || "")) ? "kg" : (p.unit || "u")}|${str(p.category, 30)}`).join("\n");
  const due = [...(rhythm?.values?.() || [])].filter((s) => s.intervalDays).sort((a, b) => (a.dueInDays ?? 99) - (b.dueInDays ?? 99)).slice(0, 25)
    .map((s) => `${s.name}: cada ~${s.intervalDays} días, última hace ${s.daysSince} días${s.dueInDays <= 0 ? " (ya toca)" : ""}`).join("\n");
  const rw = runway
    ? `Caja ${money(runway.cash)}; próximo cobro ${runway.payday?.label} (faltan ${runway.payday?.daysLeft} días); pagos antes del cobro ${money(runway.pending)}; libre ${money(runway.free)}; comida de casa hasta el cobro ~${money(runway.homeFoodNeed)}; rutinas apartadas ${money(runway.routine?.total)}; extra para lo demás ${money(runway.extra)}.`
    : "Sin datos de Finanzas.";
  const rt = (routines || []).map((r) => `${r.name} ${money(r.price)} × ${r.qty} (${(r.days || []).join(",")})`).join("; ");
  const recent = (chat || []).slice(-8).map((m) => `${m.role === "user" ? "Usuario" : "Carl"}: ${str(m.text || (m.type === "analysis" ? "[tarjeta de lista]" : m.type === "check" ? "[tarjeta ¿me alcanza?]" : ""), 200)}`).filter((l) => !/: $/.test(l)).join("\n");
  const pad = (n) => String(n).padStart(2, "0");
  return [
    `Hoy: ${DOW[now.getDay()]} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}. Moneda: soles (S/), Perú.`,
    `Dinero: ${rw}`,
    rt ? `Rutinas protegidas (no se cuestionan): ${rt}` : "",
    `Biblioteca de productos (id|nombre|precio|unidad|categoría; si la unidad es kg el precio es por kg):\n${lib || "(vacía)"}`,
    due ? `Ritmo de compra aprendido:\n${due}` : "",
    recent ? `Conversación reciente:\n${recent}` : "",
  ].filter(Boolean).join("\n\n");
}

export const BRAIN_SYSTEM = `Eres Carl, el asistente de compras de una familia en Perú (compran él y su pareja Fergis). Entiendes CUALQUIER forma de escribir: listas pegadas, frases, mensajes de WhatsApp, abreviaturas, errores de ortografía. Tu trabajo: entender qué quiso decir y devolver SOLO un JSON válido (sin markdown) con esta forma:

{
  "intent": "compra" | "lista" | "me_alcanza" | "rutina" | "pregunta",
  "items": [{ "name": "texto", "productId": "id de la biblioteca o null", "qty": número, "unit": "u" | "kg" | "g" | "l" | "ml" | "paq", "price": número o null, "paid": número o null }],
  "buyer": "yo" | "fergis" | null,
  "store": "texto" | null,
  "spend": { "amount": número, "desc": "texto", "mealType": "desayuno" | "almuerzo" | "cena" | "snack_trabajo" | "merienda_ninos" | "otro", "who": "yo" | "fergis" } | null,
  "routine": [{ "name": "texto", "price": número, "qty": número, "days": "lun-vie" | "todos" | "fines" }] | null,
  "reply": "respuesta corta y útil para el usuario"
}

Intenciones:
- "compra": ya compró (compré, traje, me costó, pagué, una boleta pegada…). Pon cada producto en items.
- "lista": lo que piensan comprar (lista de Fergis, "hay que comprar…").
- "me_alcanza": quiere gastar en comida/bebida fuera o un antojo y saber si le alcanza (voy a comprar almuerzo, quiero pedir pollo…). Llena spend con el TOTAL.
- "rutina": algo que compra siempre y quiere proteger (mis bebidas del trabajo de lunes a viernes…).
- "pregunta": cualquier otra cosa (qué toca comprar, cuánto llevamos, consejos, comparar precios…). Responde en reply usando los datos.

Reglas para items:
- Un número después del producto suele ser el PRECIO ("Pepsi 5.5" = S/ 5.50), salvo que tenga unidad ("arroz 2kg" = 2 kg) o sea claramente cantidad ("huevos x12", "3 leches").
- "price" es el precio por unidad (o por kg si es por peso). "paid" es lo que se pagó por toda la línea.
- "1 sol de pan" = paid 1. "2 leches a 4.20" = qty 2, price 4.20.
- Si el producto está en la biblioteca, pon su productId (busca por significado: "coca" puede ser "Coca-Cola 3L", "palta" = "aguacate") y usa como name el nombre de la biblioteca.
- Para productos que en la biblioteca son por kg y solo dicen cuánto se pagó, pon paid y deja qty en null.
- NUNCA inventes precios: si no se dijo y no está en la biblioteca, price null.
- Limpia los nombres (sin "compré", "un", "a").

Para reply (máximo 3 líneas, español peruano natural, sin sermones):
- En compra/lista: resume el total, y avisa si algún precio está muy distinto al de la biblioteca o si falta algo que ya toca según el ritmo.
- En me_alcanza: no decidas por el usuario; di en una línea cómo queda el dinero hasta el cobro con ese gasto.
- Las rutinas nunca se cuestionan.
- No preguntes datos que ya están en el contexto.`;

/** Lee y valida la respuesta de la IA. Devuelve null si no sirve. */
export function parseBrainReply(raw) {
  let text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch (_e) { return null; }
  if (!j || typeof j !== "object") return null;
  const intent = BRAIN_INTENTS.includes(j.intent) ? j.intent : "pregunta";
  const items = (Array.isArray(j.items) ? j.items : []).map((it) => ({
    name: str(it?.name, 80),
    productId: it?.productId ? String(it.productId) : null,
    qty: num(it?.qty),
    unit: ["u", "kg", "g", "l", "ml", "paq"].includes(it?.unit) ? it.unit : "",
    price: num(it?.price),
    paid: num(it?.paid),
  })).filter((it) => it.name);
  const sp = j.spend && typeof j.spend === "object" ? j.spend : null;
  const spend = sp && num(sp.amount) ? {
    amount: num(sp.amount),
    desc: str(sp.desc, 80),
    mealType: MEALS.includes(sp.mealType) ? sp.mealType : "otro",
    who: sp.who === "fergis" ? "fergis" : "yo",
  } : null;
  const DAYS = { "lun-vie": [1, 2, 3, 4, 5], todos: [0, 1, 2, 3, 4, 5, 6], fines: [0, 6] };
  const routine = (Array.isArray(j.routine) ? j.routine : []).map((r) => ({
    name: str(r?.name, 60), price: num(r?.price) || 0, qty: Math.max(1, Math.round(num(r?.qty) || 1)), days: DAYS[r?.days] || DAYS["lun-vie"],
  })).filter((r) => r.name && r.price > 0);
  return {
    intent,
    items,
    buyer: j.buyer === "fergis" ? "fergis" : j.buyer === "yo" ? "yo" : null,
    store: j.store ? str(j.store, 40) : null,
    spend,
    routine,
    reply: str(j.reply, 600),
  };
}

/**
 * Pasa los items de la IA al formato que entiende analyzeList.
 * analyzeList: para productos por kg el "price" escrito es lo pagado; para el resto, precio por unidad.
 */
export function brainItemsToParsed(items = [], products = []) {
  const byId = new Map((products || []).filter((p) => p && p.id).map((p) => [String(p.id), p]));
  return items.map((it) => {
    const prod = it.productId ? byId.get(String(it.productId)) : null;
    const weighed = prod ? /kg|kilo/i.test(String(prod.unit || "")) : (it.unit === "kg" || it.unit === "g");
    const name = prod ? prod.name : it.name;
    let qty = it.qty;
    let unit = it.unit === "u" ? "" : it.unit;
    let price = null;
    if (weighed) {
      price = it.paid || (it.price && it.qty ? Math.round(it.price * it.qty * 100) / 100 : null);
      if (unit !== "kg" && unit !== "g") { qty = null; unit = ""; }
    } else {
      price = it.price || (it.paid ? Math.round((it.paid / (it.qty || 1)) * 100) / 100 : null);
      if (unit === "kg" || unit === "g") unit = ""; // no es por peso en la biblioteca
    }
    return { raw: it.name, name, qty: qty || null, unit: unit || "", ...(price ? { price } : {}) };
  });
}

/** Llama a Gemini pidiendo JSON. */
async function geminiJson({ system, user, apiKey, model = "gemini-2.5-flash", fetchImpl = fetch, timeoutMs = 30000 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${String(apiKey).trim()}`;
  const generationConfig = { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" };
  if (/gemini-2\.5/i.test(model)) generationConfig.thinkingConfig = { thinkingBudget: /pro/i.test(model) ? 1024 : 512 };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const j = await res.json();
    return (j?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  } finally { clearTimeout(t); }
}

/**
 * Entiende un mensaje con IA. Prueba Claude y luego Gemini.
 * @param {{ text: string, context: string, claude?: {apiKey, model}, gemini?: {apiKey, model}, callClaude?: Function, fetchImpl?: Function }} o
 * @returns {Promise<{ result: object|null, provider: string|null, error: string|null }>}
 */
export async function askBrain({ text, context, claude = {}, gemini = {}, callClaude, fetchImpl }) {
  const system = `${BRAIN_SYSTEM}\n\n=== CONTEXTO ===\n${context}`;
  const tries = [];
  if (claude.apiKey && typeof callClaude === "function") {
    tries.push(["Claude", async () => callClaude([{ role: "system", content: system }, { role: "user", content: text }], claude.apiKey, claude.model)]);
  }
  if (gemini.apiKey) {
    tries.push(["Gemini", async () => geminiJson({ system, user: text, apiKey: gemini.apiKey, model: gemini.model || "gemini-2.5-flash", fetchImpl: fetchImpl || fetch })]);
  }
  if (!tries.length) return { result: null, provider: null, error: "sin clave de IA" };
  let lastErr = null;
  for (const [name, run] of tries) {
    try {
      const out = await run();
      const parsed = parseBrainReply(out);
      if (parsed) return { result: parsed, provider: name, error: null };
      lastErr = `${name} no devolvió un JSON válido`;
    } catch (e) {
      lastErr = `${name}: ${e?.message || e}`;
    }
  }
  return { result: null, provider: null, error: lastErr };
}

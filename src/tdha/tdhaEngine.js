/**
 * tdhaEngine.js — Qué me regula y qué me desregula
 * MemoryCarl · NeuroChat › TDHA
 *
 * No diagnostica nada: registra cómo está la persona (🟢 regulado · 🟡 a medias · 🔴 desregulado),
 * las señales que nota (sed, irritabilidad, ansiedad…) y lo que estuvo presente (activaciones:
 * poco sueño, cafeína, conflicto, ejercicio…). Con el tiempo compara cuándo aparece cada cosa
 * para ver qué tiende a regular y qué a desregular. Lógica pura.
 */

export const STATES = {
  green: { id: "green", emoji: "🟢", label: "Regulado" },
  yellow: { id: "yellow", emoji: "🟡", label: "A medias" },
  red: { id: "red", emoji: "🔴", label: "Desregulado" },
};
const STATE_SCORE = { green: 0, yellow: 1, red: 2 };

// Señales: cómo se nota por dentro / por fuera
export const SIGNALS = [
  { id: "sed", emoji: "💧", label: "Mucha sed", re: /\b(sed|sediento|tomar agua|boca seca)\b/ },
  { id: "irritable", emoji: "😤", label: "Irritable", re: /\b(irritable|irritad[oa]|molest[oa]|me molesta todo|enojad[oa]|de mal humor|rabia|explot[eé])\b/ },
  { id: "ansiedad", emoji: "😰", label: "Ansiedad", re: /\b(ansiedad|ansios[oa]|nervios[oa]|angustia|inquiet[oa]|pecho apretado)\b/ },
  { id: "disperso", emoji: "🌀", label: "Disperso", re: /\b(dispers[oa]|no me concentro|sin foco|distraid[oa]|no puedo concentrarme|mil cosas)\b/ },
  { id: "bloqueo", emoji: "🧱", label: "Me bloqueé", re: /\b(bloquead[oa]|me bloque[eé]|paralizad[oa]|no pude empezar|procrastin)\b/ },
  { id: "impulsivo", emoji: "⚡", label: "Impulsivo", re: /\b(impuls|compr[eé] sin pensar|no me pude aguantar|antojo)\b/ },
  { id: "cansado", emoji: "🥱", label: "Cansado", re: /\b(cansad[oa]|agotad[oa]|sin energia|sin energía|sueño|fatiga)\b/ },
  { id: "acelerado", emoji: "🏃", label: "Acelerado", re: /\b(acelerad[oa]|hiperactiv|no paro|a mil|inquieto el cuerpo)\b/ },
  { id: "triste", emoji: "😔", label: "Bajón", re: /\b(triste|bajon|bajón|desanimad[oa]|sin ganas)\b/ },
  { id: "enfocado", emoji: "🎯", label: "Enfocado", re: /\b(enfocad[oa]|concentrad[oa]|productiv[oa]|fluyendo|en la zona)\b/ },
  { id: "tranquilo", emoji: "😌", label: "Tranquilo", re: /\b(tranquil[oa]|en calma|relajad[oa]|en paz)\b/ },
];

// Activaciones: lo que estuvo presente y puede influir
export const FACTORS = [
  { id: "poco_sueno", emoji: "😴", label: "Dormí poco", re: /\b(dorm[ií] poco|no dorm[ií]|mal dormid[oa]|desvel|insomnio|me acost[eé] tarde)\b/ },
  { id: "cafeina", emoji: "☕", label: "Cafeína / energizante", re: /\b(cafe|café|volt|monster|red bull|energizante|cafeina|cafeína|coca)\b/ },
  { id: "azucar", emoji: "🍬", label: "Mucha azúcar", re: /\b(azucar|azúcar|dulces|chocolate|gaseosa|postre)\b/ },
  { id: "sin_comer", emoji: "🍽️", label: "Comí poco / tarde", re: /\b(no com[ií]|sin comer|com[ií] tarde|saltee? el almuerzo|ayun)\b/ },
  { id: "pantallas", emoji: "📱", label: "Mucha pantalla", re: /\b(celular|pantalla|redes|tiktok|instagram|youtube|scroll)\b/ },
  { id: "ruido", emoji: "🔊", label: "Ruido / mucha gente", re: /\b(ruido|bulla|mucha gente|gritos)\b/ },
  { id: "conflicto", emoji: "⚔️", label: "Discusión / conflicto", re: /\b(discut|pelea|pelie|conflicto|me gritaron|problema con)\b/ },
  { id: "carga", emoji: "📚", label: "Muchas tareas", re: /\b(muchas cosas|mucho trabajo|sobrecargad|tareas|pendientes|deadline|presion|presión)\b/ },
  { id: "plata", emoji: "💸", label: "Preocupación por plata", re: /\b(plata|dinero|deuda|no me alcanza|pagar|cuentas)\b/ },
  { id: "ejercicio", emoji: "🏋️", label: "Ejercicio / caminar", re: /\b(ejercicio|camin[eé]|gym|gimnasio|corr[ií]|entren|bicicleta)\b/ },
  { id: "musica", emoji: "🎧", label: "Música", re: /\b(musica|música|playlist|cancion|canción)\b/ },
  { id: "naturaleza", emoji: "🌳", label: "Aire libre", re: /\b(parque|aire libre|playa|naturaleza|sal[ií] a caminar)\b/ },
  { id: "rutina", emoji: "🗓️", label: "Seguí mi rutina", re: /\b(rutina|orden|plan del dia|planifiqu)\b/ },
  { id: "familia", emoji: "👨‍👩‍👧", label: "Tiempo en familia", re: /\b(familia|hijos|niñ[oa]s|fergis)\b/ },
  { id: "medicacion", emoji: "💊", label: "Medicación", re: /\b(pastilla|medicina|medicacion|medicación|dosis)\b/ },
  // Automáticas (salen de los datos de la app)
  { id: "compra_impulso", emoji: "🛍️", label: "Compra por impulso", auto: true },
  { id: "comida_calle", emoji: "🍔", label: "Comida en la calle", auto: true },
];
const FACTOR_BY_ID = new Map(FACTORS.map((f) => [f.id, f]));
const SIGNAL_BY_ID = new Map(SIGNALS.map((s) => [s.id, s]));
export const factorInfo = (id) => FACTOR_BY_ID.get(id) || { id, emoji: "•", label: id };
export const signalInfo = (id) => SIGNAL_BY_ID.get(id) || { id, emoji: "•", label: id };

const norm = (s) => ` ${String(s || "").toLowerCase()} `;

/** Lectura local (sin IA) de un mensaje. */
export function detectLocal(text = "") {
  const t = norm(text);
  const signals = SIGNALS.filter((s) => s.re.test(t)).map((s) => s.id);
  const factors = FACTORS.filter((f) => f.re && f.re.test(t)).map((f) => f.id);
  const bad = signals.filter((s) => !["enfocado", "tranquilo"].includes(s)).length;
  const good = signals.filter((s) => ["enfocado", "tranquilo"].includes(s)).length;
  const state = bad >= 2 ? "red" : bad === 1 ? "yellow" : good ? "green" : null;
  return { state, signals, factors };
}

const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

/**
 * Activaciones que salen solas de la app para un día: poco sueño (< 6 h), compra por impulso,
 * comida en la calle.
 */
export function autoFactors({ date = new Date(), sleepLog = [], ledger = [] } = {}) {
  const k = dayKey(date);
  const out = [];
  const sleep = (sleepLog || []).find((s) => s && String(s.date || "").slice(0, 10) === k);
  const mins = Number(sleep?.totalMinutes ?? sleep?.total_minutes);
  if (Number.isFinite(mins) && mins > 0 && mins < 360) out.push("poco_sueno");
  const today = (ledger || []).filter((e) => e && !e.archived && e.type === "expense" && dayKey(e.date) === k);
  if (today.some((e) => e.reason === "impulso")) out.push("compra_impulso");
  if (today.some((e) => e.category === "Comida en la calle" || /^🍽️/.test(String(e.note || "")))) out.push("comida_calle");
  return out;
}

/** Junta registros por día: el estado del día es el peor registrado; factores y señales se unen. */
export function dailyView(entries = []) {
  const days = new Map();
  for (const e of entries || []) {
    if (!e || !e.ts) continue;
    const k = dayKey(e.ts);
    const d = days.get(k) || { day: k, state: null, signals: new Set(), factors: new Set(), count: 0 };
    if (e.state && (d.state == null || STATE_SCORE[e.state] > STATE_SCORE[d.state])) d.state = e.state;
    (e.signals || []).forEach((s) => d.signals.add(s));
    (e.factors || []).forEach((f) => d.factors.add(f));
    d.count++;
    days.set(k, d);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Qué regula y qué desregula: para cada activación compara qué tan seguido el día fue 🔴
 * cuando estuvo presente vs cuando no. Solo con suficientes días.
 * @returns {{ helps: Array, hurts: Array, days: number, need: number }}
 */
export function patterns(entries = [], { minDays = 3 } = {}) {
  const days = dailyView(entries).filter((d) => d.state);
  const total = days.length;
  const helps = [];
  const hurts = [];
  if (total < 4) return { helps, hurts, days: total, need: 4 };
  const ids = new Set(days.flatMap((d) => [...d.factors]));
  for (const id of ids) {
    const withF = days.filter((d) => d.factors.has(id));
    const without = days.filter((d) => !d.factors.has(id));
    if (withF.length < minDays || without.length < 2) continue;
    const redWith = withF.filter((d) => d.state === "red").length / withF.length;
    const redWithout = without.filter((d) => d.state === "red").length / without.length;
    const greenWith = withF.filter((d) => d.state === "green").length / withF.length;
    const greenWithout = without.filter((d) => d.state === "green").length / without.length;
    const row = {
      id, ...factorInfo(id), n: withF.length,
      redWith: Math.round(redWith * 100), redWithout: Math.round(redWithout * 100),
      greenWith: Math.round(greenWith * 100), greenWithout: Math.round(greenWithout * 100),
      confidence: withF.length >= 8 ? "alta" : withF.length >= 5 ? "media" : "baja",
    };
    if (redWith - redWithout >= 0.2) hurts.push({ ...row, delta: Math.round((redWith - redWithout) * 100) });
    else if (greenWith - greenWithout >= 0.2 || redWithout - redWith >= 0.2) helps.push({ ...row, delta: Math.round(Math.max(greenWith - greenWithout, redWithout - redWith) * 100) });
  }
  hurts.sort((a, b) => b.delta - a.delta);
  helps.sort((a, b) => b.delta - a.delta);
  return { helps, hurts, days: total, need: 4 };
}

/** Señales que más se repiten (para ver, p. ej., que la sed aparece con la ansiedad). */
export function signalCounts(entries = [], days = 30, now = new Date()) {
  const from = now.getTime() - days * 86400000;
  const map = new Map();
  for (const e of entries || []) {
    if (!e || new Date(e.ts).getTime() < from) continue;
    for (const s of e.signals || []) map.set(s, (map.get(s) || 0) + 1);
  }
  return [...map.entries()].map(([id, n]) => ({ ...signalInfo(id), n })).sort((a, b) => b.n - a.n);
}

/** Lee y valida la respuesta JSON de la IA. */
export function parseTdhaReply(raw) {
  const m = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch (_e) { return null; }
  const state = ["green", "yellow", "red"].includes(j?.state) ? j.state : null;
  const signals = (Array.isArray(j?.signals) ? j.signals : []).filter((s) => SIGNAL_BY_ID.has(s));
  const factors = (Array.isArray(j?.factors) ? j.factors : []).filter((f) => FACTOR_BY_ID.has(f));
  const when = j?.when === "ayer" ? "ayer" : "hoy";
  return { state, signals, factors, when, reply: String(j?.reply || "").trim().slice(0, 700) };
}

export function tdhaSystemPrompt() {
  return `Eres Carl en la pestaña TDHA de MemoryCarl: un espacio para que la persona entienda qué la regula y qué la desregula. NO diagnosticas, NO das consejos médicos, NO sermoneas. Escuchas, reflejas en una o dos frases, y si hace falta haces UNA pregunta corta para entender mejor (qué pasó antes, cómo dormió, qué comió…). Español peruano natural, cálido y breve.

Devuelve SOLO JSON (sin markdown):
{
  "state": "green" | "yellow" | "red" | null,   // 🟢 regulado, 🟡 a medias, 🔴 desregulado; null si no se puede saber
  "signals": [ids],                              // cómo lo nota: ${SIGNALS.map((s) => s.id).join(", ")}
  "factors": [ids],                              // lo que estuvo presente: ${FACTORS.filter((f) => !f.auto).map((f) => f.id).join(", ")}
  "when": "hoy" | "ayer",                        // si habla de ayer
  "reply": "tu respuesta"
}
Usa solo los ids de las listas. Si en el historial ya se ve un patrón que le sirve (algo que lo reguló antes), puedes mencionarlo con suavidad.`;
}

/**
 * solveMode.js — 🧭 Modo ABC: Carl te ayuda a resolver un problema
 * MemoryCarl / NeuroChat
 *
 * Carl escucha como siempre. Si detecta un problema práctico que te tiene trabado, al final
 * te OFRECE bajarlo a un plan (no lo impone). Si aceptas, te guía paso a paso:
 *   A · Aterrizar   B · Bajo tu control   C · Caminos   D · Decidir   E · Empezar
 * con la intensidad que elijas (suave, medio o hardcore), y termina en un plan que se guarda
 * en Magic ToDo con el primer paso con hora de aviso.
 *
 * Estado en localStorage (sobrevive a recargar la app; se apaga solo tras 12 h sin uso):
 *   { active, intensity, startedAt, lastAt, step, declinedAt }
 */

export const SOLVE_KEY = "memorycarl_solve_mode";
const IDLE_MS = 12 * 3600 * 1000;
const DECLINE_MS = 6 * 3600 * 1000;

export const INTENSITIES = {
  suave: { label: "Suave", emoji: "🌱", hint: "Con cariño y paso a paso" },
  medio: { label: "Medio", emoji: "🧭", hint: "Directo pero cercano" },
  hardcore: { label: "Hardcore", emoji: "🔥", hint: "Sin pañitos, con plazos firmes" },
};

export const STEPS = {
  A: "Aterrizar",
  B: "Bajo tu control",
  C: "Caminos",
  D: "Decidir",
  E: "Empezar",
};

const STYLE = {
  suave: `ESTILO SUAVE 🌱: cálido y paciente. Antes de cada paso, valida en UNA línea cómo se siente. Pasos muy chicos, sin presión. Ofrece opciones en vez de exigir. Plazos amables ("¿te parece hoy en la tarde o mañana temprano?").`,
  medio: `ESTILO MEDIO 🧭: directo y cercano, como un buen amigo que no te deja escapar pero tampoco te aprieta. Sin rodeos ni discursos. Si ves una excusa, nómbrala con amabilidad y sigue. Plazos concretos (día y hora).`,
  hardcore: `ESTILO HARDCORE 🔥 (el usuario lo pidió así: sabe lo que es y le sirve):
- Sin pañitos. Directo, firme y exigente, como un entrenador que cree en él y no le acepta menos. Frases cortas.
- Señala excusas, evasiones y postergaciones sin rodeos, usando lo que sabes de su vida (sus patrones, lo que ha dicho antes, lo que ya pospuso). Ejemplo de tono: "Eso lo vienes diciendo desde octubre. ¿Qué es distinto esta vez?"
- Recuérdale lo que está en juego: es cabeza de hogar y hay gente que depende de que actúe. Sin culpa barata: es para mover, no para hundir.
- Plazos firmes: hoy o mañana, con hora. Nada de "cuando puedas". Pide un compromiso concreto y que lo confirme.
- Si responde con vaguedades, no lo dejes pasar: pide lo concreto.
- LÍMITES QUE NO SE CRUZAN: nunca insultes, humilles, ridiculices ni ataques su valor como persona ni como padre. La dureza es con el problema y con las excusas, nunca con él. Si una frase lo haría sentir inútil en vez de capaz, cámbiala.`,
};

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SOLVE_KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch (_e) { return {}; }
};
const write = (v) => { try { localStorage.setItem(SOLVE_KEY, JSON.stringify(v)); } catch (_e) {} };

/** Estado actual (con el apagado automático por inactividad). */
export function loadSolve(now = Date.now()) {
  const s = read();
  if (s.active && now - Number(s.lastAt || s.startedAt || 0) > IDLE_MS) {
    s.active = false;
    write(s);
  }
  return {
    active: Boolean(s.active),
    intensity: INTENSITIES[s.intensity] ? s.intensity : "medio",
    step: STEPS[s.step] || s.step === "done" ? s.step : "A",
    startedAt: s.startedAt || null,
    lastAt: s.lastAt || null,
    declinedAt: s.declinedAt || null,
  };
}

export function startSolve(intensity = "medio", now = Date.now()) {
  const s = { ...read(), active: true, intensity: INTENSITIES[intensity] ? intensity : "medio", startedAt: now, lastAt: now, step: "A", declinedAt: null };
  write(s);
  return loadSolve(now);
}

export function setIntensity(intensity) {
  if (!INTENSITIES[intensity]) return loadSolve();
  write({ ...read(), intensity });
  return loadSolve();
}

export function stopSolve() {
  write({ ...read(), active: false });
  return loadSolve();
}

/** "Ahora solo quiero desahogarme": Carl deja de ofrecer planes por un rato. */
export function declineOffer(now = Date.now()) {
  write({ ...read(), active: false, declinedAt: now });
  return loadSolve(now);
}

/** Carl avanza de paso (lo informa en su JSON). "done" cierra el modo. */
export function noteStep(step, now = Date.now()) {
  const s = read();
  if (!s.active) return loadSolve(now);
  const next = STEPS[step] || step === "done" ? step : s.step;
  write({ ...s, step: next, lastAt: now, active: next !== "done" });
  return loadSolve(now);
}

export function canOffer(session = loadSolve(), now = Date.now()) {
  if (session.active) return false;
  return !(session.declinedAt && now - session.declinedAt < DECLINE_MS);
}

/** Lo que Carl necesita saber en el prompt, según el estado. */
export function buildSolvePromptBlock(session = loadSolve(), now = Date.now()) {
  if (session.active) {
    const it = INTENSITIES[session.intensity];
    return `

## 🧭 MODO ABC ACTIVO (${it.emoji} ${it.label}) — paso actual: ${session.step === "done" ? "terminado" : `${session.step} · ${STEPS[session.step]}`}
El usuario pidió ayuda para RESOLVER un problema, no solo para desahogarse. Es cabeza de hogar y no se puede quedar paralizado. Guíalo con este método, UN paso a la vez (no adelantes los siguientes):
- A · Aterrizar: el problema en una frase, para cuándo, y qué pasa si no hace nada. Si ya lo contó antes en la conversación, resúmelo tú y pídele que confirme.
- B · Bajo tu control: separa lo que depende de él de lo que no. Lo que no depende de él, se suelta.
- C · Caminos: propón TÚ 2 o 3 opciones reales y concretas, usando lo que sabes de su vida (su plata, su agenda, su familia, lo que ya intentó). Para cada una: qué cuesta y qué gana.
- D · Decidir: que elija una. Dile en una línea por qué es buena elección (o qué riesgo vigilar).
- E · Empezar: un primer paso de 15 minutos o menos, para HOY si se puede, con hora. Después, los siguientes pasos (máximo 6).

Reglas:
- Mensajes cortos (máximo ~120 palabras; en hardcore, menos). Termina siempre con UNA pregunta o pedido concreto.
- Si responde "no sé", "no tengo idea" o se bloquea: NO le hagas más preguntas. Propón tú la respuesta más razonable con lo que sabes de él y pídele solo un "sí" o que la corrija.
- Usa lo que sabes de él (memoria, finanzas, personas) para que todo sea concreto, nunca genérico.
- Si en algún momento notas que está en crisis (desesperanza, ideas de hacerse daño, colapso emocional), DEJA el método: primero contenlo con calma, y sugiere hablar con alguien de confianza o con un profesional. El plan puede esperar.
- Si te pide salir del modo o cambiar de tema, hazlo.

${STYLE[session.intensity]}

En el JSON de ---NEURON_ACTIONS--- agrega siempre "solveStep": la letra del paso en el que quedó la conversación ("A".."E"), o "done" cuando el plan quedó listo.
Cuando llegues al final de E (ya eligió camino y primer paso), agrega también:
"plan": { "title": "Título corto del plan", "steps": [ { "text": "Primer paso concreto", "minutes": 15 }, { "text": "…", "minutes": 30 } ], "firstStepAt": "YYYY-MM-DDTHH:MM" }
(firstStepAt = cuándo hará el primer paso, en hora local; los pasos en orden, el primero el más chico). Y dile que puede guardarlo en Magic ToDo con el botón que le aparece.`;
  }
  if (!canOffer(session, now)) {
    return `

## 🧭 MODO ABC
El usuario pidió hace poco solo desahogarse: NO le ofrezcas armar planes en esta conversación, salvo que él lo pida.`;
  }
  return `

## 🧭 OFRECER EL MODO ABC
Si el usuario cuenta un problema PRÁCTICO que lo tiene trabado o preocupado (plata, deudas, la casa, el trabajo, los hijos, un trámite, una decisión que viene postergando), primero escúchalo y responde como siempre. Al final, en UNA sola línea, ofrécele bajarlo a un plan concreto (sin empezar el plan todavía), y en el JSON pon "offerSolve": true.
No lo ofrezcas en charla trivial, si solo comparte algo bueno, si ya lo ofreciste en tu mensaje anterior, ni si está en crisis emocional (ahí primero contener).`;
}

const clean = (s, max = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

/** Lee lo del modo ABC del JSON de acciones de Carl. */
export function parseSolveFields(parsed = {}) {
  const out = {};
  if (parsed?.offerSolve === true) out.offerSolve = true;
  const step = String(parsed?.solveStep || "").trim();
  if (STEPS[step] || step === "done") out.solveStep = step;
  const p = parsed?.plan;
  if (p && typeof p === "object") {
    const steps = (Array.isArray(p.steps) ? p.steps : [])
      .map((x) => (typeof x === "string" ? { text: x } : x))
      .map((x) => ({ text: clean(x?.text, 160), minutes: Number(x?.minutes) > 0 ? Math.min(600, Math.round(Number(x.minutes))) : null }))
      .filter((x) => x.text)
      .slice(0, 8);
    const firstStepAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(p.firstStepAt || "")) ? String(p.firstStepAt).slice(0, 16) : null;
    if (steps.length) out.plan = { title: clean(p.title, 120) || steps[0].text, steps, ...(firstStepAt ? { firstStepAt } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Convierte el plan en una tarea de Magic ToDo (con sus pasos y el aviso del primer paso).
 * @param {object} plan  { title, steps:[{text, minutes}], firstStepAt? }
 * @param {{ createTask: Function, createStep: Function }} engine  (de magicTodoEngine.js)
 */
export function planToTask(plan, engine, now = new Date()) {
  if (!plan?.steps?.length) return null;
  const task = engine.createTask(`🧭 ${plan.title}`, { source: "abc", now: now.getTime() });
  if (!task) return null;
  task.steps = plan.steps.map((s) => engine.createStep(s.text, s.minutes)).filter(Boolean);
  if (plan.firstStepAt) {
    const [d, t] = plan.firstStepAt.split("T");
    const [y, m, da] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    const at = new Date(y, m - 1, da, h, mi);
    if (Number.isFinite(at.getTime()) && at.getTime() > now.getTime()) task.remindAt = at.toISOString();
  }
  return task;
}

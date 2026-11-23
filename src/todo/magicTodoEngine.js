/**
 * magicTodoEngine.js — Magic ToDo: tareas que se desarman en pasos y aprenden
 * MemoryCarl
 *
 * Lógica pura (sin DOM):
 * - Árbol de pasos: crear, buscar, marcar, editar, borrar, agregar hijos.
 * - Tiempo: estimado (suma de pasos) y real (desde que empezaste hasta que terminaste).
 * - Historial de lo cumplido y lo que se aprende de él: cuánto tardas de verdad frente a lo
 *   estimado, cuánto detalle te sirve, qué pasos sueles agregar o quitar, y tareas parecidas.
 * - Prompt para la IA (con lo aprendido) y lectura robusta de su respuesta.
 *
 * Una tarea vive en state.reminders (compatible con lo que ya existía: { id, text, done }):
 *   { id, text, done, createdAt, updatedAt, steps: Node[], aiSteps?: string[], detail?: 1|2|3,
 *     minutes?: number, remindAt?: ISO, startedAt?: number, doneAt?: number, source? }
 * Node = { id, text, done, minutes?, steps?: Node[] }
 */

export const DETAIL_LEVELS = {
  1: { label: "Poco", hint: "3 a 4 pasos grandes" },
  2: { label: "Medio", hint: "5 a 7 pasos" },
  3: { label: "Mucho", hint: "8 a 12 pasos muy chiquitos, cada uno de pocos minutos" },
};
export const MAX_DEPTH = 3;

let seq = 0;
export const newId = (p = "t") => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const clean = (s, max = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

/** Tarea nueva. */
export function createTask(text, opts = {}) {
  const t = clean(text);
  if (!t) return null;
  const now = opts.now ?? Date.now();
  return { id: newId("m"), text: t, done: false, createdAt: now, updatedAt: now, steps: [], source: opts.source || "manual" };
}

/** Paso nuevo. */
export function createStep(text, minutes = null) {
  const t = clean(text);
  if (!t) return null;
  return { id: newId("s"), text: t, done: false, ...(num(minutes) ? { minutes: num(minutes) } : {}), steps: [] };
}

/** Recorre el árbol: devuelve { node, parent, list, depth } del id buscado. */
export function findNode(task, id) {
  const walk = (list, parent, depth) => {
    for (const n of list || []) {
      if (n.id === id) return { node: n, parent, list, depth };
      const r = walk(n.steps, n, depth + 1);
      if (r) return r;
    }
    return null;
  };
  if (!task) return null;
  if (task.id === id) return { node: task, parent: null, list: null, depth: 0 };
  return walk(task.steps, task, 1);
}

/** Todos los pasos hoja (los que se marcan de verdad). */
export function leafSteps(nodeOrTask) {
  const out = [];
  const walk = (list) => {
    for (const n of list || []) {
      if (n.steps?.length) walk(n.steps);
      else out.push(n);
    }
  };
  walk(nodeOrTask?.steps);
  return out;
}

/** Minutos estimados de un nodo: los suyos o la suma de sus pasos. */
export function estimateMinutes(node) {
  if (!node) return 0;
  if (node.steps?.length) {
    const sum = node.steps.reduce((a, s) => a + estimateMinutes(s), 0);
    if (sum) return sum;
  }
  return num(node.minutes) || 0;
}

/** Progreso de una tarea: { done, total, pct }. */
export function progress(task) {
  const leaves = leafSteps(task);
  if (!leaves.length) return { done: task?.done ? 1 : 0, total: 1, pct: task?.done ? 100 : 0 };
  const done = leaves.filter((s) => s.done).length;
  return { done, total: leaves.length, pct: Math.round((done / leaves.length) * 100) };
}

const touch = (task, now) => { task.updatedAt = now ?? Date.now(); return task; };

/**
 * Marca o desmarca un paso (o la tarea). Marcar un paso con hijos marca a los hijos; cuando
 * todos los pasos de un nivel quedan hechos, el padre también. La primera marca cuenta como
 * "empezaste" y la última como "terminaste".
 * @returns {{ task, completed: boolean }} completed = la tarea quedó terminada con esta marca
 */
export function toggleNode(task, id, done, opts = {}) {
  const now = opts.now ?? Date.now();
  const hit = findNode(task, id);
  if (!hit) return { task, completed: false };
  const wasDone = Boolean(task.done);
  const setAll = (n, v) => { n.done = v; (n.steps || []).forEach((c) => setAll(c, v)); };
  setAll(hit.node, Boolean(done));
  // Hacia arriba: un padre está hecho si todos sus pasos lo están
  const fixUp = (list, parent) => {
    for (const n of list || []) if (n.steps?.length) { fixUp(n.steps, n); n.done = n.steps.every((c) => c.done); }
  };
  fixUp(task.steps, task);
  if (task.steps?.length && hit.node !== task) task.done = task.steps.every((c) => c.done);
  if (done && !task.startedAt) task.startedAt = now;
  if (task.done && !wasDone) task.doneAt = now;
  if (!task.done) delete task.doneAt;
  touch(task, now);
  return { task, completed: task.done && !wasDone };
}

/** Cambia el texto (o los minutos) de un paso o de la tarea. */
export function editNode(task, id, patch = {}, opts = {}) {
  const hit = findNode(task, id);
  if (!hit) return task;
  if (patch.text !== undefined) { const t = clean(patch.text); if (t) hit.node.text = t; }
  if (patch.minutes !== undefined) { const m = num(patch.minutes); if (m) hit.node.minutes = m; else delete hit.node.minutes; }
  return touch(task, opts.now);
}

/** Borra un paso. */
export function deleteNode(task, id, opts = {}) {
  const hit = findNode(task, id);
  if (!hit || !hit.list) return task;
  hit.list.splice(hit.list.indexOf(hit.node), 1);
  return touch(task, opts.now);
}

/** Agrega un paso al final de la tarea o dentro de otro paso. */
export function addStep(task, parentId, text, opts = {}) {
  const hit = findNode(task, parentId || task.id);
  if (!hit || hit.depth >= MAX_DEPTH) return null;
  const step = createStep(text, opts.minutes);
  if (!step) return null;
  step.manual = true;
  hit.node.steps = hit.node.steps || [];
  hit.node.steps.push(step);
  if (hit.node !== task && hit.node.done) hit.node.done = false;
  if (task.done) { task.done = false; delete task.doneAt; }
  touch(task, opts.now);
  return step;
}

/** Mueve un paso arriba o abajo dentro de su nivel. */
export function moveNode(task, id, dir, opts = {}) {
  const hit = findNode(task, id);
  if (!hit || !hit.list) return task;
  const i = hit.list.indexOf(hit.node);
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= hit.list.length) return task;
  [hit.list[i], hit.list[j]] = [hit.list[j], hit.list[i]];
  return touch(task, opts.now);
}

/**
 * Pone los pasos que propuso la IA debajo de la tarea o de un paso (reemplaza los que había
 * si no estaban hechos). Guarda lo que propuso la IA para aprender después qué cambiaste.
 */
export function applyBreakdown(task, targetId, steps = [], opts = {}) {
  const hit = findNode(task, targetId || task.id);
  if (!hit || hit.depth >= MAX_DEPTH) return task;
  const build = (list, depth) => (list || []).map((s) => {
    const n = createStep(s.text, s.minutes);
    if (!n) return null;
    if (depth < MAX_DEPTH && Array.isArray(s.steps) && s.steps.length) n.steps = build(s.steps, depth + 1).filter(Boolean);
    return n;
  }).filter(Boolean);
  const kept = (hit.node.steps || []).filter((s) => s.done);
  hit.node.steps = [...kept, ...build(steps, hit.depth + 1)];
  hit.node.done = false;
  if (hit.node === task) {
    task.aiSteps = hit.node.steps.map((s) => s.text);
    if (opts.detail) task.detail = opts.detail;
    if (num(opts.minutes)) task.minutes = num(opts.minutes);
    task.source = "ai";
  }
  if (task.done) { task.done = false; delete task.doneAt; }
  return touch(task, opts.now);
}

// ---------------------------------------------------------------- historial y aprendizaje

/** Minutos reales que tomó (de la primera marca a la última); null si no se sabe o no es creíble. */
export function realMinutes(task) {
  if (!task?.startedAt || !task?.doneAt) return null;
  const m = Math.round((task.doneAt - task.startedAt) / 60000);
  return m >= 1 && m <= 12 * 60 ? m : null;
}

/** Lo que se guarda en "Hechas" cuando una tarea se termina. */
export function historyEntry(task) {
  const flat = [];
  const walk = (list, depth) => (list || []).forEach((n) => { flat.push({ text: n.text, depth, ...(n.minutes ? { minutes: n.minutes } : {}), ...(n.manual ? { manual: true } : {}) }); walk(n.steps, depth + 1); });
  walk(task.steps, 1);
  const est = estimateMinutes(task) || null;
  return {
    id: task.id,
    text: task.text,
    steps: flat,
    aiSteps: task.aiSteps || [],
    estimate: est,
    real: realMinutes(task),
    detail: task.detail || null,
    createdAt: task.createdAt || null,
    doneAt: task.doneAt || Date.now(),
  };
}

const STOP = new Set("a al algo con de del el en es la las lo los me mi mis para por que se su sus un una unos unas y o hay hacer tengo voy ir".split(" "));
export const normWords = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Tareas cumplidas parecidas a un texto (por palabras en común). */
export function similarDone(text, history = [], k = 3) {
  const words = new Set(normWords(text));
  if (!words.size) return [];
  return (history || [])
    .filter((h) => !h.deleted)
    .map((h) => {
      const hw = new Set(normWords(h.text));
      const common = [...words].filter((w) => hw.has(w)).length;
      return { h, score: common / Math.max(1, Math.min(words.size, hw.size)) };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || b.h.doneAt - a.h.doneAt)
    .slice(0, k)
    .map((x) => x.h);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Lo aprendido del historial:
 * - timeFactor: cuánto tardas de verdad frente a lo estimado (mediana; desde 3 tareas medidas)
 * - detail: el nivel de detalle que más usas
 * - avgSteps: cuántos pasos suelen tener tus tareas cumplidas
 * - added: pasos que sueles agregar a mano; removed: pasos de la IA que sueles quitar
 */
export function learnings(history = []) {
  const live = (history || []).filter((h) => !h.deleted);
  const ratios = live.filter((h) => h.real && h.estimate).map((h) => h.real / h.estimate);
  const tf = ratios.length >= 3 ? Math.min(3, Math.max(0.5, Math.round(median(ratios) * 10) / 10)) : null;
  const details = live.map((h) => h.detail).filter(Boolean);
  const detail = details.length ? Number(Object.entries(details.reduce((a, d) => ((a[d] = (a[d] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0][0]) : null;
  const top = live.map((h) => (h.steps || []).filter((s) => s.depth === 1).length).filter((n) => n > 0);
  const avgSteps = top.length ? Math.round(top.reduce((a, b) => a + b, 0) / top.length) : null;
  const added = {};
  const removed = {};
  for (const h of live) {
    const finals = new Set((h.steps || []).map((s) => s.text.toLowerCase()));
    for (const s of h.steps || []) if (s.manual) added[s.text] = (added[s.text] || 0) + 1;
    for (const a of h.aiSteps || []) if (!finals.has(String(a).toLowerCase())) removed[a] = (removed[a] || 0) + 1;
  }
  const topOf = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, n]) => ({ text, n }));
  return { count: live.length, measured: ratios.length, timeFactor: tf, detail, avgSteps, added: topOf(added), removed: topOf(removed) };
}

// ---------------------------------------------------------------- IA

/**
 * Prompt para desarmar una tarea (o un paso) en pasos.
 * @param {{ text: string, parentTask?: string, detail?: number, history?: Array, now?: Date }} o
 * @returns {{ system: string, user: string }}
 */
export function buildBreakdownPrompt({ text, parentTask = "", detail = 2, history = [], now = new Date() } = {}) {
  const lvl = DETAIL_LEVELS[detail] || DETAIL_LEVELS[2];
  const L = learnings(history);
  const similar = similarDone(parentTask ? `${parentTask} ${text}` : text, history, 3);
  const learned = [];
  if (L.timeFactor && L.timeFactor !== 1) learned.push(`Cuando estimas, esta persona tarda en realidad ${L.timeFactor}× (ajusta tus minutos con eso).`);
  if (L.avgSteps) learned.push(`Sus tareas cumplidas suelen tener unos ${L.avgSteps} pasos.`);
  if (L.added.length) learned.push(`Pasos que suele agregar a mano (inclúyelos si aplican): ${L.added.map((a) => `"${a.text}"`).join(", ")}.`);
  if (L.removed.length) learned.push(`Pasos que suele borrar (no los pongas): ${L.removed.map((a) => `"${a.text}"`).join(", ")}.`);
  const examples = similar.map((h) => `- "${h.text}"${h.real ? ` (le tomó ${h.real} min)` : ""}: ${(h.steps || []).filter((s) => s.depth === 1).map((s) => s.text).join(" → ")}`).join("\n");
  const system = `Ayudas a una persona con TDAH a empezar y terminar cosas. Desarmas una tarea en pasos concretos, cortos y accionables, en el orden en que se hacen, en español.
Reglas:
- Cada paso empieza con un verbo y se puede hacer sin pensar mucho ("Sacar la tabla de planchar", no "Prepararse").
- Nivel de detalle: ${lvl.label} (${lvl.hint}).
- Pon minutos realistas a cada paso.
- Nada de consejos, motivación ni explicaciones: solo los pasos.
- Responde SOLO con JSON: {"minutes": total, "steps": [{"text": "...", "minutes": n}]}`;
  const user = `${parentTask ? `Tarea principal: "${parentTask}". Desarma SOLO este paso de esa tarea: "${text}".` : `Tarea: "${text}"`}
Hoy es ${now.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" })}, ${now.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}.${learned.length ? `\n\nLo que se aprendió de sus tareas cumplidas:\n${learned.join("\n")}` : ""}${examples ? `\n\nTareas parecidas que ya cumplió (así le funcionó):\n${examples}` : ""}`;
  return { system, user };
}

/** Lee la respuesta de la IA aunque venga con texto alrededor. */
export function parseBreakdown(raw) {
  const s = String(raw || "");
  const tryParse = (txt) => { try { return JSON.parse(txt); } catch (_e) { return null; } };
  let j = tryParse(s.trim());
  if (!j) { const m = s.match(/\{[\s\S]*\}/); if (m) j = tryParse(m[0]); }
  if (!j) { const m = s.match(/\[[\s\S]*\]/); if (m) { const arr = tryParse(m[0]); if (Array.isArray(arr)) j = { steps: arr }; } }
  if (!j) return null;
  const toStep = (x) => {
    if (typeof x === "string") return { text: clean(x) };
    if (!x || typeof x !== "object") return null;
    const text = clean(x.text || x.title || x.step || x.paso);
    if (!text) return null;
    const out = { text, ...(num(x.minutes ?? x.minutos ?? x.min) ? { minutes: num(x.minutes ?? x.minutos ?? x.min) } : {}) };
    const kids = (x.steps || x.subtasks || x.pasos || []).map(toStep).filter((k) => k?.text);
    if (kids.length) out.steps = kids;
    return out;
  };
  const steps = (Array.isArray(j) ? j : j.steps || j.subtasks || j.pasos || []).map(toStep).filter((x) => x?.text).slice(0, 15);
  if (!steps.length) return null;
  return { steps, minutes: num(j.minutes ?? j.minutos) || steps.reduce((a, x) => a + (x.minutes || 0), 0) || null };
}

/** Une el historial local con el de la nube (por id; gana el más reciente). */
export function mergeHistory(local = [], cloud = []) {
  const map = new Map((local || []).filter((h) => h?.id).map((h) => [h.id, h]));
  let changed = false;
  for (const c of cloud || []) {
    if (!c?.id) continue;
    const l = map.get(c.id);
    if (!l || Number(c.updatedAt || c.doneAt || 0) > Number(l.updatedAt || l.doneAt || 0)) { map.set(c.id, c); changed = true; }
  }
  return { list: [...map.values()].sort((a, b) => b.doneAt - a.doneAt), changed };
}

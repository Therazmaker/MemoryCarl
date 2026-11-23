/**
 * magicTodo-ui.js — Pestaña Magic ToDo (en lugar de Reminders)
 * MemoryCarl
 *
 * Escribes algo, Carl lo desarma en pasos chiquitos (Claude, y si no, Gemini) y cada paso se
 * puede volver a desarmar. Lo que cumples queda en "🏆 Hechas", y de ahí aprende: cuánto
 * tardas de verdad, cuánto detalle te sirve y qué pasos sueles agregar o quitar.
 */

import {
  DETAIL_LEVELS, MAX_DEPTH, createTask, findNode, toggleNode, editNode, deleteNode, addStep, moveNode,
  applyBreakdown, estimateMinutes, progress, historyEntry, learnings, buildBreakdownPrompt, parseBreakdown,
} from "./magicTodoEngine.js";
import { loadMagic, addToHistory, removeFromHistory, setPrefs } from "./magicTodoStore.js";
import { callClaude } from "../shopping/shoppingAi.js";
import { geminiJson } from "../shopping/basketBrain.js";
import { getClaudeSettings } from "../services/claudeClient.js";
import { getNeuroChatSettings } from "../settings/neurochatSettings.js";

const ui = { tab: "pend", open: null, edit: null, busy: new Set(), collapsed: new Set(), showDone: false, timeFor: null, error: "" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMin = (m) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);
const tasksOf = (state) => (Array.isArray(state.reminders) ? state.reminders : []);

function whenLabel(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date();
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  const hm = d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `hoy ${hm}`;
  if (d.toDateString() === tom.toDateString()) return `mañana ${hm}`;
  return `${d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" })} ${hm}`;
}
const toLocalInput = (iso) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---------------------------------------------------------------- vista

function nodeActions(task, node, depth) {
  const isTask = node === task;
  return `
    <div class="mtActions">
      <button class="mtAct" data-mt="edit" data-id="${esc(node.id)}">✏️ Editar</button>
      ${depth < MAX_DEPTH ? `<button class="mtAct" data-mt="split" data-id="${esc(node.id)}">✨ ${node.steps?.length ? "Rehacer pasos" : "Desarmar"}</button>` : ""}
      ${depth < MAX_DEPTH ? `<button class="mtAct" data-mt="add-step" data-id="${esc(node.id)}">＋ Paso</button>` : ""}
      ${isTask ? `<button class="mtAct" data-mt="time" data-id="${esc(node.id)}">⏰ Avisarme</button>` : `
        <button class="mtAct" data-mt="up" data-id="${esc(node.id)}" aria-label="Subir">↑</button>
        <button class="mtAct" data-mt="down" data-id="${esc(node.id)}" aria-label="Bajar">↓</button>`}
      <button class="mtAct mtAct--danger" data-mt="delete" data-id="${esc(node.id)}">🗑</button>
    </div>`;
}

function renderNode(task, node, depth) {
  const busy = ui.busy.has(node.id);
  const kids = node.steps || [];
  const mins = estimateMinutes(node);
  const editing = ui.edit === node.id;
  return `
    <li class="mtStep${node.done ? " mtStep--done" : ""}" data-depth="${depth}">
      <div class="mtRow">
        <input type="checkbox" class="mtCheck" data-mt="check" data-id="${esc(node.id)}" ${node.done ? "checked" : ""} aria-label="Hecho" />
        ${editing
          ? `<div class="mtEditBox"><input class="mtInput" data-mt-edit="${esc(node.id)}" value="${esc(node.text)}" maxlength="200" />
              <input class="mtInput mtMinInput" data-mt-min="${esc(node.id)}" type="number" min="1" max="600" value="${esc(node.minutes || "")}" placeholder="min" />
              <button class="mtBtn mtBtn--primary" data-mt="save-edit" data-id="${esc(node.id)}">Guardar</button></div>`
          : `<button class="mtText" data-mt="open" data-id="${esc(node.id)}">${esc(node.text)}</button>`}
        ${mins && !editing ? `<span class="mtMin">${esc(fmtMin(mins))}</span>` : ""}
        ${busy ? `<span class="mtSpin" aria-label="Pensando">✨</span>` : ""}
      </div>
      ${ui.open === node.id && !editing ? nodeActions(task, node, depth) : ""}
      ${kids.length ? `<ul class="mtSteps">${kids.map((k) => renderNode(task, k, depth + 1)).join("")}</ul>` : ""}
    </li>`;
}

function renderTask(task, L) {
  const p = progress(task);
  const est = estimateMinutes(task);
  const forYou = est && L.timeFactor && L.timeFactor !== 1 ? Math.round(est * L.timeFactor) : null;
  const collapsed = ui.collapsed.has(task.id);
  const busy = ui.busy.has(task.id);
  const editing = ui.edit === task.id;
  return `
    <section class="mtTask${task.done ? " mtTask--done" : ""}" data-task="${esc(task.id)}">
      <div class="mtRow mtTaskHead">
        <input type="checkbox" class="mtCheck mtCheck--big" data-mt="check" data-id="${esc(task.id)}" ${task.done ? "checked" : ""} aria-label="Tarea hecha" />
        ${editing
          ? `<div class="mtEditBox"><input class="mtInput" data-mt-edit="${esc(task.id)}" value="${esc(task.text)}" maxlength="200" />
              <button class="mtBtn mtBtn--primary" data-mt="save-edit" data-id="${esc(task.id)}">Guardar</button></div>`
          : `<button class="mtText mtTaskText" data-mt="open" data-id="${esc(task.id)}">${esc(task.text)}</button>`}
        ${task.steps?.length ? `<button class="mtFold" data-mt="fold" data-id="${esc(task.id)}" aria-label="${collapsed ? "Mostrar pasos" : "Ocultar pasos"}">${collapsed ? "▸" : "▾"}</button>` : ""}
      </div>
      <div class="mtMeta">
        ${est ? `<span class="mtChip">⏱ ${esc(fmtMin(est))}${forYou ? ` · para ti ~${esc(fmtMin(forYou))}` : ""}</span>` : ""}
        ${task.remindAt ? `<button class="mtChip mtChip--time" data-mt="time" data-id="${esc(task.id)}">⏰ ${esc(whenLabel(task.remindAt))}</button>` : ""}
        ${task.steps?.length ? `<span class="mtChip">${p.done}/${p.total} pasos</span>` : ""}
        ${!task.steps?.length && !task.done ? `<button class="mtChip mtChip--magic" data-mt="split" data-id="${esc(task.id)}">${busy ? "✨ Pensando…" : "✨ Desarmar en pasos"}</button>` : ""}
        ${busy && task.steps?.length ? `<span class="mtChip mtChip--magic">✨ Pensando…</span>` : ""}
      </div>
      ${task.steps?.length ? `<div class="mtBar"><span style="width:${p.pct}%"></span></div>` : ""}
      ${ui.timeFor === task.id ? `
        <div class="mtTimeBox">
          <input type="datetime-local" class="mtInput" data-mt-time="${esc(task.id)}" value="${esc(toLocalInput(task.remindAt))}" />
          <button class="mtBtn mtBtn--primary" data-mt="time-save" data-id="${esc(task.id)}">Guardar</button>
          ${task.remindAt ? `<button class="mtBtn" data-mt="time-clear" data-id="${esc(task.id)}">Quitar</button>` : ""}
          <div class="mtHint">El aviso al teléfono (y al reloj) llega con la app de widgets.</div>
        </div>` : ""}
      ${ui.open === task.id && !editing ? nodeActions(task, task, 0) : ""}
      ${task.steps?.length && !collapsed ? `<ul class="mtSteps mtSteps--root">${task.steps.map((s) => renderNode(task, s, 1)).join("")}</ul>` : ""}
    </section>`;
}

function renderPending(state, magic) {
  const L = learnings(magic.history);
  const tasks = tasksOf(state);
  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const detail = magic.prefs.detail || 2;
  return `
    <div class="mtAdd">
      <input id="mtNew" class="mtInput mtNewInput" placeholder="¿Qué tienes que hacer?" maxlength="200" />
      <button class="mtBtn mtBtn--primary mtAddBtn" data-mt="add" aria-label="Agregar">＋</button>
    </div>
    <div class="mtOpts">
      <span class="mtOptsLbl">Detalle</span>
      ${[1, 2, 3].map((d) => `<button class="mtSeg${detail === d ? " mtSeg--on" : ""}" data-mt="detail" data-d="${d}" title="${esc(DETAIL_LEVELS[d].hint)}">${esc(DETAIL_LEVELS[d].label)}</button>`).join("")}
      <label class="mtToggle"><input type="checkbox" data-mt="auto" ${magic.prefs.autoBreak ? "checked" : ""} /> ✨ al agregar</label>
    </div>
    ${ui.error ? `<div class="mtError">${esc(ui.error)}</div>` : ""}
    ${pending.length ? pending.map((t) => renderTask(t, L)).join("") : `<div class="mtEmpty">Nada pendiente. Escribe algo arriba y Carl lo desarma en pasos chiquitos.</div>`}
    ${done.length ? `
      <div class="mtDoneHead">
        <button class="mtLink" data-mt="show-done">${ui.showDone ? "▾" : "▸"} Hechas en la lista (${done.length})</button>
        <button class="mtLink" data-mt="clear-done">Limpiar</button>
      </div>
      ${ui.showDone ? done.map((t) => renderTask(t, L)).join("") : ""}` : ""}`;
}

function renderDoneTab(magic) {
  const L = learnings(magic.history);
  const live = magic.history.filter((h) => !h.deleted).sort((a, b) => b.doneAt - a.doneAt);
  const weekAgo = Date.now() - 7 * 86400000;
  const week = live.filter((h) => h.doneAt >= weekAgo).length;
  const byDay = {};
  for (const h of live) (byDay[new Date(h.doneAt).toDateString()] ||= []).push(h);
  const learned = [];
  if (L.timeFactor) learned.push(L.timeFactor > 1.05 ? `Tardas unas <b>${L.timeFactor}×</b> lo que estimo: ya lo tengo en cuenta al poner minutos.` : L.timeFactor < 0.95 ? `Terminas más rápido de lo que estimo (<b>${L.timeFactor}×</b>): ajusto los minutos.` : "Mis tiempos te calzan bien.");
  else learned.push(`Cuando cumplas ${Math.max(0, 3 - L.measured)} tarea${3 - L.measured === 1 ? "" : "s"} más empezando por el primer paso, sabré cuánto tardas de verdad.`);
  if (L.detail) learned.push(`El detalle que más usas: <b>${esc(DETAIL_LEVELS[L.detail].label)}</b>${L.avgSteps ? ` (unos ${L.avgSteps} pasos)` : ""}.`);
  if (L.added.length) learned.push(`Sueles agregar: ${L.added.map((a) => `<i>${esc(a.text)}</i>`).join(", ")}. Lo propongo solo.`);
  if (L.removed.length) learned.push(`Sueles borrar: ${L.removed.map((a) => `<i>${esc(a.text)}</i>`).join(", ")}. Ya no lo pongo.`);
  return `
    <div class="mtStats">
      <div class="mtStat"><b>${week}</b><span>esta semana</span></div>
      <div class="mtStat"><b>${live.length}</b><span>en total</span></div>
      <div class="mtStat"><b>${L.timeFactor ? `${L.timeFactor}×` : "—"}</b><span>tiempo real</span></div>
    </div>
    <section class="mtLearn">
      <div class="mtLearnTitle">🧠 Lo que voy aprendiendo</div>
      <ul>${learned.map((l) => `<li>${l}</li>`).join("")}</ul>
      <div class="mtHint">Cuando desarmo una tarea uso esto y las tareas parecidas que ya cumpliste.</div>
    </section>
    ${live.length ? Object.entries(byDay).map(([day, list]) => `
      <div class="mtDayHead">${esc((() => { const t = new Date(day).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1); })())}</div>
      ${list.map((h) => `
        <details class="mtHist">
          <summary><span>🏆 ${esc(h.text)}</span><span class="mtHistMeta">${h.real ? `${esc(fmtMin(h.real))} reales` : ""}${h.real && h.estimate ? " · " : ""}${h.estimate ? `estimé ${esc(fmtMin(h.estimate))}` : ""}</span></summary>
          ${h.steps?.length ? `<div class="mtHistSteps">${(() => { let n = 0; return h.steps.map((s) => `<div class="mtHistStep" style="padding-left:${(s.depth - 1) * 18}px">${s.depth === 1 ? `<b>${++n}.</b>` : "–"} ${esc(s.text)}${s.manual ? " <span class=\"mtTag\">tuyo</span>" : ""}</div>`).join(""); })()}</div>` : ""}
          <div class="mtHistBtns">
            <button class="mtBtn" data-mt="reuse" data-id="${esc(h.id)}">↻ Hacerla otra vez</button>
            <button class="mtBtn mtBtn--ghost" data-mt="forget" data-id="${esc(h.id)}">Quitar</button>
          </div>
        </details>`).join("")}`).join("") : `<div class="mtEmpty">Aquí van quedando las tareas que cumples. De ellas aprendo a desarmar mejor las siguientes.</div>`}`;
}

/** Vista completa de la pestaña. */
export function renderMagicTodo(state) {
  const magic = loadMagic();
  const pendingCount = tasksOf(state).filter((t) => !t.done).length;
  const doneCount = magic.history.filter((h) => !h.deleted).length;
  return `
    <div class="mtWrap">
      <div class="mtHeader">
        <div class="mtTitle">✨ Magic ToDo</div>
        <div class="mtSub">Escribe algo y Carl lo desarma en pasos chiquitos. Lo que cumples le enseña a hacerlo mejor.</div>
      </div>
      <div class="mtTabs">
        <button class="mtTab${ui.tab === "pend" ? " mtTab--on" : ""}" data-mt="tab" data-t="pend">Pendientes${pendingCount ? ` <span class="mtCount">${pendingCount}</span>` : ""}</button>
        <button class="mtTab${ui.tab === "done" ? " mtTab--on" : ""}" data-mt="tab" data-t="done">🏆 Hechas${doneCount ? ` <span class="mtCount">${doneCount}</span>` : ""}</button>
      </div>
      ${ui.tab === "done" ? renderDoneTab(magic) : renderPending(state, magic)}
    </div>
    ${styles()}`;
}

// ---------------------------------------------------------------- IA

function aiKeys() {
  const c = getClaudeSettings() || {};
  let g = {};
  try { g = getNeuroChatSettings() || {}; } catch (_e) {}
  return { claude: { apiKey: c.apiKey || "", model: c.model }, gemini: { apiKey: (g.apiKey || "").trim().length > 8 ? g.apiKey : "", model: g.model || "gemini-2.5-flash" } };
}

/** Pide los pasos a la IA: Claude y, si falla, Gemini. */
export async function askBreakdown({ text, parentTask, detail, history }, deps = {}) {
  const { system, user } = buildBreakdownPrompt({ text, parentTask, detail, history });
  const keys = deps.keys || aiKeys();
  const claudeFn = deps.callClaude || callClaude;
  const geminiFn = deps.geminiJson || geminiJson;
  const errors = [];
  if (keys.claude.apiKey) {
    try {
      const out = await claudeFn([{ role: "system", content: system }, { role: "user", content: user }], keys.claude.apiKey, keys.claude.model);
      const r = parseBreakdown(out);
      if (r) return r;
      errors.push("Claude respondió algo que no entendí");
    } catch (e) { errors.push(`Claude: ${e?.message || e}`); }
  }
  if (keys.gemini.apiKey) {
    try {
      const r = parseBreakdown(await geminiFn({ system, user, apiKey: keys.gemini.apiKey, model: keys.gemini.model }));
      if (r) return r;
      errors.push("Gemini respondió algo que no entendí");
    } catch (e) { errors.push(`Gemini: ${e?.message || e}`); }
  }
  if (!keys.claude.apiKey && !keys.gemini.apiKey) throw new Error("Para desarmar tareas necesito la clave de Claude o de Gemini (Ajustes de NeuroChat).");
  throw new Error(`No pude desarmarla. ${errors.join(" · ")}`);
}

// ---------------------------------------------------------------- eventos

/**
 * Conecta la pestaña. ctx = { state, persist, view, toast }
 */
export function wireMagicTodo(root, ctx) {
  const wrap = root.querySelector(".mtWrap");
  if (!wrap) return;
  const { state } = ctx;
  if (!Array.isArray(state.reminders)) state.reminders = [];
  const rerender = () => ctx.view();
  const save = () => ctx.persist();
  const taskOfNode = (id) => tasksOf(state).find((t) => findNode(t, id));

  async function breakDown(task, nodeId) {
    const hit = findNode(task, nodeId);
    if (!hit || ui.busy.has(nodeId)) return;
    const magic = loadMagic();
    ui.busy.add(nodeId);
    ui.error = "";
    ui.open = null;
    rerender();
    try {
      const isTask = hit.node === task;
      const r = await askBreakdown({ text: hit.node.text, parentTask: isTask ? "" : task.text, detail: magic.prefs.detail || 2, history: magic.history });
      const t = tasksOf(state).find((x) => x.id === task.id);
      if (t) {
        applyBreakdown(t, nodeId, r.steps, { detail: magic.prefs.detail || 2, minutes: isTask ? r.minutes : null });
        ui.collapsed.delete(t.id);
        save();
      }
    } catch (e) {
      ui.error = e?.message || "No pude desarmarla.";
    } finally {
      ui.busy.delete(nodeId);
      rerender();
    }
  }

  const addTask = () => {
    const input = wrap.querySelector("#mtNew");
    const task = createTask(input?.value);
    if (!task) return;
    state.reminders.unshift(task);
    save();
    if (loadMagic().prefs.autoBreak) breakDown(task, task.id);
    else rerender();
  };

  wrap.querySelector("#mtNew")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } });
  wrap.querySelectorAll("[data-mt-edit]").forEach((inp) => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); wrap.querySelector(`[data-mt="save-edit"][data-id="${inp.dataset.mtEdit}"]`)?.click(); }
    if (e.key === "Escape") { ui.edit = null; rerender(); }
  }));
  const firstEdit = wrap.querySelector("[data-mt-edit]");
  if (firstEdit) { firstEdit.focus(); firstEdit.select?.(); }

  wrap.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset?.mt === "auto") { setPrefs({ autoBreak: el.checked }); return; }
    if (el.dataset?.mt !== "check") return;
    const task = taskOfNode(el.dataset.id);
    if (!task) return;
    const { completed } = toggleNode(task, el.dataset.id, el.checked);
    if (completed) {
      addToHistory(historyEntry(task));
      ctx.toast?.("🏆 ¡Hecha! La guardé para aprender");
    } else if (!task.done) {
      // Si la desmarcas, deja de contar como cumplida
      const h = loadMagic().history.find((x) => x.id === task.id && !x.deleted);
      if (h) removeFromHistory(task.id);
    }
    save();
    rerender();
  });

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mt]");
    if (!btn || btn.dataset.mt === "check" || btn.dataset.mt === "auto") return;
    const id = btn.dataset.id;
    const task = id ? taskOfNode(id) : null;
    switch (btn.dataset.mt) {
      case "tab": ui.tab = btn.dataset.t; ui.open = null; ui.edit = null; break;
      case "add": addTask(); return;
      case "detail": setPrefs({ detail: Number(btn.dataset.d) || 2 }); break;
      case "open": ui.open = ui.open === id ? null : id; ui.edit = null; break;
      case "fold": ui.collapsed.has(id) ? ui.collapsed.delete(id) : ui.collapsed.add(id); break;
      case "split": if (task) breakDown(task, id); return;
      case "edit": ui.edit = id; ui.open = null; break;
      case "save-edit": {
        if (!task) return;
        const text = wrap.querySelector(`[data-mt-edit="${id}"]`)?.value;
        const minEl = wrap.querySelector(`[data-mt-min="${id}"]`);
        editNode(task, id, { text, ...(minEl ? { minutes: minEl.value } : {}) });
        ui.edit = null;
        save();
        break;
      }
      case "add-step": {
        if (!task) return;
        const s = addStep(task, id, "Paso nuevo");
        if (s) { ui.edit = s.id; ui.open = null; ui.collapsed.delete(task.id); save(); }
        break;
      }
      case "up": case "down": if (task) { moveNode(task, id, btn.dataset.mt === "up" ? -1 : 1); save(); } break;
      case "delete": {
        if (!task) return;
        if (task.id === id) {
          if (!confirm(`¿Borrar "${task.text}"?`)) return;
          state.reminders = tasksOf(state).filter((t) => t.id !== id);
        } else deleteNode(task, id);
        ui.open = null;
        save();
        break;
      }
      case "time": ui.timeFor = ui.timeFor === id ? null : id; ui.open = null; break;
      case "time-save": {
        const v = wrap.querySelector(`[data-mt-time="${id}"]`)?.value;
        const d = v ? new Date(v) : null;
        if (task && d && Number.isFinite(d.getTime())) { task.remindAt = d.toISOString(); task.updatedAt = Date.now(); save(); }
        ui.timeFor = null;
        break;
      }
      case "time-clear": if (task) { delete task.remindAt; task.updatedAt = Date.now(); save(); } ui.timeFor = null; break;
      case "show-done": ui.showDone = !ui.showDone; break;
      case "clear-done": state.reminders = tasksOf(state).filter((t) => !t.done); save(); break;
      case "reuse": {
        const h = loadMagic().history.find((x) => x.id === id);
        if (!h) return;
        const t = createTask(h.text, { source: "reuse" });
        // Rearma el árbol con los pasos que quedaron la vez que la cumpliste
        const roots = [];
        const stack = [];
        for (const s of h.steps || []) {
          const node = { id: `s_${Math.random().toString(36).slice(2, 9)}`, text: s.text, done: false, ...(s.minutes ? { minutes: s.minutes } : {}), steps: [] };
          while (stack.length && stack[stack.length - 1].depth >= s.depth) stack.pop();
          (stack.length ? stack[stack.length - 1].node.steps : roots).push(node);
          stack.push({ depth: s.depth, node });
        }
        t.steps = roots;
        t.aiSteps = roots.map((r) => r.text);
        if (h.detail) t.detail = h.detail;
        state.reminders.unshift(t);
        ui.tab = "pend";
        save();
        ctx.toast?.("↻ Lista otra vez, con los pasos que te funcionaron");
        break;
      }
      case "forget": removeFromHistory(id); break;
      default: return;
    }
    rerender();
  });
}

function styles() {
  return `<style id="mtStyles">
  .mtWrap { display: flex; flex-direction: column; gap: 12px; padding-bottom: 24px; }
  .mtHeader { text-align: center; padding-top: 4px; }
  .mtTitle { font-size: 24px; font-weight: 900; }
  .mtSub { font-size: 13px; opacity: .65; margin-top: 4px; }
  .mtTabs { display: flex; gap: 6px; background: rgba(255,255,255,.05); padding: 4px; border-radius: 14px; }
  .mtTab { flex: 1; border: 0; background: transparent; color: inherit; padding: 9px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; opacity: .7; }
  .mtTab--on { background: rgba(167,139,250,.22); opacity: 1; }
  .mtCount { background: rgba(255,255,255,.14); border-radius: 999px; padding: 1px 7px; font-size: 12px; margin-left: 4px; }
  .mtAdd { display: flex; gap: 8px; }
  .mtInput { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); color: inherit; border-radius: 12px; padding: 10px 12px; font-size: 15px; font-family: inherit; }
  .mtNewInput { font-size: 16px; padding: 13px 14px; }
  .mtBtn { border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.07); color: inherit; border-radius: 10px; padding: 8px 12px; font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .mtBtn--primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  .mtBtn--ghost { background: transparent; opacity: .7; }
  .mtAddBtn { font-size: 22px; padding: 0 18px; }
  .mtOpts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
  .mtOptsLbl { opacity: .6; margin-right: 2px; }
  .mtSeg { border: 1px solid rgba(255,255,255,.14); background: transparent; color: inherit; border-radius: 999px; padding: 5px 11px; font-size: 12px; font-weight: 700; cursor: pointer; opacity: .7; }
  .mtSeg--on { background: rgba(167,139,250,.25); border-color: #a78bfa; opacity: 1; }
  .mtToggle { margin-left: auto; display: flex; align-items: center; gap: 5px; opacity: .8; }
  .mtError { background: rgba(251,113,133,.14); border: 1px solid rgba(251,113,133,.35); color: #fecdd3; border-radius: 12px; padding: 10px 12px; font-size: 13px; }
  .mtEmpty { text-align: center; opacity: .55; font-size: 14px; padding: 28px 12px; }
  .mtTask { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .mtTask--done { opacity: .6; }
  .mtRow { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .mtCheck { width: 20px; height: 20px; flex-shrink: 0; accent-color: #7c5cff; margin: 0; }
  .mtCheck--big { width: 24px; height: 24px; }
  .mtText { flex: 1; min-width: 0; text-align: left; background: none; border: 0; color: inherit; font: inherit; font-size: 15px; padding: 2px 0; cursor: pointer; word-break: break-word; line-height: 1.35; }
  .mtTaskText { font-size: 17px; font-weight: 700; }
  .mtStep--done > .mtRow .mtText, .mtTask--done .mtTaskText { text-decoration: line-through; opacity: .6; }
  .mtFold { background: none; border: 0; color: inherit; font-size: 18px; opacity: .6; cursor: pointer; padding: 0 4px; }
  .mtMin { font-size: 11px; opacity: .6; white-space: nowrap; }
  .mtSpin { animation: mtPulse 1s infinite; }
  @keyframes mtPulse { 50% { opacity: .3; } }
  .mtMeta { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 34px; }
  .mtChip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1); color: inherit; font-weight: 600; }
  button.mtChip { cursor: pointer; }
  .mtChip--magic { background: rgba(124,92,255,.22); border-color: rgba(167,139,250,.5); }
  .mtChip--time { background: rgba(251,191,36,.14); border-color: rgba(251,191,36,.4); }
  .mtBar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.08); margin-left: 34px; overflow: hidden; }
  .mtBar span { display: block; height: 100%; background: linear-gradient(90deg, #7c5cff, #34d399); }
  .mtSteps { list-style: none; margin: 0; padding: 0 0 0 26px; display: flex; flex-direction: column; gap: 6px; }
  .mtSteps--root { padding-left: 34px; }
  .mtStep { display: flex; flex-direction: column; gap: 6px; }
  .mtActions { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 30px; }
  .mtAct { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: inherit; border-radius: 9px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .mtAct--danger { color: #fda4af; }
  .mtEditBox { flex: 1; display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .mtEditBox .mtInput { flex: 1; min-width: 140px; padding: 7px 10px; font-size: 14px; }
  .mtEditBox .mtMinInput { flex: 0 0 70px; min-width: 70px; }
  .mtTimeBox { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-left: 34px; }
  .mtTimeBox .mtInput { flex: 1; min-width: 180px; }
  .mtHint { font-size: 11px; opacity: .55; width: 100%; }
  .mtDoneHead { display: flex; justify-content: space-between; padding: 4px 2px; }
  .mtLink { background: none; border: 0; color: #a78bfa; font-weight: 700; font-size: 13px; cursor: pointer; padding: 4px 0; }
  .mtStats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .mtStat { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); border-radius: 14px; padding: 10px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
  .mtStat b { font-size: 20px; }
  .mtStat span { font-size: 11px; opacity: .6; }
  .mtLearn { background: rgba(124,92,255,.1); border: 1px solid rgba(167,139,250,.3); border-radius: 16px; padding: 12px 14px; font-size: 13px; }
  .mtLearnTitle { font-weight: 800; margin-bottom: 6px; }
  .mtLearn ul { margin: 0 0 6px; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .mtDayHead { font-size: 12px; font-weight: 800; opacity: .6; margin-top: 6px; }
  .mtHist { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px 12px; }
  .mtHist summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-weight: 700; font-size: 14px; }
  .mtHistMeta { font-weight: 500; font-size: 11px; opacity: .6; white-space: nowrap; }
  .mtHistSteps { margin: 8px 0; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
  .mtHistStep b { opacity: .6; }
  .mtTag { font-size: 10px; background: rgba(52,211,153,.18); color: #6ee7b7; border-radius: 6px; padding: 0 5px; }
  .mtHistBtns { display: flex; gap: 6px; }
  </style>`;
}

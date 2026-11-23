/**
 * widgetBridge.js — La app web y la app de widgets (APK) se hablan por aquí
 * MemoryCarl
 *
 * 1. Resumen: lo que los widgets muestran (cuentas, categorías más usadas, lo que queda hasta el
 *    cobro, ánimos del diario, tareas con hora). Se publica como módulo "widget_summary".
 * 2. Buzón: lo que registraste desde los widgets (gastos, diario, tareas hechas o pospuestas).
 *    Al abrir MemoryCarl se baja, se aplica y recién entonces se confirma al servidor.
 *    Un registro ya aplicado se recuerda aquí, así no se repite aunque la confirmación falle.
 */

import { JOURNAL_MOODS } from "../day/journal.js";
import { toggleNode, historyEntry, progress } from "../todo/magicTodoEngine.js";

const APPLIED_KEY = "memorycarl_widget_applied_v1";
const DAY = 86400000;
const DEFAULT_CATEGORIES = ["Comida", "Transporte", "Mercado", "Salud", "Casa", "Otros"];

const isOwnAccount = (a) => a && a.id && !a.archived && !String(a.id).startsWith("ext_");

/**
 * Lo que muestran los widgets.
 * @param {{ state: object, runway?: object|null, now?: Date }} o
 */
export function buildWidgetSummary({ state = {}, runway = null, now = new Date() } = {}) {
  const ledger = (state.financeLedger || []).filter((e) => e && !e.archived && e.type === "expense");
  const since = now.getTime() - 60 * DAY;
  const counts = {};
  for (const e of ledger) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t) || t < since) continue;
    const c = String(e.category || "").trim();
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const categories = [...new Set([...top, ...DEFAULT_CATEGORIES])].slice(0, 8);
  const last = [...ledger].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
  const accounts = (state.financeAccounts || []).filter(isOwnAccount).map((a) => ({ id: a.id, name: String(a.name || "Cuenta") }));
  const lastAccountId = accounts.some((a) => a.id === state.financeLastAccountId) ? state.financeLastAccountId : accounts[0]?.id || null;
  const horizon = now.getTime() + 14 * DAY;
  const tasks = (Array.isArray(state.reminders) ? state.reminders : [])
    .filter((t) => t && !t.done && t.text)
    .map((t) => {
      const p = progress(t);
      const at = t.remindAt ? Date.parse(t.remindAt) : NaN;
      return { id: t.id, text: String(t.text).slice(0, 120), ...(Number.isFinite(at) && at <= horizon ? { remindAt: new Date(at).toISOString() } : {}), ...(t.steps?.length ? { stepsDone: p.done, stepsTotal: p.total } : {}) };
    })
    .sort((a, b) => (a.remindAt || "9999").localeCompare(b.remindAt || "9999"))
    .slice(0, 30);
  return {
    v: 1,
    generatedAt: now.toISOString(),
    accounts,
    lastAccountId,
    categories,
    lastExpense: last ? { amount: Number(last.amount) || 0, category: last.category || "", date: last.date } : null,
    runway: runway ? { free: runway.free, perDay: runway.perDay, daysLeft: runway.payday?.daysLeft ?? null, paydayLabel: runway.payday?.label || "" } : null,
    moods: JOURNAL_MOODS.map(({ id, emoji, label }) => ({ id, emoji, label })),
    tasks,
  };
}

function loadApplied() {
  try { const v = JSON.parse(localStorage.getItem(APPLIED_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (_e) { return []; }
}
function saveApplied(list) {
  try { localStorage.setItem(APPLIED_KEY, JSON.stringify(list.slice(-500))); } catch (_e) {}
}

/**
 * Aplica registros del buzón. handlers = { expense(data, item), journal(data, item), task(taskId) → task|null, save() }
 * @returns {{ applied: string[], skipped: string[], failed: Array<{ id, error }> , summary: string[] }}
 */
export function applyInboxItems(items = [], handlers = {}, opts = {}) {
  const applied = [];
  const skipped = [];
  const failed = [];
  const summary = [];
  const done = new Set(opts.appliedIds || loadApplied());
  for (const it of items || []) {
    if (!it?.id) continue;
    if (done.has(it.id)) { skipped.push(it.id); continue; }
    const d = it.data || {};
    try {
      if (it.kind === "expense") {
        const ok = handlers.expense?.({ ...d, date: it.client_ts || new Date().toISOString() }, it);
        if (!ok) throw new Error("No se pudo anotar el gasto");
        summary.push(`💸 S/ ${Number(d.amount).toFixed(2)} ${d.category || ""}`.trim());
      } else if (it.kind === "journal") {
        const ok = handlers.journal?.({ text: d.text, mood: d.mood || null, ts: Date.parse(it.client_ts) || Date.now() }, it);
        if (!ok) throw new Error("No se pudo guardar en el diario");
        summary.push("📓 diario");
      } else if (it.kind === "task_done" || it.kind === "task_snooze") {
        const task = handlers.task?.(d.taskId);
        // Una tarea que ya no existe (la borraste) no bloquea el buzón
        if (task) {
          if (it.kind === "task_done") {
            if (!task.done) {
              const { completed } = toggleNode(task, task.id, true, { now: Date.parse(it.client_ts) || Date.now() });
              if (completed) handlers.history?.(historyEntry(task));
            }
            summary.push(`✅ ${task.text}`);
          } else {
            task.remindAt = d.remindAt;
            task.updatedAt = Date.now();
            summary.push(`⏰ ${task.text}`);
          }
        }
      } else {
        throw new Error(`Tipo desconocido: ${it.kind}`);
      }
      applied.push(it.id);
      done.add(it.id);
    } catch (e) {
      failed.push({ id: it.id, error: e?.message || String(e) });
    }
  }
  if (applied.length) {
    handlers.save?.();
    if (!opts.appliedIds) saveApplied([...done]);
  }
  return { applied, skipped, failed, summary };
}

/** URL y clave del servidor (las mismas de Ajustes de NeuroChat). */
export function serverConfig() {
  try {
    const url = (localStorage.getItem("memorycarl_api_url") || "").replace(/\/+$/, "");
    const key = localStorage.getItem("memorycarl_api_key") || "";
    return url && key ? { url, key } : null;
  } catch (_e) {
    return null;
  }
}

let running = null;
let lastRun = 0;

/**
 * Baja el buzón, lo aplica y confirma. Se puede llamar seguido: corre de a uno y como mucho
 * cada 30 segundos (salvo force).
 * @returns {Promise<{ applied: number, summary: string[] } | null>}
 */
export async function syncWidgetInbox(handlers, opts = {}) {
  const cfg = opts.config || serverConfig();
  if (!cfg) return null;
  if (running) return running;
  if (!opts.force && Date.now() - lastRun < 30000) return null;
  lastRun = Date.now();
  const fetchFn = opts.fetch || fetch;
  running = (async () => {
    try {
      const headers = { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };
      const res = await fetchFn(`${cfg.url}/api/widget/inbox/pending`, { headers });
      if (!res.ok) return null;
      const json = await res.json();
      const items = Array.isArray(json?.data) ? json.data : [];
      if (!items.length) return { applied: 0, summary: [] };
      const r = applyInboxItems(items, handlers);
      const toAck = [...r.applied, ...r.skipped];
      if (toAck.length) {
        await fetchFn(`${cfg.url}/api/widget/inbox/ack`, { method: "POST", headers, body: JSON.stringify({ ids: toAck }) }).catch(() => {});
      }
      if (r.failed.length) console.warn("[widgets] No se aplicaron:", r.failed);
      return { applied: r.applied.length, summary: r.summary };
    } catch (e) {
      console.warn("[widgets] Buzón:", e?.message || e);
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

// El resumen lo arma main.js (tiene Finanzas); dbService lo publica con los demás módulos
let provider = null;
export function setWidgetSummaryProvider(fn) { provider = typeof fn === "function" ? fn : null; }
export function currentWidgetSummary() {
  try { return provider ? provider() : null; } catch (_e) { return null; }
}

/** Para comparar resúmenes sin contar la hora en que se armaron. */
export function summaryForHash(p) {
  if (!p || typeof p !== "object") return p;
  const { generatedAt, ...rest } = p;
  return rest;
}


/**
 * tdha-ui.js — Pestaña TDHA de NeuroChat
 * MemoryCarl
 *
 * Un chat propio: la persona escribe como se siente ("tengo mucha sed", "ayer estaba irritable")
 * y la IA (Claude, o Gemini de respaldo; reglas locales sin conexión) registra el estado, las
 * señales y las activaciones. Debajo: registro rápido 🟢🟡🔴 y "lo que voy viendo" (qué regula
 * y qué desregula). No diagnostica.
 */

import { STATES, SIGNALS, FACTORS, detectLocal, autoFactors, dailyView, patterns, signalCounts, parseTdhaReply, tdhaSystemPrompt, factorInfo, signalInfo } from "./tdhaEngine.js";
import { loadTdha, addEntry, updateEntry, deleteEntry, pushChat, clearChat } from "./tdhaStore.js";
import { callClaude } from "../shopping/shoppingAi.js";
import { geminiJson } from "../shopping/basketBrain.js";
import { getClaudeSettings } from "../services/claudeClient.js";
import { getNeuroChatSettings } from "../settings/neurochatSettings.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ui = { busy: false, editing: null };

const appState = () => (typeof window !== "undefined" && window.state) || {};
const dayLabel = (k) => { const d = new Date(`${k}T12:00:00`); return d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric" }); };

function chipsFor(entry, editable = false) {
  if (!entry) return "";
  const st = entry.state ? STATES[entry.state] : null;
  const chip = (kind, id, info) => `<span class="tdChip tdChip--${kind}">${info.emoji} ${esc(info.label)}${editable ? `<button class="tdChipX" data-td-rm="${esc(entry.id)}" data-kind="${kind}" data-id="${esc(id)}" title="Quitar">✕</button>` : ""}</span>`;
  return `
    <div class="tdEntry" data-entry="${esc(entry.id)}">
      <div class="tdEntryStates">
        ${Object.values(STATES).map((s) => `<button class="tdStateBtn ${entry.state === s.id ? "tdStateOn" : ""}" data-td-state="${esc(entry.id)}" data-v="${s.id}" title="${esc(s.label)}">${s.emoji}</button>`).join("")}
        <span class="tdEntryLbl">${st ? esc(st.label) : "¿cómo estabas?"}</span>
        <button class="tdMini" data-td-edit="${esc(entry.id)}" title="Agregar señales o activaciones">＋</button>
        <button class="tdMini" data-td-del="${esc(entry.id)}" title="Borrar este registro">🗑</button>
      </div>
      <div class="tdChips">
        ${(entry.signals || []).map((id) => chip("sig", id, signalInfo(id))).join("")}
        ${(entry.factors || []).map((id) => chip("fac", id, factorInfo(id))).join("")}
      </div>
      ${ui.editing === entry.id ? `
        <div class="tdPicker">
          <div class="tdPickTitle">Cómo lo notabas</div>
          <div class="tdChips">${SIGNALS.filter((s) => !(entry.signals || []).includes(s.id)).map((s) => `<button class="tdChip tdChipAdd" data-td-add="${esc(entry.id)}" data-kind="sig" data-id="${s.id}">${s.emoji} ${esc(s.label)}</button>`).join("")}</div>
          <div class="tdPickTitle">Qué estuvo presente</div>
          <div class="tdChips">${FACTORS.filter((f) => !(entry.factors || []).includes(f.id)).map((f) => `<button class="tdChip tdChipAdd" data-td-add="${esc(entry.id)}" data-kind="fac" data-id="${f.id}">${f.emoji} ${esc(f.label)}</button>`).join("")}</div>
          <button class="tdMini" data-td-edit-done>Listo</button>
        </div>` : ""}
    </div>`;
}

function insightsHtml(entries) {
  const p = patterns(entries);
  const sigs = signalCounts(entries).slice(0, 6);
  const days = dailyView(entries).slice(0, 14).reverse();
  const strip = days.length ? `<div class="tdStrip">${days.map((d) => `<div class="tdDay" title="${esc(dayLabel(d.day))}"><div class="tdDayDot">${d.state ? STATES[d.state].emoji : "⚪"}</div><div class="tdDayLbl">${esc(dayLabel(d.day))}</div></div>`).join("")}</div>` : "";
  const row = (r, kind) => `
    <div class="tdPat">
      <span>${r.emoji} ${esc(r.label)}</span>
      <span class="tdPatWhy">${kind === "hurt"
        ? `🔴 ${r.redWith}% de los días con esto vs ${r.redWithout}% sin esto`
        : `🟢 ${r.greenWith}% con esto vs ${r.greenWithout}% sin esto`} · ${r.n} días${r.confidence === "baja" ? " · aún poco" : ""}</span>
    </div>`;
  const body = p.days < p.need
    ? `<div class="tdHint">Con ${p.need} días registrados empiezo a mostrarte qué te regula y qué te desregula. Llevas ${p.days}.</div>`
    : `
      <div class="tdCols">
        <div><div class="tdColTitle">🟢 Te ayuda</div>${p.helps.length ? p.helps.slice(0, 6).map((r) => row(r, "help")).join("") : `<div class="tdHint">Todavía nada claro.</div>`}</div>
        <div><div class="tdColTitle">🔴 Te desordena</div>${p.hurts.length ? p.hurts.slice(0, 6).map((r) => row(r, "hurt")).join("") : `<div class="tdHint">Todavía nada claro.</div>`}</div>
      </div>`;
  return `
    <details class="tdCard" open>
      <summary>🔎 Lo que voy viendo</summary>
      ${strip}
      ${body}
      ${sigs.length ? `<div class="tdColTitle">Señales más frecuentes (30 días)</div><div class="tdChips">${sigs.map((s) => `<span class="tdChip tdChip--sig">${s.emoji} ${esc(s.label)} ×${s.n}</span>`).join("")}</div>` : ""}
      <div class="tdHint">Son patrones tuyos para entenderte, no un diagnóstico.</div>
    </details>`;
}

export function viewTdha() {
  const { entries, chat } = loadTdha();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const msgs = chat.map((m) => m.role === "user"
    ? `<div class="tdMsg tdMsgUser"><div class="tdBubble">${esc(m.text).replace(/\n/g, "<br>")}</div></div>`
    : `<div class="tdMsg tdMsgCarl"><div class="tdBubble">${esc(m.text).replace(/\n/g, "<br>")}</div>${m.entryId && byId.get(m.entryId) ? chipsFor(byId.get(m.entryId), true) : ""}</div>`).join("");
  const intro = !chat.length ? `<div class="tdMsg tdMsgCarl"><div class="tdBubble">Aquí puedes contarme cómo estás, como te salga: “tengo mucha sed”, “ayer estaba súper irritable”, “hoy me bloqueé con todo”. Yo voy anotando cómo estabas y qué estuvo presente (sueño, cafeína, discusiones, ejercicio…) y con los días te muestro qué te regula y qué te desregula. No es un diagnóstico: es para entenderte.</div></div>` : "";
  return `
    ${tdCss()}
    <div class="tdWrap">
      <div class="tdQuick">
        <span>¿Cómo estás ahora?</span>
        ${Object.values(STATES).map((s) => `<button class="tdQuickBtn" data-td-quick="${s.id}">${s.emoji} ${esc(s.label)}</button>`).join("")}
      </div>
      <div class="tdLog" id="tdLog">${intro}${msgs}${ui.busy ? `<div class="tdTyping">🧠 Carl está entendiendo…</div>` : ""}</div>
      <div class="tdInputBar">
        <textarea id="tdInput" class="tdInput" rows="2" placeholder="Cuéntame cómo estás o qué pasó…"></textarea>
        <button id="tdSend" class="tdSend" ${ui.busy ? "disabled" : ""}>➤</button>
      </div>
      <div class="tdRow"><button class="tdMini" data-td-clear>🧹 Limpiar chat (los registros se quedan)</button></div>
      ${insightsHtml(entries)}
    </div>`;
}

async function askAi(text) {
  const c = getClaudeSettings() || {};
  let g = {};
  try { g = getNeuroChatSettings() || {}; } catch (_e) {}
  const { entries, chat } = loadTdha();
  const p = patterns(entries);
  const recentDays = dailyView(entries).slice(0, 10).map((d) => `${d.day}: ${d.state ? STATES[d.state].label : "?"} · señales ${[...d.signals].join(", ") || "-"} · activaciones ${[...d.factors].join(", ") || "-"}`).join("\n");
  const pat = p.days >= p.need ? `Le ayuda: ${p.helps.map((h) => h.label).join(", ") || "-"}. Le desordena: ${p.hurts.map((h) => h.label).join(", ") || "-"}.` : "Aún pocos días para ver patrones.";
  const history = chat.slice(-8).map((m) => `${m.role === "user" ? "Persona" : "Carl"}: ${m.text}`).join("\n");
  const now = new Date();
  const system = `${tdhaSystemPrompt()}\n\nHoy: ${now.toLocaleString("es-PE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.\nÚltimos días:\n${recentDays || "(sin registros)"}\nPatrones: ${pat}\nConversación reciente:\n${history || "(nueva)"}`;
  const tries = [];
  if (c.apiKey) tries.push(() => callClaude([{ role: "system", content: system }, { role: "user", content: text }], c.apiKey, c.model));
  if ((g.apiKey || "").trim().length > 8) tries.push(() => geminiJson({ system, user: text, apiKey: g.apiKey, model: g.model || "gemini-2.5-flash" }));
  for (const run of tries) {
    try { const r = parseTdhaReply(await run()); if (r) return r; } catch (_e) { /* siguiente */ }
  }
  return null;
}

function localReply(det) {
  const parts = [];
  if (det.state) parts.push(`${STATES[det.state].emoji} ${STATES[det.state].label}`);
  const all = [...det.signals.map((s) => signalInfo(s).label.toLowerCase()), ...det.factors.map((f) => factorInfo(f).label.toLowerCase())];
  if (all.length) parts.push(all.join(", "));
  return parts.length ? `Anotado: ${parts.join(" · ")}. ¿Qué pasó antes? ¿Cómo dormiste? (⚙️ sin IA)` : "Te leo. ¿Cómo te sientes en el cuerpo ahora mismo? (⚙️ sin IA)";
}

export function wireTdha(root, rerender) {
  const st = () => appState();
  const send = async () => {
    const input = root.querySelector("#tdInput");
    const text = String(input?.value || "").trim();
    if (!text || ui.busy) return;
    pushChat({ role: "user", text });
    ui.busy = true;
    rerender();
    let r = null;
    try { r = await askAi(text); } catch (_e) { r = null; }
    const local = detectLocal(text);
    const res = r || { ...local, when: /\bayer\b/i.test(text) ? "ayer" : "hoy", reply: localReply(local) };
    // Si es de ayer, se registra ayer en la tarde
    const ts = res.when === "ayer" ? (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(20, 0, 0, 0); return d.getTime(); })() : Date.now();
    const factors = [...new Set([...(res.factors || []), ...autoFactors({ date: new Date(ts), sleepLog: st().sleepLog || [], ledger: st().financeLedger || [] })])];
    const signals = [...new Set(res.signals || [])];
    let entryId = null;
    if (res.state || signals.length || factors.length) {
      entryId = addEntry({ ts, state: res.state || null, signals, factors, text, source: "chat" }).id;
    }
    pushChat({ role: "carl", text: res.reply || "Anotado.", entryId });
    ui.busy = false;
    try { window.persist?.(); } catch (_e) {}
    rerender();
  };
  root.querySelector("#tdSend")?.addEventListener("click", send);
  root.querySelector("#tdInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); send(); } });
  root.querySelectorAll("[data-td-quick]").forEach((b) => b.addEventListener("click", () => {
    const state = b.dataset.tdQuick;
    const factors = autoFactors({ date: new Date(), sleepLog: st().sleepLog || [], ledger: st().financeLedger || [] });
    const e = addEntry({ state, signals: [], factors, text: "", source: "quick" });
    pushChat({ role: "carl", text: `${STATES[state].emoji} Anotado: ${STATES[state].label.toLowerCase()}. Si quieres, cuéntame qué está pasando o toca ＋ para marcar qué notas.`, entryId: e.id });
    ui.editing = state === "green" ? null : e.id;
    try { window.persist?.(); } catch (_e) {}
    rerender();
  }));
  root.querySelectorAll("[data-td-state]").forEach((b) => b.addEventListener("click", () => { updateEntry(b.dataset.tdState, { state: b.dataset.v }); rerender(); }));
  root.querySelectorAll("[data-td-rm]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const e = loadTdha().entries.find((x) => x.id === b.dataset.tdRm);
    if (!e) return;
    const key = b.dataset.kind === "sig" ? "signals" : "factors";
    updateEntry(e.id, { [key]: (e[key] || []).filter((x) => x !== b.dataset.id) });
    rerender();
  }));
  root.querySelectorAll("[data-td-add]").forEach((b) => b.addEventListener("click", () => {
    const e = loadTdha().entries.find((x) => x.id === b.dataset.tdAdd);
    if (!e) return;
    const key = b.dataset.kind === "sig" ? "signals" : "factors";
    updateEntry(e.id, { [key]: [...new Set([...(e[key] || []), b.dataset.id])] });
    rerender();
  }));
  root.querySelectorAll("[data-td-edit]").forEach((b) => b.addEventListener("click", () => { ui.editing = ui.editing === b.dataset.tdEdit ? null : b.dataset.tdEdit; rerender(); }));
  root.querySelector("[data-td-edit-done]")?.addEventListener("click", () => { ui.editing = null; try { window.persist?.(); } catch (_e) {} rerender(); });
  root.querySelectorAll("[data-td-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("¿Borrar este registro?")) return;
    deleteEntry(b.dataset.tdDel);
    try { window.persist?.(); } catch (_e) {}
    rerender();
  }));
  root.querySelector("[data-td-clear]")?.addEventListener("click", () => {
    if (!confirm("¿Limpiar la conversación? Los registros y patrones se quedan.")) return;
    clearChat();
    rerender();
  });
  const log = root.querySelector("#tdLog");
  if (log) log.scrollTop = log.scrollHeight;
}

function tdCss() {
  return `<style>
  .tdWrap { display:flex; flex-direction:column; gap:10px; padding:10px; }
  .tdQuick { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:13px; }
  .tdQuickBtn { border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05); color:inherit; border-radius:999px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .tdLog { display:flex; flex-direction:column; gap:8px; max-height:52vh; overflow-y:auto; padding:4px; }
  .tdMsg { display:flex; flex-direction:column; max-width:92%; }
  .tdMsgUser { align-self:flex-end; }
  .tdMsgCarl { align-self:flex-start; }
  .tdBubble { padding:9px 12px; border-radius:14px; font-size:14px; line-height:1.4; }
  .tdMsgUser .tdBubble { background:rgba(124,92,255,.35); }
  .tdMsgCarl .tdBubble { background:rgba(255,255,255,.06); }
  .tdTyping { font-size:12px; opacity:.7; }
  .tdInputBar { display:flex; gap:8px; align-items:flex-end; }
  .tdInput { flex:1; resize:none; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; border-radius:12px; padding:9px 10px; font-size:14px; }
  .tdSend { width:46px; height:46px; border-radius:12px; border:none; background:#7c5cff; color:#fff; font-size:18px; cursor:pointer; }
  .tdRow { display:flex; justify-content:flex-end; }
  .tdEntry { margin-top:6px; padding:6px 8px; border:1px solid rgba(255,255,255,.08); border-radius:10px; }
  .tdEntryStates { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
  .tdStateBtn { background:none; border:1px solid transparent; border-radius:8px; font-size:16px; padding:2px 4px; cursor:pointer; opacity:.45; }
  .tdStateOn { opacity:1; border-color:rgba(255,255,255,.25); }
  .tdEntryLbl { font-size:12px; opacity:.8; margin-right:auto; }
  .tdMini { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; border-radius:8px; font-size:12px; padding:3px 8px; cursor:pointer; }
  .tdChips { display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; }
  .tdChip { font-size:12px; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); display:inline-flex; gap:4px; align-items:center; color:inherit; }
  .tdChip--sig { background:rgba(251,191,36,.12); border-color:rgba(251,191,36,.3); }
  .tdChip--fac { background:rgba(124,92,255,.14); border-color:rgba(124,92,255,.35); }
  .tdChipAdd { cursor:pointer; }
  .tdChipX { background:none; border:none; color:inherit; opacity:.6; cursor:pointer; font-size:11px; padding:0 0 0 2px; }
  .tdPicker { margin-top:6px; }
  .tdPickTitle, .tdColTitle { font-size:12px; font-weight:700; margin-top:8px; opacity:.85; }
  .tdCard { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:10px 12px; }
  .tdCard > summary { cursor:pointer; font-weight:700; }
  .tdHint { font-size:12px; opacity:.7; margin-top:6px; }
  .tdStrip { display:flex; gap:4px; overflow-x:auto; margin:8px 0; }
  .tdDay { text-align:center; min-width:34px; }
  .tdDayDot { font-size:16px; }
  .tdDayLbl { font-size:10px; opacity:.65; }
  .tdCols { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @media (max-width: 520px) { .tdCols { grid-template-columns:1fr; } }
  .tdPat { display:flex; flex-direction:column; padding:5px 0; border-bottom:1px solid rgba(255,255,255,.05); font-size:13px; }
  .tdPatWhy { font-size:11px; opacity:.7; }
  </style>`;
}

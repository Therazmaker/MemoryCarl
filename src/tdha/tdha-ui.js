/**
 * tdha-ui.js — Pestaña TDHA de NeuroChat
 * MemoryCarl
 *
 * Un chat propio: la persona escribe como se siente ("tengo mucha sed", "ayer estaba irritable")
 * y la IA (Claude, o Gemini de respaldo; reglas locales sin conexión) registra el estado, las
 * señales y las activaciones. Debajo: registro rápido 🟢🟡🔴 y "lo que voy viendo" (qué regula
 * y qué desregula). No diagnostica.
 */

import { STATES, SIGNALS, FACTORS, detectLocal, autoFactors, dailyView, patterns, signalCounts, parseTdhaReply, tdhaSystemPrompt, factorInfo, signalInfo, hookStatus, hookSpending, hookStats, forgetStats, forgetInfo, FORGET_KINDS } from "./tdhaEngine.js";
import { loadTdha, addEntry, updateEntry, deleteEntry, pushChat, clearChat, upsertHook, updateHook, deleteHook, addForget, updateForget, deleteForget } from "./tdhaStore.js";
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

// ---------- Visuales ----------

const STATE_COLOR = { green: "#22c55e", yellow: "#eab308", red: "#ef4444" };

/** 🗓️ Mapa de 8 semanas: un cuadrito por día (lunes arriba), pintado por cómo estuviste. */
function heatmapSvg(entries) {
  const byDay = new Map(dailyView(entries).map((d) => [d.day, d]));
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const weeks = 8;
  const start = new Date(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cell = 15; const gap = 3; const left = 22; const top = 14;
  const W = left + weeks * (cell + gap); const H = top + 7 * (cell + gap);
  let rects = "";
  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + r);
      if (d > today) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const day = byDay.get(k);
      const fill = day?.state ? STATE_COLOR[day.state] : "rgba(255,255,255,.08)";
      const tip = `${d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" })}${day?.state ? ` · ${STATES[day.state].label}` : " · sin registro"}`;
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${fill}"><title>${esc(tip)}</title></rect>`;
    }
  }
  const dows = ["L", "", "M", "", "V", "", "D"].map((l, r) => l ? `<text x="4" y="${top + r * (cell + gap) + 11}" font-size="9" fill="currentColor" opacity=".6">${l}</text>` : "").join("");
  return `<svg class="tdSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa de 8 semanas">${dows}${rects}</svg>
    <div class="tdLegend"><span><i style="background:${STATE_COLOR.green}"></i>Regulado</span><span><i style="background:${STATE_COLOR.yellow}"></i>A medias</span><span><i style="background:${STATE_COLOR.red}"></i>Desregulado</span></div>`;
}

/** 🔁 Río de enganches: una barra por enganche en la línea de tiempo. */
function hooksRiver(hooks) {
  const st = appState();
  const now = Date.now();
  const list = hooks.map((h) => ({ ...h, ...hookStatus(h, now), spend: hookSpending(h, { ledger: st.financeLedger || [], history: st.shoppingHistory || [] }, now) }))
    .sort((a, b) => b.firstTs - a.firstTs).slice(0, 12);
  if (!list.length) return `<div class="tdHint">Cuando me cuentes que algo te tiene enganchado (“pienso mucho en…”, “no me lo saco de la cabeza”), aparece aquí con cuánto te duró.</div>`;
  const from = Math.min(...list.map((h) => h.firstTs)) - 86400000;
  const span = Math.max(now - from, 7 * 86400000);
  const W = 320; const rowH = 30; const H = list.length * rowH + 8;
  const x = (t) => 4 + ((t - from) / span) * (W - 8);
  const bars = list.map((h, i) => {
    const y = 4 + i * rowH;
    const x1 = x(h.firstTs); const x2 = Math.max(x(h.endTs), x1 + 6);
    const color = h.active ? "#a78bfa" : "rgba(167,139,250,.45)";
    // nombre arriba de la barra, alineado para que no se salga
    const lx = Math.min(Math.max(x1, 4), W - 4);
    const anchor = lx > W * 0.6 ? "end" : "start";
    return `<text x="${anchor === "end" ? Math.min(x2, W - 4) : lx}" y="${y + 9}" font-size="9" fill="currentColor" text-anchor="${anchor}" opacity=".85">${esc(h.name.slice(0, 30))} · ${h.days} d</text>
      <rect x="${x1}" y="${y + 13}" width="${x2 - x1}" height="10" rx="5" fill="${color}"><title>${esc(h.name)} · ${h.days} día${h.days === 1 ? "" : "s"}</title></rect>
      ${(h.mentions || []).map((m) => `<circle cx="${x(m)}" cy="${y + 18}" r="2" fill="#fff" opacity=".85"/>`).join("")}`;
  }).join("");
  const stats = hookStats(hooks, now);
  const rows = list.map((h) => `
    <div class="tdHook">
      <div><b>🔁 ${esc(h.name)}</b> <span class="tdPatWhy">${h.active ? "sigue" : "ya pasó"} · ${h.days} día${h.days === 1 ? "" : "s"} · ${h.mentionCount} mención${h.mentionCount === 1 ? "" : "es"}${h.spend.count ? ` · 💸 ${h.spend.count} compra${h.spend.count === 1 ? "" : "s"} (S/ ${h.spend.total.toFixed(2)})` : ""}</span></div>
      <div class="tdHookBtns">
        ${h.active ? `<button class="tdMini" data-td-hook-end="${esc(h.id)}">Ya pasó</button>` : `<button class="tdMini" data-td-hook-back="${esc(h.id)}">Sigue</button>`}
        <button class="tdMini" data-td-hook-del="${esc(h.id)}" title="Borrar">🗑</button>
      </div>
    </div>`).join("");
  return `
    <svg class="tdSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Enganches en el tiempo">${bars}</svg>
    ${stats.avgDays ? `<div class="tdHint">Tus enganches suelen durar ~${stats.avgDays} día${stats.avgDays === 1 ? "" : "s"}${stats.everyDays ? ` y llega uno nuevo cada ~${stats.everyDays} días` : ""}.</div>` : ""}
    ${rows}`;
}

/** 🕸️ Grafo: activaciones alrededor de 🟢 y 🔴, el grosor es qué tan fuerte es la relación. */
function regulationGraph(entries) {
  const p = patterns(entries, { minDays: 2 });
  const nodes = [...p.helps.slice(0, 6).map((r) => ({ ...r, side: "green" })), ...p.hurts.slice(0, 6).map((r) => ({ ...r, side: "red" }))];
  if (p.days < p.need || !nodes.length) return `<div class="tdHint">El grafo aparece cuando haya ${p.need}+ días y alguna relación clara (llevas ${p.days}).</div>`;
  const W = 320; const H = 240;
  const hub = { green: { x: 120, y: H / 2 }, red: { x: 200, y: H / 2 } };
  // Cada centro abre sus activaciones en abanico hacia su lado
  const place = (arr, side) => arr.map((n, i) => {
    const t = arr.length === 1 ? 0 : -1 + (2 * i) / (arr.length - 1);
    const ang = t * (65 * Math.PI / 180);
    const r = 92;
    const dir = side === "green" ? -1 : 1;
    return { ...n, x: hub[side].x + dir * r * Math.cos(ang), y: H / 2 + r * Math.sin(ang) };
  });
  const g = place(nodes.filter((n) => n.side === "green"), "green");
  const r = place(nodes.filter((n) => n.side === "red"), "red");
  const edge = (n) => `<line x1="${hub[n.side].x}" y1="${hub[n.side].y}" x2="${n.x}" y2="${n.y}" stroke="${STATE_COLOR[n.side]}" stroke-width="${Math.max(1.5, Math.min(8, n.delta / 10))}" opacity=".7"/>`;
  const node = (n) => `<g><circle cx="${n.x}" cy="${n.y}" r="13" fill="rgba(20,20,30,.95)" stroke="${STATE_COLOR[n.side]}"/><text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13">${n.emoji}</text><text x="${n.x}" y="${n.y + 25}" text-anchor="middle" font-size="8" fill="currentColor" opacity=".75">${esc(n.label.split(" / ")[0].slice(0, 14))}</text><title>${esc(n.label)} · ${n.side === "red" ? `🔴 ${n.redWith}% vs ${n.redWithout}%` : `🟢 ${n.greenWith}% vs ${n.greenWithout}%`}</title></g>`;
  const hubs = Object.entries(hub).map(([k, h]) => `<circle cx="${h.x}" cy="${h.y}" r="17" fill="${STATE_COLOR[k]}" opacity=".9"/><text x="${h.x}" y="${h.y + 32}" text-anchor="middle" font-size="10" fill="currentColor" font-weight="700">${k === "green" ? "Regula" : "Desregula"}</text>`).join("");
  return `<svg class="tdSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafo de lo que regula y desregula">${[...g, ...r].map(edge).join("")}${hubs}${[...g, ...r].map(node).join("")}</svg>
    <div class="tdHint">Más grueso = relación más fuerte. Toca un círculo para ver los números.</div>`;
}

/** 💨 Mis olvidos: qué, cuándo, lo que se repite y con qué aparece más. */
function forgetsHtml(forgets, entries) {
  const st = forgetStats(forgets, entries);
  const recent = [...forgets].sort((a, b) => b.ts - a.ts).slice(0, 10);
  if (!recent.length) return `<div class="tdHint">Cuando me cuentes que se te olvidó algo (“se me olvidó la billetera”, “no me acordé de pagar la luz”) lo anoto aquí. Con el tiempo te muestro qué se te olvida más, a qué hora y con qué se relaciona.</div>`;
  const maxPart = Math.max(1, ...Object.values(st.parts));
  const partsSvg = `<svg class="tdSvg" viewBox="0 0 300 70" role="img" aria-label="Olvidos por momento del día">${Object.entries(st.parts).map(([k, n], i) => {
    const w = (n / maxPart) * 190;
    return `<text x="0" y="${16 + i * 22}" font-size="10" fill="currentColor" opacity=".8">${k}</text><rect x="60" y="${6 + i * 22}" width="${Math.max(2, w)}" height="13" rx="6" fill="#f59e0b" opacity="${n ? 0.85 : 0.2}"/><text x="${66 + w}" y="${16 + i * 22}" font-size="10" fill="currentColor">${n}</text>`;
  }).join("")}</svg>`;
  const kinds = Object.entries(st.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const f = forgetInfo(k); return `<span class="tdChip tdChip--sig">${f.emoji} ${esc(f.label)} ×${n}</span>`; }).join("");
  const when = (ts) => new Date(ts).toLocaleString("es-PE", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows = recent.map((f) => {
    const k = forgetInfo(f.kind);
    return `
    <div class="tdHook ${f.resolved ? "tdDone" : ""}">
      <div>${k.emoji} <b>${esc(f.what)}</b> <span class="tdPatWhy">${esc(when(f.ts))}${f.pending && !f.resolved ? " · pendiente" : ""}${f.resolved ? " · resuelto" : ""}${f.reminderId ? " · ⏰ en recordatorios" : ""}</span></div>
      <div class="tdHookBtns">
        ${f.pending && !f.resolved && !f.reminderId ? `<button class="tdMini" data-td-fg-remind="${esc(f.id)}">⏰ Recordármelo</button>` : ""}
        ${f.pending && !f.resolved ? `<button class="tdMini" data-td-fg-done="${esc(f.id)}">✅</button>` : ""}
        <button class="tdMini" data-td-fg-del="${esc(f.id)}" title="Borrar">🗑</button>
      </div>
    </div>`;
  }).join("");
  return `
    <div class="tdHint">${st.total} olvido${st.total === 1 ? "" : "s"} en los últimos 60 días${st.pending ? ` · ${st.pending} pendiente${st.pending === 1 ? "" : "s"}` : ""}.</div>
    ${kinds ? `<div class="tdChips">${kinds}</div>` : ""}
    ${st.repeated.length ? `<div class="tdColTitle">🔁 Se te repite</div><div class="tdChips">${st.repeated.map((r) => `<span class="tdChip">“${esc(r.word)}” ×${r.n}</span>`).join("")}</div>` : ""}
    <div class="tdColTitle">¿A qué hora?</div>${partsSvg}
    ${st.related.length ? `<div class="tdColTitle">Olvidas más los días con…</div>${st.related.map((r) => `<div class="tdPat"><span>${r.emoji} ${esc(r.label)}</span><span class="tdPatWhy">olvidos el ${r.withPct}% de esos días vs ${r.withoutPct}% sin eso · ${r.n} días</span></div>`).join("")}` : ""}
    <div class="tdColTitle">Últimos</div>${rows}`;
}

function visualsHtml(entries, hooks, forgets = []) {
  return `
    <details class="tdCard" open><summary>💨 Mis olvidos</summary>${forgetsHtml(forgets, entries)}</details>
    <details class="tdCard" open><summary>🗓️ Mis últimas 8 semanas</summary>${heatmapSvg(entries)}</details>
    <details class="tdCard" open><summary>🔁 Mis enganches</summary>${hooksRiver(hooks)}</details>
    <details class="tdCard"><summary>🕸️ Grafo: qué me regula y qué me desregula</summary>${regulationGraph(entries)}</details>`;
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
  const { entries, chat, hooks, forgets } = loadTdha();
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
        <button class="tdQuickBtn" data-td-forgot>💨 Se me olvidó…</button>
      </div>
      <div class="tdLog" id="tdLog">${intro}${msgs}${ui.busy ? `<div class="tdTyping">🧠 Carl está entendiendo…</div>` : ""}</div>
      <div class="tdInputBar">
        <textarea id="tdInput" class="tdInput" rows="2" placeholder="Cuéntame cómo estás o qué pasó…"></textarea>
        <button id="tdSend" class="tdSend" ${ui.busy ? "disabled" : ""}>➤</button>
      </div>
      <div class="tdRow"><button class="tdMini" data-td-clear>🧹 Limpiar chat (los registros se quedan)</button></div>
      ${insightsHtml(entries)}
      ${visualsHtml(entries, hooks, forgets)}
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
    // Enganche: lo nombra la IA o se saca del texto ("pienso mucho en…")
    const hookName = res.hook || local.hook;
    // Olvido: lo entiende la IA o se saca del texto ("se me olvidó…")
    const forgot = res.forgot || local.forgot;
    const signals = [...new Set([...(res.signals || []), ...(hookName ? ["enganche"] : []), ...(forgot ? ["olvido"] : [])])];
    if (hookName) upsertHook(hookName, ts);
    if (forgot) addForget({ ts, what: forgot.what, kind: forgot.kind, pending: Boolean(forgot.pending) });
    let entryId = null;
    if (res.state || signals.length || factors.length) {
      entryId = addEntry({ ts, state: res.state || null, signals, factors, text, source: "chat", ...(hookName ? { hook: hookName } : {}) }).id;
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
  root.querySelector("[data-td-forgot]")?.addEventListener("click", () => {
    const inp = root.querySelector("#tdInput");
    if (inp) { inp.value = "Se me olvidó "; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });
  root.querySelectorAll("[data-td-fg-remind]").forEach((b) => b.addEventListener("click", () => {
    const f = (loadTdha().forgets || []).find((x) => x.id === b.dataset.tdFgRemind);
    const s0 = st();
    if (!f || !Array.isArray(s0.reminders)) return;
    const id = `m_${Date.now().toString(36)}`;
    s0.reminders.unshift({ id, text: `💨 ${f.what}`, done: false });
    updateForget(f.id, { reminderId: id });
    try { window.persist?.(); } catch (_e) {}
    try { window.toast?.("⏰ Agregado a tus recordatorios"); } catch (_e) {}
    rerender();
  }));
  root.querySelectorAll("[data-td-fg-done]").forEach((b) => b.addEventListener("click", () => { updateForget(b.dataset.tdFgDone, { resolved: true }); try { window.persist?.(); } catch (_e) {} rerender(); }));
  root.querySelectorAll("[data-td-fg-del]").forEach((b) => b.addEventListener("click", () => { if (!confirm("¿Borrar este olvido?")) return; deleteForget(b.dataset.tdFgDel); try { window.persist?.(); } catch (_e) {} rerender(); }));
  root.querySelectorAll("[data-td-hook-end]").forEach((b) => b.addEventListener("click", () => { updateHook(b.dataset.tdHookEnd, { endedTs: Date.now() }); try { window.persist?.(); } catch (_e) {} rerender(); }));
  root.querySelectorAll("[data-td-hook-back]").forEach((b) => b.addEventListener("click", () => { updateHook(b.dataset.tdHookBack, { endedTs: undefined, lastTs: Date.now() }); try { window.persist?.(); } catch (_e) {} rerender(); }));
  root.querySelectorAll("[data-td-hook-del]").forEach((b) => b.addEventListener("click", () => { if (!confirm("¿Borrar este enganche?")) return; deleteHook(b.dataset.tdHookDel); try { window.persist?.(); } catch (_e) {} rerender(); }));
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
  .tdSvg { width:100%; height:auto; display:block; margin-top:8px; color:inherit; }
  .tdLegend { display:flex; gap:10px; font-size:11px; opacity:.8; margin-top:4px; }
  .tdLegend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:middle; }
  .tdHook { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.05); font-size:13px; }
  .tdHookBtns { display:flex; gap:4px; flex:none; }
  .tdDone { opacity:.55; }
  </style>`;
}

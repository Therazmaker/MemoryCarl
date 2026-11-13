/**
 * basket-ui.js — "La Canasta": chat de compras que aprende cómo compra la casa
 * MemoryCarl · Compras
 *
 * - Pegas la lista (tuya o la que te pasa Fergis) y Carl la ordena: qué hace falta,
 *   qué puede esperar según cada cuánto lo compran, qué es gusto y qué no tiene precio.
 * - "Ya lo compré" guarda la compra (quién compró, tienda, precios reales) y de ahí aprende.
 * - Arriba, gráficos: gasto por semana contra el mínimo, lo que toca pronto y en qué se va.
 * - Preguntas libres van a Claude con el contexto de lo aprendido.
 */

import { parseListText, learnRhythm, weeklyMinimum, analyzeList, weeklySpend, categorySpend, matchProduct, isWeighed, weighedLine, weighedHistoryFields } from "./basketEngine.js";
import { enrichProductData } from "./productIntelligence.js";
import { callClaude } from "./shoppingAi.js";
import { getClaudeSettings } from "../services/claudeClient.js";
import { MEAL_TYPES, mealLabel, mealEmoji, guessMealType, runway, impact, streetPatterns, streetEntries, parseSpendIntent } from "../finance/streetFood.js";
import { looksLikeRoutine, parseRoutineText, routinesOf, daysLabel, WEEKDAYS, ALL_DAYS } from "../finance/routines.js";

const SKIPS_KEY = "memorycarl_street_skips_v1";
// Datos de Finanzas que pasa main.js (caja real y obligaciones del mes)
let ENV = {};
const loadSkips = () => { const v = loadJson(SKIPS_KEY, []); return Array.isArray(v) ? v : []; };

function moneyNow(L) {
  try {
    const m = ENV.getMoney?.();
    if (!m) return null;
    return runway({ availableCash: m.availableCash, items: m.items, homeFoodPerWeek: L.minimum.total, routines: routinesOf(ENV.state?.products || []) });
  } catch (_e) { return null; }
}

const STATUS = {
  ok: { icon: "✅", label: "Alcanza", cls: "bkStOk" },
  justo: { icon: "⚠️", label: "Queda justo", cls: "bkStWarn" },
  no: { icon: "🛑", label: "No llegan al cobro", cls: "bkStBad" },
};

function runwayCard(rw) {
  if (!rw) return "";
  const share = rw.free > 0 ? Math.max(0, Math.min(100, ((rw.homeFoodNeed + (rw.routine?.total || 0)) / rw.free) * 100)) : 100;
  return `
    <div class="bkCard">
      <div class="bkCardTitle">💸 Hasta el cobro (${esc(rw.payday.label)}, en ${rw.payday.daysLeft} día${rw.payday.daysLeft === 1 ? "" : "s"})</div>
      <div class="bkRunNums">
        <div><div class="bkTileVal">${esc(soles(rw.free))}</div><div class="bkTileLbl">libre (S/ ${esc((rw.perDay).toFixed(2))} por día)</div></div>
        <div><div class="bkTileVal ${rw.extra < 0 ? "bkNeg" : ""}">${esc(soles(rw.extra))}</div><div class="bkTileLbl">extra, ya separada la comida de casa${rw.routine?.total ? " y tu rutina" : ""}</div></div>
      </div>
      <div class="bkSplit" title="Comida de casa vs. extra">
        <div class="bkSplitHome" style="width:${share}%"></div>
      </div>
      ${rw.routine?.total ? `<div class="bkRoutineLine">🛡️ Tu rutina está asegurada: ${esc(soles(rw.routine.total))} apartados (${rw.routine.items.map((i) => `${esc(i.name)} ×${i.daysCount}`).join(", ")})</div>` : ""}
      <div class="bkDueMeta">Caja ${esc(soles(rw.cash))} − pagos antes del cobro ${esc(soles(rw.pending))}${rw.dueItems.length ? ` (${rw.dueItems.slice(0, 3).map((d) => esc(d.name)).join(", ")}${rw.dueItems.length > 3 ? "…" : ""})` : ""} · comida de casa ~${esc(soles(rw.homeFoodNeed))}</div>
    </div>`;
}

function streetCard(state) {
  const p = streetPatterns(streetEntries(state.financeLedger || []), { skipped: loadSkips() });
  const max = Math.max(1, ...p.byType.map((t) => Math.max(t.week.total, t.typical.total)));
  const rows = p.byType.filter((t) => t.week.count || t.typical.count).map((t) => `
    <div class="bkHRow bkStreetRow" data-tip="${esc(t.label)}: esta semana ${t.week.count} (${esc(soles(t.week.total))}) · lo normal ${t.typical.count} por semana (${esc(soles(t.typical.total))})">
      <div class="bkHLabel">${t.emoji} ${esc(t.label)}</div>
      <div class="bkHTrack bkMarkTrack"><div class="bkHFill" style="width:${Math.max(2, (t.week.total / max) * 100)}%"></div>${t.typical.total ? `<div class="bkMark" style="left:${(t.typical.total / max) * 100}%"></div>` : ""}</div>
      <div class="bkHVal">${t.week.count}× ${esc(soles(t.week.total))}</div>
    </div>`).join("");
  return `
    <div class="bkCard">
      <div class="bkCardTitle">🍔 Comida en la calle esta semana · ${esc(soles(p.weekTotal))}</div>
      ${rows || `<div class="bkEmpty">Cuando usen “¿Me alcanza?” y compren, aquí verán desayunos, almuerzos, cenas, snacks y meriendas.</div>`}
      ${rows ? `<div class="bkDueMeta">La rayita amarilla es lo normal por semana (últimas 4). Este mes: ${esc(soles(p.month))} en ${p.monthCount} compra${p.monthCount === 1 ? "" : "s"}.</div>` : ""}
      ${p.insights.map((i) => `<div class="bkInsight">• ${esc(i)}</div>`).join("")}
      <div class="bkTip" data-tip-out></div>
    </div>`;
}

function checkCard(msg, L) {
  const d = msg.data;
  if (d.decided) {
    const what = `${mealEmoji(d.mealType)} ${esc(mealLabel(d.mealType))}${d.desc ? ` · ${esc(d.desc)}` : ""} · ${esc(soles(d.amount))}`;
    return `<div class="bkCardMsg"><div class="bkSaved ${d.decided === "skipped" ? "" : "bkSavedNeutral"}">${d.decided === "skipped" ? "💪 Mejor no" : "🍽️ Lo compraron"}: ${what}</div></div>`;
  }
  const rw = moneyNow(L);
  return `
    <div class="bkCardMsg" data-check="${esc(msg.id)}">
      <div class="bkGroupTitle">🍔 ¿Me alcanza?</div>
      <div class="bkFormRow">
        <input class="bkInput" data-c="desc" placeholder="¿Qué? (pollo, menú, galletas…)" value="${esc(d.desc || "")}"/>
        <input class="bkInput bkNum bkAmount" data-c="amount" type="number" inputmode="decimal" step="0.5" min="0" placeholder="S/" value="${esc(d.amount || "")}"/>
      </div>
      <div class="bkMeals">${MEAL_TYPES.map((m) => `<button class="bkMeal ${d.mealType === m.id ? "bkMealOn" : ""}" data-meal="${m.id}">${m.emoji} ${esc(m.label)}</button>`).join("")}</div>
      <div class="bkFormRow"><span>¿Quién paga?</span>${BUYERS.map((b) => `<button class="bkMeal ${d.who === b.id ? "bkMealOn" : ""}" data-who="${b.id}">${b.label}</button>`).join("")}</div>
      <div class="bkImpact" data-impact>${impactHtml(rw, d.amount, d.who)}</div>
      <div class="bkActions">
        <button class="bkBtn" data-c-skip>💪 Mejor no</button>
        <button class="bkBtn bkBtnPrimary" data-c-buy>🍽️ Lo compramos</button>
      </div>
    </div>`;
}

const DAY_OPTS = [{ id: "wk", label: "Lun–Vie", days: WEEKDAYS }, { id: "all", label: "Todos los días", days: ALL_DAYS }, { id: "we", label: "Fines de semana", days: [0, 6] }];
const dayOptOf = (days) => (DAY_OPTS.find((o) => o.days.join(",") === [...days].sort().join(",")) || DAY_OPTS[0]).id;

function routineCard(msg) {
  const d = msg.data;
  if (d.saved) return `<div class="bkCardMsg"><div class="bkSaved">🛡️ Rutina protegida: ${d.items.map((i) => `${esc(i.name)} (${esc(soles(i.price * i.qty))}, ${esc(daysLabel(i.days))})`).join(" · ")}</div></div>`;
  return `
    <div class="bkCardMsg" data-routine="${esc(msg.id)}">
      <div class="bkGroupTitle">🛡️ ¿Protejo esta rutina?</div>
      <div class="bkHint">No la voy a cuestionar: la aparto hasta cada cobro para que siempre esté.</div>
      ${d.items.map((it, i) => `
        <div class="bkRoutineRow" data-i="${i}">
          <input class="bkInput" data-r="name" value="${esc(it.name)}" aria-label="Qué"/>
          <input class="bkInput bkNum" data-r="qty" type="number" min="1" step="1" value="${esc(it.qty)}" aria-label="Cantidad por día"/>
          <input class="bkInput bkNum" data-r="price" type="number" min="0" step="0.1" value="${esc(it.price)}" aria-label="Precio"/>
          <select class="bkInput" data-r="days">${DAY_OPTS.map((o) => `<option value="${o.id}" ${dayOptOf(it.days) === o.id ? "selected" : ""}>${o.label}</option>`).join("")}</select>
        </div>`).join("")}
      <div class="bkActions"><button class="bkBtn bkBtnPrimary" data-r-save>🛡️ Proteger esta rutina</button></div>
    </div>`;
}

function routinesListCard(state) {
  const list = routinesOf(state.products || []);
  if (!list.length) return `<div class="bkBubble">Todavía no tienes rutinas protegidas. Escríbeme algo como:\n“Mis bebidas del trabajo: Volt 2.50 y café 3 de lunes a viernes”\ny lo aparto hasta cada cobro.</div>`;
  return `
    <div class="bkCardMsg">
      <div class="bkGroupTitle">🛡️ Tus rutinas protegidas</div>
      ${list.map((r) => `<div class="bkItem"><div class="bkItemMain"><div class="bkItemName">${esc(r.name)}${r.qty > 1 ? ` ×${r.qty}` : ""}</div><div class="bkItemWhy">${esc(daysLabel(r.days))}${r.label ? ` · ${esc(r.label)}` : ""}</div></div><div class="bkItemPrice">${esc(soles(r.price * r.qty))}/día</div><button class="bkX" data-r-remove="${esc(r.productId)}" title="Dejar de proteger">✕</button></div>`).join("")}
      <div class="bkHint">Para cambiar una, escríbela de nuevo con el precio nuevo.</div>
    </div>`;
}

function impactHtml(rw, amount, who = "yo") {
  if (who === "fergis") return `<div class="bkHint">💜 Lo paga Fergis con su dinero: no cambia lo tuyo hasta el cobro${rw ? ` (${esc(soles(rw.free))} libres)` : ""}. Igual queda anotado para ver los patrones.</div>`;
  if (!rw) return `<div class="bkHint">Para saber si alcanza necesito tus cuentas en Finanzas.</div>`;
  if (!(Number(amount) > 0)) return `<div class="bkHint">Libre hasta ${esc(rw.payday.label)}: <b>${esc(soles(rw.free))}</b> (S/ ${rw.perDay.toFixed(2)} por día). Después de la comida de casa quedan ${esc(soles(rw.extra))}. Escribe cuánto cuesta.</div>`;
  const im = impact(rw, amount);
  const st = STATUS[im.status];
  return `
    <div class="bkVerdict ${st.cls}">${st.icon} ${st.label}</div>
    <div class="bkImpRow"><span>Libre hasta ${esc(rw.payday.label)}</span><b>${esc(soles(rw.free))} → ${esc(soles(im.freeAfter))}</b></div>
    <div class="bkImpRow"><span>Por día (${rw.payday.daysLeft} d)</span><b>S/ ${rw.perDay.toFixed(2)} → S/ ${im.perDayAfter.toFixed(2)}</b></div>
    <div class="bkImpRow"><span>Extra después de la comida de casa${rw.routine?.total ? " y tu rutina" : ""}</span><b class="${im.extraAfter < 0 ? "bkNeg" : ""}">${esc(soles(im.extraAfter))}</b></div>
    ${rw.routine?.total ? `<div class="bkRoutineLine">🛡️ Tu rutina (${esc(soles(rw.routine.total))}) ${im.extraAfter < 0 && im.freeAfter - rw.homeFoodNeed < rw.routine.total ? "se vería afectada con esta compra" : "sigue asegurada"}.</div>` : ""}
    ${im.status === "no" ? `<div class="bkHint">Si lo compran, falta${im.extraAfter < 0 ? `n ${esc(soles(-im.extraAfter))}` : ""} para la comida de casa${rw.routine?.total ? " y tu rutina" : ""} hasta el cobro.</div>` : ""}`;
}


const CHAT_KEY = "memorycarl_basket_chat_v1";
const UI_KEY = "memorycarl_basket_ui_v1";
const BUYERS = [{ id: "yo", label: "Yo" }, { id: "fergis", label: "Fergis" }];

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const soles = (n) => `S/ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mid = () => `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch (_e) { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* sin espacio */ }
}
const loadChat = () => { const c = loadJson(CHAT_KEY, []); return Array.isArray(c) ? c : []; };
const saveChat = (c) => saveJson(CHAT_KEY, c.slice(-60));

function learn(state) {
  const history = Array.isArray(state.shoppingHistory) ? state.shoppingHistory : [];
  const products = Array.isArray(state.products) ? state.products : [];
  const rhythm = learnRhythm(history, { products });
  return { history, products, rhythm, minimum: weeklyMinimum(rhythm) };
}

// ---------- Gráficos (SVG simple, una sola serie, con detalle al tocar) ----------

function weeksChart(weeks, minimum) {
  if (!weeks.some((w) => w.total > 0)) return `<div class="bkEmpty">Cuando guarden compras, aquí verás cuánto gastan cada semana comparado con el mínimo.</div>`;
  const W = 320; const H = 150; const padL = 34; const padB = 22; const padT = 10;
  const max = Math.max(minimum || 0, ...weeks.map((w) => w.total), 1) * 1.15;
  const bw = (W - padL - 8) / weeks.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map((v) => Math.round(v));
  const bars = weeks.map((w, i) => {
    const x = padL + i * bw + bw * 0.18;
    const h = Math.max(0, H - padB - y(w.total));
    const d = new Date(`${w.start}T12:00:00`);
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    const isLast = i === weeks.length - 1;
    return `
      <g class="bkBar" data-tip="Semana del ${esc(label)}: ${esc(soles(w.total))}${Object.keys(w.byBuyer).length ? ` · ${Object.entries(w.byBuyer).map(([k, v]) => `${k === "fergis" ? "Fergis" : k === "yo" ? "Tú" : "?"} ${soles(v)}`).join(" · ")}` : ""}">
        <rect x="${x - bw * 0.18}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
        <rect x="${x}" y="${y(w.total)}" width="${bw * 0.64}" height="${h}" rx="4" class="${isLast ? "bkBarNow" : "bkBarFill"}"/>
        <text x="${x + bw * 0.32}" y="${H - 6}" class="bkAxis" text-anchor="middle">${esc(label)}</text>
      </g>`;
  }).join("");
  const minLine = minimum ? `
    <line x1="${padL}" x2="${W - 4}" y1="${y(minimum)}" y2="${y(minimum)}" class="bkMinLine"/>
    <text x="${W - 6}" y="${y(minimum) - 4}" class="bkMinText" text-anchor="end">mínimo ${esc(soles(minimum))}</text>` : "";
  return `
    <svg viewBox="0 0 ${W} ${H}" class="bkSvg" role="img" aria-label="Gasto en compras por semana">
      ${ticks.map((t) => `<line x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" class="bkGrid"/><text x="${padL - 4}" y="${y(t) + 3}" class="bkAxis" text-anchor="end">${t}</text>`).join("")}
      ${bars}
      ${minLine}
    </svg>`;
}

function categoryChart(cats) {
  if (!cats.length) return `<div class="bkEmpty">Todavía no hay compras en los últimos 30 días.</div>`;
  const top = cats.slice(0, 6);
  const max = Math.max(...top.map((c) => c.total), 1);
  return top.map((c) => `
    <div class="bkHRow" data-tip="${esc(c.category)}: ${esc(soles(c.total))}">
      <div class="bkHLabel">${esc(c.category)}</div>
      <div class="bkHTrack"><div class="bkHFill" style="width:${Math.max(3, (c.total / max) * 100)}%"></div></div>
      <div class="bkHVal">${esc(soles(c.total))}</div>
    </div>`).join("");
}

function dueList(rhythm) {
  const rows = [...rhythm.values()]
    .filter((s) => s.intervalDays && s.confidence !== "baja" && s.dueInDays <= 5)
    .sort((a, b) => a.dueInDays - b.dueInDays)
    .slice(0, 8);
  if (!rows.length) {
    const learning = [...rhythm.values()].filter((s) => s.purchases >= 1).length;
    return `<div class="bkEmpty">${learning ? `Estoy aprendiendo el ritmo de ${learning} producto${learning === 1 ? "" : "s"}. Con 2 o 3 compras de cada uno ya sé cuándo toca.` : "Guarda tus compras y aprendo cada cuánto compran cada cosa."}</div>`;
  }
  return rows.map((s) => {
    const pct = Math.min(100, Math.round((s.daysSince / s.intervalDays) * 100));
    const label = s.dueInDays < 0 ? `⚠️ tocaba hace ${-s.dueInDays} d` : s.dueInDays === 0 ? "🛒 toca hoy" : `⏳ en ${s.dueInDays} d`;
    return `
      <div class="bkDue" data-tip="${esc(s.name)}: cada ~${s.intervalDays} días · última compra hace ${s.daysSince} días · ${esc(soles(s.lastPrice))}">
        <div class="bkDueTop"><span class="bkDueName">${esc(s.name)}</span><span class="bkDueWhen">${label}</span></div>
        <div class="bkDueTrack"><div class="bkDueFill ${s.dueInDays <= 0 ? "bkDueFillNow" : ""}" style="width:${pct}%"></div></div>
        <div class="bkDueMeta">cada ~${s.intervalDays} días · ${esc(soles(s.lastPrice))}${s.confidence === "alta" ? "" : " · aprendiendo"}</div>
      </div>`;
  }).join("");
}

function renderDashboard(state, L, hasChat = false) {
  const ui = loadJson(UI_KEY, {});
  const weeks = weeksChart(weeklySpend(L.history, { weeks: 8 }), L.minimum.total);
  const thisWeek = weeklySpend(L.history, { weeks: 1 })[0];
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = { yo: 0, fergis: 0, otro: 0 };
  for (const e of L.history) {
    if (!String(e?.date || "").startsWith(monthKey)) continue;
    const t = Number(e.totals?.total) || 0;
    if (e.buyer === "yo") month.yo += t; else if (e.buyer === "fergis") month.fergis += t; else month.otro += t;
  }
  const minConf = { ninguna: "sin datos aún", baja: "estimación inicial", media: "confiable" }[L.minimum.confidence] || "";
  return `
    <details class="bkDash" ${(ui.dashClosed ?? hasChat) ? "" : "open"} id="bkDash">
      <summary>📊 Cómo compramos</summary>
      <div class="bkTiles">
        <div class="bkTile"><div class="bkTileVal">${L.minimum.total ? esc(soles(L.minimum.total)) : "—"}</div><div class="bkTileLbl">Mínimo para pasar la semana</div><div class="bkTileSub">${esc(minConf)}</div></div>
        <div class="bkTile"><div class="bkTileVal">${esc(soles(thisWeek?.total || 0))}</div><div class="bkTileLbl">Llevan esta semana</div><div class="bkTileSub">${L.minimum.total ? (thisWeek.total > L.minimum.total ? `+${soles(thisWeek.total - L.minimum.total)} sobre el mínimo` : `${soles(L.minimum.total - thisWeek.total)} bajo el mínimo`) : ""}</div></div>
        <div class="bkTile"><div class="bkTileVal">${esc(soles(month.yo + month.fergis + month.otro))}</div><div class="bkTileLbl">Este mes</div><div class="bkTileSub">Tú ${esc(soles(month.yo))} · Fergis ${esc(soles(month.fergis))}</div></div>
      </div>
      ${runwayCard(moneyNow(L))}
      ${streetCard(state)}
      <div class="bkCard">
        <div class="bkCardTitle">Gasto por semana</div>
        ${weeks}
        <div class="bkTip" data-tip-out>Toca una barra para ver el detalle. La barra con borde es esta semana.</div>
      </div>
      <div class="bkCard">
        <div class="bkCardTitle">Lo que toca pronto</div>
        ${dueList(L.rhythm)}
      </div>
      <div class="bkCard">
        <div class="bkCardTitle">En qué se va (últimos 30 días)</div>
        ${categoryChart(categorySpend(L.history, { days: 30 }))}
      </div>
    </details>`;
}

// ---------- Mensajes ----------

const GROUPS = [
  { id: "falta", title: "✅ Hace falta", hint: "" },
  { id: "sinprecio", title: "❓ Sin precio todavía", hint: "Pon el precio cuando compres y lo aprendo." },
  { id: "espera", title: "⏳ Puede esperar", hint: "Según cada cuánto lo compran, todavía no toca." },
  { id: "gusto", title: "🎁 Gustos", hint: "No está mal: solo para que se vea aparte." },
];

function analysisCard(msg) {
  const d = msg.data;
  const off = new Set(d.off || []);
  const picked = d.items.filter((it) => !off.has(it.id));
  const total = picked.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  const groups = GROUPS.map((g) => {
    const items = d.items.filter((it) => it.group === g.id);
    if (!items.length) return "";
    return `
      <div class="bkGroup">
        <div class="bkGroupTitle">${g.title} <span class="bkCount">${items.length}</span></div>
        ${g.hint ? `<div class="bkGroupHint">${g.hint}</div>` : ""}
        ${items.map((it) => `
          <label class="bkItem ${off.has(it.id) ? "bkItemOff" : ""}">
            <input type="checkbox" data-bk-toggle="${esc(msg.id)}" data-item="${esc(it.id)}" ${off.has(it.id) ? "" : "checked"} ${d.saved ? "disabled" : ""}/>
            <div class="bkItemMain">
              <div class="bkItemName">${esc(it.name)}${it.qty && it.qty !== 1 ? ` <span class="bkQty">× ${esc(it.qty)}${esc(it.unit ? ` ${it.unit}` : "")}</span>` : ""}</div>
              <div class="bkItemWhy">${esc(it.reason)}</div>
            </div>
            <div class="bkItemPrice">${it.price ? esc(soles(it.price * it.qty)) : "—"}</div>
          </label>`).join("")}
      </div>`;
  }).join("");
  const missing = !d.saved && d.missing?.length ? `
    <div class="bkMissing">
      <div class="bkGroupTitle">🔔 ¿No se olvidan de esto? Ya les toca</div>
      ${d.missing.map((m) => `<div class="bkMissRow">• ${esc(m.name)} <span class="bkItemWhy">(cada ~${m.intervalDays} días${m.overdue > 0 ? `, tocaba hace ${m.overdue}` : ""})</span></div>`).join("")}
      <button class="bkBtn" data-bk-addmissing="${esc(msg.id)}">➕ Agregarlos</button>
    </div>` : "";
  const waitNote = d.totals.wait > 0 && !d.saved ? `<div class="bkSave">💡 Si dejas lo que puede esperar, hoy gastas ${esc(soles(d.totals.wait))} menos.</div>` : "";
  const footer = d.saved
    ? `<div class="bkSaved">✅ Compra guardada: ${esc(soles(d.savedTotal))}${d.savedBuyer ? ` · compró ${esc(d.savedBuyer === "fergis" ? "Fergis" : "Tú")}` : ""}${d.savedStore ? ` · ${esc(d.savedStore)}` : ""}</div>`
    : `<div class="bkTotalRow"><span>Lo marcado</span><b>${esc(soles(total))}</b></div>
       <div class="bkActions">
         <button class="bkBtn bkBtnPrimary" data-bk-buy="${esc(msg.id)}">🧾 Ya lo compré</button>
       </div>
       <div class="bkBuyForm" id="bkBuy_${esc(msg.id)}" hidden></div>`;
  return `<div class="bkCardMsg">${groups}${missing}${waitNote}${footer}</div>`;
}

function buyForm(msg, ctx) {
  const d = msg.data;
  const off = new Set(d.off || []);
  const picked = d.items.filter((it) => !off.has(it.id));
  const hasFinance = (ctx.state.financeAccounts || []).length > 0;
  return `
    <div class="bkFormRow">
      <span>¿Quién compró?</span>
      ${BUYERS.map((b, i) => `<label class="bkChip"><input type="radio" name="bkBuyer_${esc(msg.id)}" value="${b.id}" ${i === 0 ? "checked" : ""}/> ${b.label}</label>`).join("")}
    </div>
    <div class="bkFormRow"><input class="bkInput" data-f="store" placeholder="Tienda (opcional)"/><input class="bkInput" type="date" data-f="date" value="${todayISO()}"/></div>
    <div class="bkFormHint">Corrige precio y cantidad si cambiaron: así aprendo el precio real.</div>
    ${picked.map((it) => it.weighed ? `
      <div class="bkFormItem bkWeighed" data-item="${esc(it.id)}" data-ppk="${esc(it.price || 0)}">
        <span class="bkFormName">${esc(it.name)} <span class="bkQty">por kg</span></span>
        <input class="bkInput bkNum" type="number" step="0.001" min="0" data-f="kg" placeholder="¿kg?" aria-label="Kilos (si lo sabes)"/>
        <input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="paid" placeholder="Pagué S/" aria-label="Lo que pagaste"/>
        <span class="bkWeighHint" data-weigh-hint>${it.price ? `Pon lo que pagaste; los kg son opcionales (S/ ${esc(it.price)}/kg)` : "Pon lo que pagaste y los kg para aprender el precio por kg"}</span>
      </div>` : `
      <div class="bkFormItem" data-item="${esc(it.id)}">
        <span class="bkFormName">${esc(it.name)}</span>
        <input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="qty" value="${esc(it.qty || 1)}" aria-label="Cantidad"/>
        <input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="price" value="${esc(it.price || "")}" placeholder="S/" aria-label="Precio por unidad"/>
      </div>`).join("")}
    ${hasFinance ? `<label class="bkFormRow"><input type="checkbox" data-f="finance" checked/> Registrar el gasto en Finanzas</label>` : ""}
    <button class="bkBtn bkBtnPrimary" data-bk-save="${esc(msg.id)}">Guardar compra</button>`;
}

function messageHtml(msg) {
  if (msg.role === "user") return `<div class="bkMsg bkMsgUser"><div class="bkBubble">${esc(msg.text).replace(/\n/g, "<br>")}</div></div>`;
  if (msg.type === "routine") return `<div class="bkMsg bkMsgCarl">${routineCard(msg)}</div>`;
  if (msg.type === "routines") return `<div class="bkMsg bkMsgCarl">${routinesListCard(ENV.state || {})}</div>`;
  if (msg.type === "check") return `<div class="bkMsg bkMsgCarl">${checkCard(msg, learn(ENV.state || {}))}</div>`;
  const body = msg.type === "analysis" ? analysisCard(msg) : `<div class="bkBubble">${esc(msg.text).replace(/\n/g, "<br>")}</div>`;
  return `<div class="bkMsg bkMsgCarl">${msg.type === "analysis" && msg.text ? `<div class="bkBubble">${esc(msg.text)}</div>` : ""}${body}</div>`;
}

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const buyerLabel = (b) => (b === "fergis" ? "Fergis" : b === "yo" ? "Tú" : "¿Quién?");
const entryTotal = (e) => Number(e?.totals?.total) || (e?.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);

function purchaseEditor(e) {
  return `
    <div class="bkFormRow"><span>¿Quién compró?</span>
      ${BUYERS.map((b) => `<label class="bkChip"><input type="radio" name="bkEdBuyer_${esc(e.id)}" value="${b.id}" ${e.buyer === b.id ? "checked" : ""}/> ${b.label}</label>`).join("")}
    </div>
    <div class="bkFormRow"><input class="bkInput" data-f="store" placeholder="Tienda" value="${esc(e.store || "")}"/><input class="bkInput" type="date" data-f="date" value="${esc(e.date || todayISO())}"/></div>
    ${(e.items || []).map((it, i) => Number(it.weight_g) > 0 ? `
      <div class="bkFormItem bkEdItem" data-idx="${i}" data-weighed="1">
        <span class="bkFormName">${esc(it.name)} <span class="bkQty">${it.weightEstimated ? "≈" : ""}kg · pagado</span></span>
        <input class="bkInput bkNum" type="number" step="0.001" min="0" data-f="kg" value="${it.weightEstimated ? "" : esc(Number(it.weight_g) / 1000)}" placeholder="${esc(Math.round(Number(it.weight_g)) / 1000)}" aria-label="Kilos"/>
        <span class="bkPriceCell"><input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="price" value="${esc(it.price ?? 0)}" aria-label="Pagado"/><button class="bkX" data-bk-rmitem="${i}" title="Quitar">✕</button></span>
      </div>` : `
      <div class="bkFormItem bkEdItem" data-idx="${i}">
        <span class="bkFormName">${esc(it.name)}</span>
        <input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="qty" value="${esc(it.qty ?? 1)}" aria-label="Cantidad"/>
        <span class="bkPriceCell"><input class="bkInput bkNum" type="number" step="0.01" min="0" data-f="price" value="${esc(it.price ?? 0)}" aria-label="Precio"/><button class="bkX" data-bk-rmitem="${i}" title="Quitar">✕</button></span>
      </div>`).join("")}
    <div class="bkActions">
      <button class="bkBtn" data-bk-edcancel>Cancelar</button>
      <button class="bkBtn bkBtnPrimary" data-bk-edsave="${esc(e.id)}">Guardar cambios</button>
    </div>`;
}

function renderPurchases(state, ui) {
  const hist = [...(Array.isArray(state.shoppingHistory) ? state.shoppingHistory : [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const shown = hist.slice(0, ui.purchasesAll ? hist.length : 40);
  if (!hist.length) return `<div class="bkEmpty">Todavía no hay compras guardadas. Cuando toques “Ya lo compré”, aparecen aquí.</div>`;
  const noBuyer = hist.filter((e) => !e.buyer).length;
  return `
    <div class="bkHint">Estas son las compras de las que aprendo. Si alguna tiene un precio mal, está repetida o falta quién compró, corrígela aquí.</div>
    ${noBuyer ? `<div class="bkHint">👤 ${noBuyer} compra${noBuyer === 1 ? "" : "s"} sin “quién compró”: puedes asignarlo editándolas.</div>` : ""}
    ${shown.map((e) => {
      const d = new Date(`${e.date}T12:00:00`);
      const label = Number.isNaN(d.getTime()) ? esc(e.date || "sin fecha") : `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
      const items = e.items || [];
      return `
        <div class="bkPurchase" data-pid="${esc(e.id)}">
          <div class="bkPTop">
            <div><b>${label}</b> · <span class="bkBuyerChip ${e.buyer ? "" : "bkBuyerNone"}">${buyerLabel(e.buyer)}</span>${e.store ? ` · ${esc(e.store)}` : ""}</div>
            <b>${esc(soles(entryTotal(e)))}</b>
          </div>
          <div class="bkPItems">${items.slice(0, 6).map((it) => `${esc(it.name)}${Number(it.qty) && Number(it.qty) !== 1 ? ` ×${esc(it.qty)}` : ""}`).join(" · ")}${items.length > 6 ? ` · +${items.length - 6} más` : ""}</div>
          <div class="bkActions">
            <button class="bkBtn" data-bk-edit="${esc(e.id)}">✏️ Editar</button>
            <button class="bkBtn" data-bk-del="${esc(e.id)}">🗑️ Borrar</button>
          </div>
          <div class="bkBuyForm" id="bkEd_${esc(e.id)}" hidden></div>
        </div>`;
    }).join("")}
    ${hist.length > shown.length ? `<button class="bkBtn" data-bk-allpurch>Ver las ${hist.length}</button>` : ""}`;
}

export function renderBasket(state, env = {}) {
  ENV = { ...env, state };
  const L = learn(state);
  const chat = loadChat();
  const ui = loadJson(UI_KEY, {});
  if (ui.view === "purchases") {
    return `
    ${css()}
    <div class="bkWrap">
      <div class="bkHead">
        <button class="bkBack" data-bk-back>←</button>
        <div><div class="bkTitle">🧺 La Canasta</div><div class="bkSub">Compras guardadas</div></div>
      </div>
      <div class="bkTabs"><button class="bkTab" data-bk-view="chat">💬 Chat</button><button class="bkTab bkTabOn" data-bk-view="purchases">🧾 Compras guardadas (${(state.shoppingHistory || []).length})</button></div>
      ${renderPurchases(state, ui)}
    </div>`;
  }
  const intro = !chat.length ? `
    <div class="bkMsg bkMsgCarl"><div class="bkBubble">Hola 👋 Pega aquí la lista de compras (la tuya o la que te pasa Fergis, como venga) y te digo qué hace falta, qué puede esperar y cuánto sale. Cuando compren, toca “Ya lo compré” y así aprendo cada cuánto compran cada cosa.</div></div>` : "";
  return `
    ${css()}
    <div class="bkWrap">
      <div class="bkHead">
        <button class="bkBack" data-bk-back>←</button>
        <div><div class="bkTitle">🧺 La Canasta</div><div class="bkSub">Pega la lista, yo aprendo cómo compran</div></div>
      </div>
      <div class="bkTabs"><button class="bkTab bkTabOn" data-bk-view="chat">💬 Chat</button><button class="bkTab" data-bk-view="purchases">🧾 Compras guardadas (${(state.shoppingHistory || []).length})</button></div>
      ${renderDashboard(state, L, chat.length > 0)}
      <div class="bkLog" id="bkLog">${intro}${chat.map(messageHtml).join("")}<div class="bkTyping" id="bkTyping" hidden>Carl está pensando…</div></div>
      <div class="bkQuick">
        <button class="bkChipBtn bkChipHot" data-bk-quick="check">🍔 ¿Me alcanza?</button>
        <button class="bkChipBtn" data-bk-quick="routines">🛡️ Mi rutina</button>
        <button class="bkChipBtn" data-bk-quick="due">🔔 ¿Qué toca comprar?</button>
        <button class="bkChipBtn" data-bk-quick="min">📉 ¿Cuánto es lo mínimo?</button>
        ${chat.length ? `<button class="bkChipBtn" data-bk-quick="clear">🧹 Limpiar chat</button>` : ""}
      </div>
      <div class="bkComposer">
        <textarea id="bkInput" class="bkTextarea" rows="2" placeholder="Pega la lista o pregúntame algo…"></textarea>
        <button class="bkSend" id="bkSend" aria-label="Enviar">➤</button>
      </div>
    </div>`;
}

// ---------- Lógica del chat ----------

function looksLikeList(text) {
  const t = text.trim();
  if (/\?\s*$/.test(t) && !t.includes("\n")) return false;
  const parsed = parseListText(t);
  return t.includes("\n") ? parsed.length >= 1 : parsed.length >= 2;
}

function dueText(L) {
  const due = [...L.rhythm.values()].filter((s) => s.intervalDays && s.confidence !== "baja" && s.dueInDays <= 3).sort((a, b) => a.dueInDays - b.dueInDays);
  if (!due.length) return "Por lo que aprendí, ahora no les toca nada básico. Si quieres, pega lo que piensan comprar y lo reviso.";
  return `Según cada cuánto compran, esto ya toca o toca en estos días:\n${due.map((s) => `• ${s.name} — ${s.dueInDays <= 0 ? "ya toca" : `en ${s.dueInDays} días`} (~${soles(s.lastPrice)})`).join("\n")}\n\nSi quieres te armo la lista: escribe “armar”.`;
}

function minimumText(L) {
  if (!L.minimum.items.length) return "Todavía no tengo suficientes compras para calcular el mínimo. Guarda 2 o 3 compras y lo calculo.";
  return `Para pasar una semana, con lo básico que consumen, necesitan como mínimo ${soles(L.minimum.total)}${L.minimum.confidence === "baja" ? " (estimación inicial, mejora con más compras)" : ""}.\nLo que más pesa:\n${L.minimum.items.slice(0, 6).map((i) => `• ${i.name}: ${soles(i.cost)}/semana`).join("\n")}`;
}

function contextForClaude(L, chat) {
  const rhythm = [...L.rhythm.values()].filter((s) => s.purchases >= 1).sort((a, b) => (a.dueInDays ?? 99) - (b.dueInDays ?? 99)).slice(0, 40)
    .map((s) => `${s.name}: ${s.intervalDays ? `cada ~${s.intervalDays} días` : "ritmo desconocido"}, última hace ${s.daysSince} días, ${soles(s.lastPrice)}${s.tier ? `, ${s.tier}` : ""}`).join("\n");
  const weeks = weeklySpend(L.history, { weeks: 8 }).map((w) => `${w.start}: ${soles(w.total)}`).join(", ");
  const last = [...chat].reverse().find((m) => m.type === "analysis");
  const list = last ? last.data.items.map((it) => `${it.name} ×${it.qty} ${soles(it.price * it.qty)} [${it.group}]`).join("; ") : "";
  const rw = moneyNow(L);
  const fmtD = (d) => d.toISOString().slice(0, 10);
  const money = rw
    ? `Dinero (de Finanzas, dato real): caja disponible ${soles(rw.cash)}; próximo cobro ${rw.payday.label} (${fmtD(rw.payday.date)}, faltan ${rw.payday.daysLeft} días); pagos pendientes antes del cobro ${soles(rw.pending)}${rw.dueItems.length ? ` (${rw.dueItems.slice(0, 6).map((i) => `${i.name} ${soles(i.amount)}`).join(", ")})` : ""}; libre ${soles(rw.free)} (${soles(rw.perDay)}/día); comida de casa hasta el cobro ${soles(rw.homeFoodNeed)}; rutinas apartadas ${soles(rw.routine.total)}; extra después de todo ${soles(rw.extra)}.`
    : "Dinero: Finanzas no tiene cuentas cargadas; si el usuario dice cuánto tiene y cuándo cobra, usa eso.";
  const routines = routinesOf(ENV.state?.products || []).map((r) => `${r.name} ${soles(r.price)} × ${r.qty} (${daysLabel(r.days)})`).join("; ");
  const sp = streetPatterns(streetEntries(ENV.state?.financeLedger || []), { skipped: loadSkips() });
  return `${money}\n${routines ? `Rutinas protegidas (no se cuestionan): ${routines}\n` : ""}Comida en la calle: esta semana ${soles(sp.weekTotal)} (lo normal ${soles(sp.typicalTotal)}/semana), este mes ${soles(sp.month)}.\n\nRitmo de compra aprendido (de su historial):\n${rhythm || "sin datos"}\n\nMínimo semanal estimado: ${soles(L.minimum.total)} (${L.minimum.confidence})\nGasto en compras por semana: ${weeks}\n${list ? `Última lista analizada: ${list}` : ""}`;
}

const SYSTEM = `Eres Carl dentro de "La Canasta", el chat de compras de una familia en Perú (compran él y su pareja, Fergis; moneda soles). El objetivo no es prohibir, es que el dinero alcance hasta el próximo cobro: ayudas a decidir qué comprar ahora, qué puede esperar, cantidades justas y sustitutos más baratos, usando SOLO los datos de abajo (no inventes precios). El dinero disponible, el próximo cobro y los pagos pendientes ya están abajo: no preguntes por ellos, úsalos (si el usuario da otra cifra, usa la suya). Las rutinas protegidas no se cuestionan. Para un gasto concreto di claro si alcanza o no y cómo queda el resto hasta el cobro. Responde en español, corto y concreto (máximo 6 líneas o una lista breve), sin sermones ni preguntas innecesarias.`;

async function askClaude(text, L, chat) {
  const s = getClaudeSettings();
  if (!s.apiKey) return "Para preguntas libres necesito la clave de Claude (Ajustes de NeuroChat). Mientras tanto puedo: analizar una lista pegada, decirte qué toca comprar o cuánto es lo mínimo.";
  const history = chat.filter((m) => m.type !== "analysis").slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text || "" })).filter((m) => m.content);
  const messages = [{ role: "system", content: `${SYSTEM}\n\n${contextForClaude(L, chat)}` }, ...history, { role: "user", content: text }];
  try {
    const out = await callClaude(messages, s.apiKey, s.model);
    return String(out?.text ?? out ?? "").trim() || "No me llegó respuesta, intenta de nuevo.";
  } catch (err) {
    return `No pude consultar a Claude: ${err?.message || "error"}`;
  }
}

/**
 * Conecta los eventos. ctx = { state, persist, view, toast, uid, recordFinance }
 */
export function wireBasket(root, ctx) {
  const { state } = ctx;
  const log = root.querySelector("#bkLog");
  const input = root.querySelector("#bkInput");
  // Al volver a dibujar, se muestra lo último del chat (la página entera se desplaza)
  const scrollDown = () => {
    const last = log?.querySelector(".bkMsg:last-of-type");
    if (last && loadChat().length) last.scrollIntoView({ block: "start", behavior: "auto" });
  };
  setTimeout(scrollDown, 30);

  const rerender = () => { ctx.view(); };
  const push = (msg) => { const c = loadChat(); c.push({ id: mid(), ts: Date.now(), ...msg }); saveChat(c); };
  const update = (id, fn) => { const c = loadChat(); const m = c.find((x) => x.id === id); if (m) { fn(m); saveChat(c); } };

  root.querySelector("[data-bk-back]")?.addEventListener("click", () => { state.shoppingSubtab = "lists"; ctx.view(); });
  root.querySelectorAll("[data-bk-view]").forEach((b) => b.addEventListener("click", () => {
    const ui = loadJson(UI_KEY, {}); ui.view = b.dataset.bkView; saveJson(UI_KEY, ui); ctx.view();
  }));
  root.querySelector("[data-bk-allpurch]")?.addEventListener("click", () => {
    const ui = loadJson(UI_KEY, {}); ui.purchasesAll = true; saveJson(UI_KEY, ui); ctx.view();
  });
  const findEntry = (id) => (state.shoppingHistory || []).find((e) => e.id === id);
  root.querySelectorAll("[data-bk-del]").forEach((b) => b.addEventListener("click", () => {
    const e = findEntry(b.dataset.bkDel);
    if (!e) return;
    const hasFin = typeof ctx.financeForPurchase === "function" && ctx.financeForPurchase(e.sourceListId);
    if (!confirm(`¿Borrar la compra del ${e.date} (${soles(entryTotal(e))})?${hasFin ? "\n\nTambién se borrará su gasto en Finanzas." : ""}`)) return;
    state.shoppingHistory = (state.shoppingHistory || []).filter((x) => x.id !== e.id);
    if (hasFin) ctx.deleteFinanceForPurchase?.(e.sourceListId);
    ctx.persist();
    ctx.toast?.("Compra borrada");
    ctx.view();
  }));
  root.querySelectorAll("[data-bk-edit]").forEach((b) => b.addEventListener("click", () => {
    const e = findEntry(b.dataset.bkEdit);
    const box = root.querySelector(`#bkEd_${CSS.escape(b.dataset.bkEdit)}`);
    if (!e || !box) return;
    const draft = JSON.parse(JSON.stringify(e));
    const draw = () => {
      box.innerHTML = purchaseEditor(draft);
      box.hidden = false;
      // Mantener lo escrito al quitar una fila
      const readRows = () => box.querySelectorAll(".bkEdItem").forEach((row) => {
        const it = draft.items[Number(row.dataset.idx)];
        if (!it) return;
        if (row.dataset.weighed) {
          // Por peso: precio = lo pagado; los kg escritos son reales, si no se estiman
          const paid = Math.max(0, Number(row.querySelector('[data-f="price"]').value) || 0);
          const product = (state.products || []).find((p) => p.id === it.productId);
          const line = weighedLine({ pricePerKg: Number(it.pricePerKg) || Number(product?.price) || 0, paid, kg: row.querySelector('[data-f="kg"]').value });
          if (line) {
            const { weightEstimated: _drop, ...rest } = it;
            Object.assign(it, { ...rest, ...weighedHistoryFields(line) });
            if (!line.estimated) delete it.weightEstimated;
          } else { it.price = paid; it.qty = 1; }
          return;
        }
        it.qty = Math.max(0.01, Number(row.querySelector('[data-f="qty"]').value) || 1);
        it.price = Math.max(0, Number(row.querySelector('[data-f="price"]').value) || 0);
      });
      box.querySelectorAll("[data-bk-rmitem]").forEach((x) => x.addEventListener("click", () => {
        readRows();
        draft.buyer = box.querySelector(`input[name="bkEdBuyer_${CSS.escape(e.id)}"]:checked`)?.value || draft.buyer || "";
        draft.store = box.querySelector('[data-f="store"]').value.trim();
        draft.date = box.querySelector('[data-f="date"]').value || draft.date;
        draft.items.splice(Number(x.dataset.bkRmitem), 1);
        draw();
      }));
      box.querySelector("[data-bk-edcancel]")?.addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
      box.querySelector("[data-bk-edsave]")?.addEventListener("click", () => {
        readRows();
        if (!draft.items.length) { ctx.toast?.("Una compra sin productos: mejor bórrala."); return; }
        const target = findEntry(e.id);
        if (!target) return;
        target.buyer = box.querySelector(`input[name="bkEdBuyer_${CSS.escape(e.id)}"]:checked`)?.value || "";
        target.store = box.querySelector('[data-f="store"]').value.trim();
        target.date = box.querySelector('[data-f="date"]').value || target.date;
        // Si es la compra más reciente de un producto, el precio corregido pasa a la biblioteca
        const before = new Map((target.items || []).map((it) => [it.id, Number(it.price) || 0]));
        for (const it of draft.items) {
          if (Number(it.weight_g) > 0) {
            // Por peso: solo se aprende el precio por kg si los kg son reales
            if (!it.productId || it.weightEstimated || !(it.pricePerKg > 0)) continue;
            const newerW = (state.shoppingHistory || []).some((h) => h.id !== target.id && String(h.date) > String(target.date) && (h.items || []).some((x) => x.productId === it.productId));
            const prodW = (state.products || []).find((p) => p.id === it.productId);
            if (newerW || !prodW || Math.abs(Number(prodW.price || 0) - it.pricePerKg) < 0.01) continue;
            prodW.history = Array.isArray(prodW.history) ? prodW.history : [];
            prodW.history.push({ price: prodW.price, date: new Date().toISOString() });
            prodW.price = it.pricePerKg;
            continue;
          }
          if (!it.productId || before.get(it.id) === it.price || !(it.price > 0)) continue;
          const newer = (state.shoppingHistory || []).some((h) => h.id !== target.id && String(h.date) > String(target.date) && (h.items || []).some((x) => x.productId === it.productId));
          const product = (state.products || []).find((p) => p.id === it.productId);
          if (newer || !product || Math.abs(Number(product.price || 0) - it.price) < 0.01) continue;
          product.history = Array.isArray(product.history) ? product.history : [];
          product.history.push({ price: product.price, date: new Date().toISOString() });
          product.price = it.price;
        }
        target.items = draft.items;
        const total = Math.round(target.items.reduce((sum, it) => sum + it.price * it.qty, 0) * 100) / 100;
        const byCategory = {};
        for (const it of target.items) { const c = it.category || "Other"; byCategory[c] = Math.round(((byCategory[c] || 0) + it.price * it.qty) * 100) / 100; }
        target.totals = { ...(target.totals || {}), total, itemsCount: target.items.length, byCategory };
        ctx.updateFinanceForPurchase?.(target.sourceListId, { amount: total, dateISO: `${target.date}T12:00:00` });
        ctx.persist();
        ctx.toast?.("Compra actualizada");
        ctx.view();
      });
    };
    draw();
  }));

  root.querySelector("#bkDash")?.addEventListener("toggle", (e) => { const ui = loadJson(UI_KEY, {}); ui.dashClosed = !e.target.open; saveJson(UI_KEY, ui); });

  // Detalle al tocar barras y filas de los gráficos
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("click", () => {
      const card = el.closest(".bkCard");
      const out = card?.querySelector("[data-tip-out]");
      if (out) out.textContent = el.dataset.tip;
      else ctx.toast?.(el.dataset.tip);
      card?.querySelectorAll(".bkSel").forEach((x) => x.classList.remove("bkSel"));
      el.classList.add("bkSel");
    });
  });

  const send = async (text) => {
    const t = String(text || "").trim();
    if (!t) return;
    const L = learn(state);
    push({ role: "user", text: t });
    const lower = t.toLowerCase();
    if (/^(armar|arma la lista|armala)/.test(lower)) {
      const due = [...L.rhythm.values()].filter((s) => s.intervalDays && s.confidence !== "baja" && s.dueInDays <= 3);
      const parsed = due.map((s) => ({ raw: s.name, name: s.name, qty: s.avgQty, unit: "" }));
      if (!parsed.length) push({ role: "carl", type: "text", text: "No hay nada básico que ya toque. ¡Bien!" });
      else push({ role: "carl", type: "analysis", text: "Armé la lista con lo que ya toca:", data: { ...analyzeList(parsed, { products: L.products, rhythm: L.rhythm }), off: [] } });
      rerender();
      return;
    }
    // "Voy a comprar almuerzo… cuesta 12.10 más una Pepsi a 2.90" → ¿Me alcanza? con el total
    const spend = parseSpendIntent(t, new Date());
    const futureIntent = /\b(voy a|vamos a|quiero|queremos|me provoca|nos provoca|pienso|puedo|podemos|estoy por|me alcanza|nos alcanza)\b/.test(lower);
    if (spend && (futureIntent || !looksLikeRoutine(t))) {
      push({ role: "carl", type: "check", data: { amount: spend.amount, desc: spend.desc, mealType: spend.mealType, who: "yo", decided: null } });
      rerender();
      return;
    }
    if (looksLikeRoutine(t)) {
      const items = parseRoutineText(t);
      if (items.length) {
        push({ role: "carl", type: "routine", data: { items, saved: false } });
        rerender();
        return;
      }
    }
    if (looksLikeList(t)) {
      const parsed = parseListText(t);
      const a = analyzeList(parsed, { products: L.products, rhythm: L.rhythm });
      const counts = GROUPS.map((g) => [g, a.items.filter((i) => i.group === g.id).length]).filter(([, n]) => n);
      const WORDS = { falta: ["hace falta", "hacen falta"], sinprecio: ["sin precio", "sin precio"], espera: ["puede esperar", "pueden esperar"], gusto: ["gusto", "gustos"] };
      const text = `Revisé ${a.items.length} cosa${a.items.length === 1 ? "" : "s"}: ${counts.map(([g, n]) => `${n} ${WORDS[g.id][n === 1 ? 0 : 1]}`).join(", ")}. Total estimado ${soles(a.totals.all)}.`;
      push({ role: "carl", type: "analysis", text, data: { ...a, off: [] } });
      rerender();
      return;
    }
    const alc = lower.match(/me alcanza(?: para)?\s*(.*?)\s*(?:s\/\s*)?(\d+(?:[.,]\d+)?)\s*(?:soles)?\s*\??$/);
    if (alc) {
      const desc = alc[1].replace(/\b(un|una|unos)\b/g, "").trim();
      push({ role: "carl", type: "check", data: { amount: Number(alc[2].replace(",", ".")), desc, mealType: guessMealType(desc, new Date()), who: "yo", decided: null } });
      rerender();
      return;
    }
    // Solo la pregunta ("¿qué toca?", "qué falta comprar"), no frases como "así que faltan 15 días"
    if (/^\s*¿?\s*(y\s+)?qu[eé] (nos |me |les )?(toca|falta|hace falta|hay que comprar)\b/.test(lower)) { push({ role: "carl", type: "text", text: dueText(L) }); rerender(); return; }
    if (/m[ií]nimo/.test(lower)) { push({ role: "carl", type: "text", text: minimumText(L) }); rerender(); return; }
    rerender();
    const typing = document.getElementById("bkTyping");
    if (typing) typing.hidden = false;
    const answer = await askClaude(t, L, loadChat());
    push({ role: "carl", type: "text", text: answer });
    rerender();
  };

  root.querySelector("#bkSend")?.addEventListener("click", () => send(input?.value));
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(input.value); } });

  root.querySelectorAll("[data-bk-quick]").forEach((b) => b.addEventListener("click", () => {
    const q = b.dataset.bkQuick;
    const L = learn(state);
    if (q === "clear") { if (confirm("¿Limpiar el chat? Las compras guardadas no se borran.")) { saveChat([]); rerender(); } return; }
    if (q === "routines") { push({ role: "carl", type: "routines" }); rerender(); return; }
    if (q === "check") {
      push({ role: "carl", type: "check", data: { amount: "", desc: "", mealType: guessMealType("", new Date()), who: "yo", decided: null } });
      rerender();
      return;
    }
    push({ role: "user", text: q === "due" ? "¿Qué toca comprar?" : "¿Cuánto es lo mínimo para la semana?" });
    push({ role: "carl", type: "text", text: q === "due" ? dueText(L) : minimumText(L) });
    rerender();
  }));

  root.querySelectorAll("[data-routine]").forEach((card) => {
    const id = card.dataset.routine;
    card.querySelector("[data-r-save]")?.addEventListener("click", () => {
      const items = [...card.querySelectorAll(".bkRoutineRow")].map((row) => ({
        name: row.querySelector('[data-r="name"]').value.trim(),
        qty: Math.max(1, Math.round(Number(row.querySelector('[data-r="qty"]').value) || 1)),
        price: Math.max(0, Number(row.querySelector('[data-r="price"]').value) || 0),
        days: (DAY_OPTS.find((o) => o.id === row.querySelector('[data-r="days"]').value) || DAY_OPTS[0]).days,
      })).filter((it) => it.name && it.price > 0);
      if (!items.length) { ctx.toast?.("Pon al menos un precio."); return; }
      const label = loadChat().find((x) => x.id === id)?.data?.items?.[0]?.label || "";
      if (!Array.isArray(state.products)) state.products = [];
      for (const it of items) {
        let p = matchProduct(it.name, state.products);
        if (!p) {
          p = enrichProductData({ id: ctx.uid("p"), name: it.name, price: it.price, category: label === "Trabajo" ? "Trabajo" : "", history: [] });
          state.products.push(p);
        } else if (Math.abs(Number(p.price || 0) - it.price) > 0.009) {
          p.history = Array.isArray(p.history) ? p.history : [];
          p.history.push({ price: p.price, date: new Date().toISOString() });
          p.price = it.price;
        }
        p.routine = { qty: it.qty, days: it.days, label };
        // Una rutina es básica, no un gusto
        if (/gusto|premio|premium/.test(String(p.tier || ""))) p.tier = "base_diario";
      }
      update(id, (m) => { m.data = { items, saved: true }; });
      const rw = moneyNow(learn(state));
      push({ role: "carl", type: "text", text: rw
        ? `Listo 🛡️ Tu rutina queda protegida: aparto ${soles(rw.routine.total)} hasta ${rw.payday.label}. Cuando uses “¿Me alcanza?” la tengo en cuenta primero.`
        : "Listo 🛡️ Tu rutina queda protegida. Cuando estén tus cuentas en Finanzas, la aparto hasta cada cobro." });
      ctx.persist();
      rerender();
    });
  });
  root.querySelectorAll("[data-r-remove]").forEach((b) => b.addEventListener("click", () => {
    const p = (state.products || []).find((x) => x.id === b.dataset.rRemove);
    if (!p || !confirm(`¿Dejar de proteger “${p.name}”?`)) return;
    delete p.routine;
    ctx.persist();
    rerender();
  }));

  root.querySelectorAll("[data-check]").forEach((card) => {
    const id = card.dataset.check;
    const read = () => ({
      desc: card.querySelector('[data-c="desc"]').value.trim(),
      amount: Number(card.querySelector('[data-c="amount"]').value) || 0,
    });
    const refresh = () => {
      const { amount } = read();
      const who = loadChat().find((x) => x.id === id)?.data?.who || "yo";
      const box = card.querySelector("[data-impact]");
      if (box) box.innerHTML = impactHtml(moneyNow(learn(state)), amount, who);
    };
    card.querySelector('[data-c="amount"]')?.addEventListener("input", refresh);
    card.querySelector('[data-c="desc"]')?.addEventListener("change", () => {
      // Si escribe "lonchera", "pollo a la brasa"… se ajusta el tipo de comida
      const { desc } = read();
      if (!desc) return;
      const guess = guessMealType(desc, new Date());
      update(id, (m) => { m.data.desc = desc; m.data.amount = read().amount; m.data.mealType = guess; });
      card.querySelectorAll("[data-meal]").forEach((b) => b.classList.toggle("bkMealOn", b.dataset.meal === guess));
    });
    card.querySelectorAll("[data-meal]").forEach((b) => b.addEventListener("click", () => {
      update(id, (m) => { m.data.mealType = b.dataset.meal; });
      card.querySelectorAll("[data-meal]").forEach((x) => x.classList.toggle("bkMealOn", x === b));
    }));
    card.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => {
      update(id, (m) => { m.data.who = b.dataset.who; });
      card.querySelectorAll("[data-who]").forEach((x) => x.classList.toggle("bkMealOn", x === b));
      refresh();
    }));
    const decide = (decision) => {
      const { desc, amount } = read();
      if (!(amount > 0)) { ctx.toast?.("Escribe cuánto cuesta."); return; }
      const msg = loadChat().find((x) => x.id === id);
      const mealType = msg?.data?.mealType || guessMealType(desc, new Date());
      const who = msg?.data?.who || "yo";
      const rw = moneyNow(learn(state));
      const im = rw && who !== "fergis" ? impact(rw, amount) : null;
      if (decision === "bought") {
        const ok = ctx.recordStreetExpense?.({ amount, desc, mealType, who });
        if (ok === false) { ctx.toast?.("No pude registrarlo: revisa tus cuentas en Finanzas."); return; }
      } else {
        const skips = loadSkips();
        skips.push({ ts: Date.now(), amount, desc, mealType });
        saveJson(SKIPS_KEY, skips.slice(-300));
      }
      update(id, (m) => { m.data = { ...m.data, desc, amount, mealType, who, decided: decision }; });
      const p = streetPatterns(streetEntries(state.financeLedger || []), { skipped: loadSkips() });
      const tail = p.insights[0] ? `\n${p.insights[0]}` : "";
      push({ role: "carl", type: "text", text: decision === "bought"
        ? `Anotado en Finanzas (${mealLabel(mealType).toLowerCase()}, ${soles(amount)}).${im ? ` Quedan ${soles(im.freeAfter)} libres hasta ${rw.payday.label}: S/ ${im.perDayAfter.toFixed(2)} por día.` : ""}${tail}`
        : `Bien ahí 💪 Esos ${soles(amount)} siguen en casa.${rw ? ` Libre hasta ${rw.payday.label}: ${soles(rw.free)}.` : ""}${tail}` });
      ctx.persist();
      rerender();
    };
    card.querySelector("[data-c-buy]")?.addEventListener("click", () => decide("bought"));
    card.querySelector("[data-c-skip]")?.addEventListener("click", () => decide("skipped"));
  });

  root.querySelectorAll("[data-bk-toggle]").forEach((cb) => cb.addEventListener("change", () => {
    update(cb.dataset.bkToggle, (m) => {
      const off = new Set(m.data.off || []);
      if (cb.checked) off.delete(cb.dataset.item); else off.add(cb.dataset.item);
      m.data.off = [...off];
    });
    rerender();
  }));

  root.querySelectorAll("[data-bk-addmissing]").forEach((b) => b.addEventListener("click", () => {
    const L = learn(state);
    update(b.dataset.bkAddmissing, (m) => {
      const parsed = [...m.data.items.map((it) => ({ raw: it.written, name: it.written, qty: it.qty, unit: it.unit })),
        ...m.data.missing.map((x) => ({ raw: x.name, name: x.name, qty: x.qty, unit: "" }))];
      const a = analyzeList(parsed, { products: L.products, rhythm: L.rhythm });
      m.data = { ...a, missing: [], off: [] };
    });
    rerender();
  }));

  root.querySelectorAll("[data-bk-buy]").forEach((b) => b.addEventListener("click", () => {
    const msg = loadChat().find((x) => x.id === b.dataset.bkBuy);
    const box = root.querySelector(`#bkBuy_${CSS.escape(b.dataset.bkBuy)}`);
    if (!msg || !box) return;
    box.innerHTML = buyForm(msg, ctx);
    box.hidden = false;
    b.hidden = true;
    // Por peso: muestra al momento cuántos kg salen de lo pagado (o el precio real por kg)
    box.querySelectorAll(".bkWeighed").forEach((row) => {
      const hint = row.querySelector("[data-weigh-hint]");
      const upd = () => {
        const l = weighedLine({ pricePerKg: Number(row.dataset.ppk) || 0, paid: row.querySelector('[data-f="paid"]').value, kg: row.querySelector('[data-f="kg"]').value });
        if (!hint) return;
        if (!l) { if (Number(row.querySelector('[data-f="paid"]').value) > 0) hint.textContent = "Sin precio por kg todavía: pon también los kg"; return; }
        hint.textContent = l.estimated
          ? `≈ ${l.kg} kg a S/ ${l.pricePerKg}/kg (estimado)`
          : `${l.kg} kg · S/ ${l.paid} · S/ ${l.pricePerKg}/kg${Math.abs(l.pricePerKg - (Number(row.dataset.ppk) || 0)) > 0.009 ? " (lo aprendo)" : ""}`;
      };
      row.querySelectorAll("input").forEach((x) => x.addEventListener("input", upd));
    });
    box.querySelector("[data-bk-save]")?.addEventListener("click", () => saveBuy(msg.id, box));
  }));

  const saveBuy = (id, box) => {
    const msg = loadChat().find((x) => x.id === id);
    if (!msg) return;
    const off = new Set(msg.data.off || []);
    const buyer = box.querySelector(`input[name="bkBuyer_${CSS.escape(id)}"]:checked`)?.value || "";
    const store = box.querySelector('[data-f="store"]')?.value?.trim() || "";
    const date = box.querySelector('[data-f="date"]')?.value || todayISO();
    const sourceListId = `basket_${id}`;
    const items = [];
    for (const it of msg.data.items.filter((x) => !off.has(x.id))) {
      const row = box.querySelector(`.bkFormItem[data-item="${CSS.escape(it.id)}"]`);
      if (it.weighed) {
        // Por peso: basta con lo pagado; con los kg también aprende el precio real por kg
        const product = it.productId ? (state.products || []).find((p) => p.id === it.productId) : matchProduct(it.name, state.products || []);
        const line = weighedLine({
          pricePerKg: Number(product?.price) || it.price,
          paid: row?.querySelector('[data-f="paid"]')?.value,
          kg: row?.querySelector('[data-f="kg"]')?.value,
        });
        if (!line) {
          if (Number(row?.querySelector('[data-f="paid"]')?.value) > 0) {
            ctx.toast?.(`Pon también los kg de ${product?.name || it.name}: aún no sé su precio por kg.`);
            return;
          }
          continue;
        }
        if (product && !line.estimated && line.pricePerKg > 0 && Math.abs(Number(product.price || 0) - line.pricePerKg) > 0.009) {
          product.history = Array.isArray(product.history) ? product.history : [];
          product.history.push({ price: product.price, date: new Date().toISOString() });
          product.price = line.pricePerKg;
        }
        items.push({
          id: ctx.uid("i"), name: product?.name || it.name, bought: true, ...weighedHistoryFields(line),
          productId: product?.id || "", category: product?.category || it.category || "", essential: Boolean(product?.essential), sourceListId,
        });
        continue;
      }
      const qty = Math.max(0.01, Number(row?.querySelector('[data-f="qty"]')?.value) || it.qty || 1);
      const price = Math.max(0, Number(row?.querySelector('[data-f="price"]')?.value) || 0);
      // La biblioteca aprende el precio real (o el producto nuevo)
      let product = it.productId ? (state.products || []).find((p) => p.id === it.productId) : matchProduct(it.name, state.products || []);
      if (!product && price > 0) {
        product = enrichProductData({ id: ctx.uid("p"), name: it.name, price, category: it.category || "", history: [], store });
        if (!Array.isArray(state.products)) state.products = [];
        state.products.push(product);
      } else if (product && price > 0 && Math.abs(Number(product.price || 0) - price) > 0.009) {
        product.history = Array.isArray(product.history) ? product.history : [];
        product.history.push({ price: product.price, date: new Date().toISOString() });
        product.price = price;
      }
      items.push({
        id: ctx.uid("i"), name: product?.name || it.name, price, qty, bought: true,
        productId: product?.id || "", category: product?.category || it.category || "", essential: Boolean(product?.essential), unit: it.unit || "", sourceListId,
      });
    }
    if (!items.length) { ctx.toast?.("No hay nada marcado para guardar."); return; }
    const total = Math.round(items.reduce((s, it) => s + it.price * it.qty, 0) * 100) / 100;
    const byCategory = {};
    for (const it of items) { const c = it.category || "Other"; byCategory[c] = Math.round(((byCategory[c] || 0) + it.price * it.qty) * 100) / 100; }
    if (!Array.isArray(state.shoppingHistory)) state.shoppingHistory = [];
    state.shoppingHistory.unshift({ id: ctx.uid("sh"), date, store, notes: "La Canasta", sourceListId, buyer, items, totals: { total, itemsCount: items.length, byCategory } });
    if (box.querySelector('[data-f="finance"]')?.checked && typeof ctx.recordFinance === "function") {
      ctx.recordFinance({ sourceListId, dateISO: `${date}T12:00:00`, amount: total, store, notes: `La Canasta${buyer ? ` · ${buyer === "fergis" ? "Fergis" : "yo"}` : ""}` });
    }
    update(id, (m) => { m.data.saved = true; m.data.savedTotal = total; m.data.savedBuyer = buyer; m.data.savedStore = store; });
    const L = learn(state);
    const extra = L.minimum.total ? ` El mínimo semanal ahora es ${soles(L.minimum.total)}.` : "";
    push({ role: "carl", type: "text", text: `Listo, guardé la compra (${soles(total)}). Con esto ya conozco mejor su ritmo.${extra}` });
    ctx.persist();
    ctx.toast?.("🧺 Compra guardada");
    rerender();
  };
}

function css() {
  return `<style id="bkStyles">
  .bkWrap { display:flex; flex-direction:column; gap:10px; }
  .bkHead { display:flex; align-items:center; gap:10px; }
  .bkBack { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); color:inherit; border-radius:10px; width:36px; height:36px; font-size:18px; cursor:pointer; }
  .bkTitle { font-size:18px; font-weight:800; }
  .bkSub { font-size:12px; opacity:.65; }
  .bkDash { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:10px 12px; }
  .bkDash > summary { cursor:pointer; font-weight:700; font-size:14px; }
  .bkTiles { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; margin:10px 0; }
  .bkTile { background:rgba(255,255,255,.04); border-radius:12px; padding:9px 10px; }
  .bkTileVal { font-size:17px; font-weight:800; color:#f1f5f9; }
  .bkTileLbl { font-size:11px; opacity:.75; margin-top:2px; }
  .bkTileSub { font-size:10.5px; opacity:.55; margin-top:2px; }
  @media (max-width: 420px) { .bkTileVal { font-size:15px; } }
  .bkCard { background:rgba(255,255,255,.03); border-radius:12px; padding:10px; margin-top:8px; }
  .bkCardTitle { font-size:12.5px; font-weight:700; opacity:.85; margin-bottom:6px; }
  .bkSvg { width:100%; height:auto; display:block; }
  .bkGrid { stroke:rgba(255,255,255,.07); stroke-width:1; }
  .bkAxis { fill:rgba(226,232,240,.55); font-size:9px; }
  .bkBarFill { fill:#8b5cf6; }
  .bkBarNow { fill:#a78bfa; stroke:#ede9fe; stroke-width:1.5; }
  .bkBar { cursor:pointer; }
  .bkBar.bkSel rect:nth-child(2) { stroke:#fff; stroke-width:2; }
  .bkMinLine { stroke:#fbbf24; stroke-width:2; stroke-dasharray:5 4; }
  .bkMinText { fill:#fbbf24; font-size:9.5px; font-weight:700; }
  .bkTip { font-size:12px; opacity:.75; margin-top:4px; min-height:16px; }
  .bkHRow { display:grid; grid-template-columns: 92px 1fr auto; gap:8px; align-items:center; margin:5px 0; cursor:pointer; font-size:12px; }
  .bkHLabel { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.85; }
  .bkHTrack, .bkDueTrack { height:8px; background:rgba(255,255,255,.07); border-radius:6px; overflow:hidden; }
  .bkHFill { height:100%; background:#8b5cf6; border-radius:6px; }
  .bkHVal { font-variant-numeric: tabular-nums; opacity:.85; }
  .bkDue { margin:7px 0; cursor:pointer; }
  .bkDueTop { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; }
  .bkDueName { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bkDueWhen { white-space:nowrap; opacity:.85; }
  .bkDueFill { height:100%; background:#8b5cf6; border-radius:6px; }
  .bkDueFillNow { background:#fbbf24; }
  .bkDueMeta { font-size:10.5px; opacity:.55; margin-top:2px; }
  .bkEmpty { font-size:12px; opacity:.65; padding:4px 0; }
  .bkLog { display:flex; flex-direction:column; gap:8px; min-height:120px; }
  .bkMsg { display:flex; flex-direction:column; gap:6px; }
  .bkMsgUser { align-items:flex-end; }
  .bkBubble { max-width:88%; padding:9px 12px; border-radius:14px; font-size:13.5px; line-height:1.45; background:rgba(255,255,255,.06); }
  .bkMsgUser .bkBubble { background:rgba(124,92,255,.28); }
  .bkCardMsg { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:10px; }
  .bkGroup { margin-bottom:8px; }
  .bkGroupTitle { font-size:12.5px; font-weight:700; margin:4px 0; }
  .bkCount { font-size:10.5px; padding:1px 7px; border-radius:99px; background:rgba(124,92,255,.22); }
  .bkGroupHint { font-size:11px; opacity:.6; margin-bottom:4px; }
  .bkItem { display:flex; gap:8px; align-items:flex-start; padding:7px 4px; border-bottom:1px solid rgba(255,255,255,.05); cursor:pointer; }
  .bkItem input { margin-top:3px; width:17px; height:17px; accent-color:#8b5cf6; flex:none; }
  .bkItemMain { flex:1; min-width:0; }
  .bkItemName { font-size:13.5px; font-weight:600; }
  .bkQty { font-weight:500; opacity:.7; }
  .bkItemWhy { font-size:11px; opacity:.6; }
  .bkItemPrice { font-size:13px; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .bkItemOff { opacity:.45; }
  .bkItemOff .bkItemName { text-decoration: line-through; }
  .bkMissing { background:rgba(251,191,36,.08); border-radius:10px; padding:8px 10px; margin:6px 0; font-size:12.5px; }
  .bkMissRow { margin:2px 0; }
  .bkSave { font-size:12px; color:#fde68a; margin:6px 0; }
  .bkTotalRow { display:flex; justify-content:space-between; font-size:14px; padding:8px 4px 4px; border-top:1px solid rgba(255,255,255,.08); }
  .bkActions { display:flex; gap:8px; margin-top:6px; }
  .bkBtn { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); color:inherit; font-weight:600; font-size:13px; cursor:pointer; }
  .bkBtnPrimary { background:#7c5cff; border-color:#7c5cff; color:#fff; flex:1; }
  .bkSaved { font-size:13px; color:#86efac; padding-top:6px; }
  .bkBuyForm { margin-top:8px; display:flex; flex-direction:column; gap:7px; }
  .bkFormRow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12.5px; }
  .bkFormHint { font-size:11px; opacity:.6; }
  .bkFormItem { display:grid; grid-template-columns: 1fr 64px 76px; gap:6px; align-items:center; font-size:12.5px; }
  .bkWeighHint { grid-column: 1 / -1; font-size:11px; opacity:.7; margin-top:-2px; }
  .bkFormName { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bkInput { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; border-radius:8px; padding:7px 8px; font-size:13px; min-width:0; flex:1; }
  .bkNum { text-align:right; }
  .bkChip { display:inline-flex; gap:4px; align-items:center; padding:4px 10px; border-radius:99px; background:rgba(255,255,255,.06); }
  .bkQuick { display:flex; gap:6px; flex-wrap:wrap; }
  .bkChipBtn { padding:6px 10px; border-radius:99px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:inherit; font-size:12px; cursor:pointer; }
  .bkComposer { display:flex; gap:8px; align-items:flex-end; position:sticky; bottom:84px; z-index:5; background:#0f0d1a; padding:8px; border-radius:14px; border:1px solid rgba(255,255,255,.1); box-shadow:0 -8px 18px rgba(0,0,0,.35); }
  .bkTextarea { flex:1; resize:vertical; min-height:44px; max-height:220px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); color:inherit; border-radius:10px; padding:9px 10px; font-size:14px; font-family:inherit; }
  .bkSend { width:44px; height:44px; border-radius:12px; border:none; background:#7c5cff; color:#fff; font-size:18px; cursor:pointer; }
  .bkTyping { font-size:12px; opacity:.6; }
  .bkTabs { display:flex; gap:6px; }
  .bkRoutineLine { font-size:12px; color:#a7f3d0; margin:4px 0; }
  .bkRoutineRow { display:grid; grid-template-columns: 1fr 52px 70px 1fr; gap:6px; margin:6px 0; }
  @media (max-width: 420px) { .bkRoutineRow { grid-template-columns: 1fr 48px 64px; } .bkRoutineRow select { grid-column: 1 / -1; } }
  .bkChipHot { background:rgba(251,191,36,.14); border-color:rgba(251,191,36,.4); color:#fde68a; font-weight:700; }
  .bkRunNums { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
  .bkNeg { color:#fca5a5 !important; }
  .bkSplit { height:10px; border-radius:6px; background:#8b5cf6; overflow:hidden; margin:4px 0 6px; }
  .bkSplitHome { height:100%; background:rgba(255,255,255,.22); }
  .bkMarkTrack { position:relative; overflow:visible; }
  .bkMark { position:absolute; top:-3px; width:3px; height:14px; background:#fbbf24; border-radius:2px; transform:translateX(-1px); }
  .bkInsight { font-size:12px; color:#fde68a; margin-top:5px; line-height:1.4; }
  .bkMeals { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
  .bkMeal { padding:6px 10px; border-radius:99px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:inherit; font-size:12px; cursor:pointer; }
  .bkMealOn { background:rgba(124,92,255,.3); border-color:#8b5cf6; color:#fff; }
  .bkAmount { max-width:96px; font-size:16px; font-weight:700; }
  .bkImpact { background:rgba(255,255,255,.03); border-radius:10px; padding:8px 10px; margin:6px 0; display:flex; flex-direction:column; gap:4px; }
  .bkVerdict { font-weight:800; font-size:15px; }
  .bkStOk { color:#86efac; } .bkStWarn { color:#fde68a; } .bkStBad { color:#fca5a5; }
  .bkImpRow { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; }
  .bkSavedNeutral { color:#e2e8f0; }
  .bkTab { flex:1; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.03); color:inherit; font-size:12.5px; font-weight:600; cursor:pointer; opacity:.7; }
  .bkTabOn { background:rgba(124,92,255,.25); color:#c4b5fd; opacity:1; }
  .bkHint { font-size:12px; opacity:.7; }
  .bkPurchase { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:10px; }
  .bkPTop { display:flex; justify-content:space-between; gap:8px; font-size:13px; }
  .bkPItems { font-size:12px; opacity:.7; margin:4px 0 6px; line-height:1.4; }
  .bkBuyerChip { font-size:11px; padding:1px 8px; border-radius:99px; background:rgba(124,92,255,.22); }
  .bkBuyerNone { background:rgba(251,191,36,.15); color:#fde68a; }
  .bkPriceCell { display:flex; gap:4px; align-items:center; }
  .bkX { border:none; background:rgba(255,255,255,.06); color:inherit; border-radius:8px; width:28px; height:30px; cursor:pointer; flex:none; }
  .bkFormItem.bkEdItem { grid-template-columns: 1fr 60px 112px; }
  </style>`;
}

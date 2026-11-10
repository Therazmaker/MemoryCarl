/**
 * finance_quincena_ui.js — Sección "🗓️ Plan de quincenas" de Mission Control
 * MemoryCarl · Finanzas
 *
 * Guardado en state.financeMeta.quincenaPlans[YYYY-MM] (se sincroniza con finance_extras).
 */

import { PERIODS, normalizePlan, computeQuincenaPlan, buildQuincenaPlanCard } from "./finance_quincena_plan.js";

const ui = { addFor: null, showCard: false };

function g() {
  return typeof globalThis !== "undefined" ? globalThis : {};
}

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function fmt(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("es-PE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function newId() {
  return `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function currentMonthKey() {
  const st = g().state || {};
  if (st.financeMissionMonthKey) return st.financeMissionMonthKey;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonthKey(mk) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function loadQuincenaPlan(mk) {
  return normalizePlan(g().state?.financeMeta?.quincenaPlans?.[mk]);
}

function savePlan(mk, plan, historyText) {
  const st = g().state;
  if (!st) return;
  const next = normalizePlan(plan);
  next.updatedAt = new Date().toISOString();
  if (historyText) next.history = [...next.history, { at: next.updatedAt, text: historyText }].slice(-20);
  const plans = { ...(st.financeMeta?.quincenaPlans || {}), [mk]: next };
  st.financeMeta = { ...(st.financeMeta || {}), quincenaPlans: plans };
  try { g().persist?.(); } catch (_e) {}
}

function missionItems(mk) {
  try {
    const fn = g().financeMissionControlModel;
    return typeof fn === "function" ? fn(mk).items || [] : [];
  } catch (_e) {
    return [];
  }
}

function rerender() {
  try { g().view?.(); } catch (_e) {}
}

/** Tarjeta del plan para el copiloto (texto). */
export function quincenaPlanCardFor(mk, items, monthLabel) {
  return buildQuincenaPlanCard(loadQuincenaPlan(mk), items, { monthLabel });
}

function rowHtml(mk, periodId, r) {
  const status = r.itemPaid || r.done;
  const sub = [
    r.partial ? `adelanto de S/ ${fmt(r.itemTotal)}` : "",
    r.note && !(r.partial && /^adelanto$/i.test(r.note.trim())) ? esc(r.note) : "",
    r.itemPaid ? "✅ pagado" : "",
    r.missing ? "⚠️ ya no está en el mes" : "",
  ].filter(Boolean).join(" · ");
  return `
    <div class="qpRow ${status ? "qpRow--done" : ""}">
      <button type="button" class="qpCheck ${status ? "on" : ""}" onclick="qpToggleDone('${mk}','${periodId}','${esc(r.id)}')" aria-label="Marcar hecho">${status ? "✓" : ""}</button>
      <div class="qpRowInfo">
        <div class="qpRowLabel">${esc(r.label)}</div>
        ${sub ? `<div class="qpRowSub">${sub}</div>` : ""}
      </div>
      <input class="qpAmt" type="number" inputmode="decimal" min="0" step="0.01" value="${r.amount}" onchange="qpSetRowAmount('${mk}','${periodId}','${esc(r.id)}', this.value)" aria-label="Monto"/>
      <button type="button" class="qpX" onclick="qpRemoveRow('${mk}','${periodId}','${esc(r.id)}')" aria-label="Quitar">✕</button>
    </div>`;
}

function addFormHtml(mk, periodId, c) {
  const opts = c.unassigned.map((i) => `<option value="${esc(i.id)}" data-amt="${i.remaining}">${esc(i.name)} · S/ ${fmt(i.remaining)}${i.assignedAmount ? " (resta)" : ""}</option>`).join("");
  return `
    <div class="qpAdd">
      <select id="qpAddItem" class="qpInput" onchange="qpPickItem(this)">
        ${opts}
        <option value="">✍️ Otro pago (escribir)</option>
      </select>
      <input id="qpAddLabel" class="qpInput" placeholder="Concepto (ej. Carlos Emilio)" style="${opts ? "display:none" : ""}"/>
      <div class="qpAddRow">
        <input id="qpAddAmount" class="qpInput" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Monto" value="${c.unassigned[0]?.remaining ?? ""}"/>
        <input id="qpAddNote" class="qpInput" placeholder="Nota (ej. adelanto)"/>
      </div>
      <div class="qpAddRow">
        <button type="button" class="qpBtnGhost" onclick="qpOpenAdd(null)">Cancelar</button>
        <button type="button" class="qpBtn" onclick="qpAddRow('${mk}','${periodId}')">Agregar</button>
      </div>
    </div>`;
}

function periodHtml(mk, p, c) {
  const isQ15 = p.id === "q15";
  const free = p.free;
  const freeColor = free < 0 ? "#fb7185" : free === 0 ? "#fbbf24" : "#34d399";
  return `
    <div class="qpPeriod">
      <div class="qpPeriodHead">
        <div class="qpDay">${p.short}</div>
        <div style="flex:1;min-width:0">
          <div class="qpPeriodTitle">${esc(p.label)}</div>
          <label class="qpIncome">Creo que recibiré S/
            <input type="number" inputmode="decimal" min="0" step="0.01" value="${p.income || ""}" placeholder="0" onchange="qpSetIncome('${mk}','${p.id}', this.value)"/>
          </label>
        </div>
      </div>
      <div class="qpRows">
        ${p.rows.map((r) => rowHtml(mk, p.id, r)).join("") || `<div class="qpEmpty">Nada asignado todavía.</div>`}
      </div>
      ${ui.addFor === p.id ? addFormHtml(mk, p.id, c) : `<button type="button" class="qpAddBtn" onclick="qpOpenAdd('${p.id}')">➕ Agregar pago</button>`}
      <div class="qpMath">
        <div><span>Recibo</span><b>S/ ${fmt(p.income)}</b></div>
        <div><span>Asignado</span><b>− S/ ${fmt(p.allocated)}</b></div>
        ${isQ15 && p.reserveForNext > 0 ? `<div class="qpReserve"><span>Guardar para el 30</span><b>− S/ ${fmt(p.reserveForNext)}</b></div>` : ""}
        ${!isQ15 && p.reserveNeeded > 0 ? `<div class="qpReserve"><span>Viene guardado del 15</span><b>+ S/ ${fmt(p.reserveNeeded)}</b></div>` : ""}
        <div class="qpFree"><span>${free < 0 ? "Falta" : "Sobra"}</span><b style="color:${freeColor}">S/ ${fmt(Math.abs(free))}</b></div>
      </div>
    </div>`;
}

/**
 * HTML de la sección. `items` son las obligaciones del mes (financeMissionControlModel).
 */
export function renderQuincenaPlanSection(mk, items, monthLabel = "") {
  const plan = loadQuincenaPlan(mk);
  const c = computeQuincenaPlan(plan, items);
  const prev = normalizePlan(g().state?.financeMeta?.quincenaPlans?.[prevMonthKey(mk)]);
  const prevHas = prev.periods.q15.income || prev.periods.q30.income || prev.periods.q15.rows.length || prev.periods.q30.rows.length;
  const card = buildQuincenaPlanCard(plan, items, { monthLabel });

  return `
    <div class="mc-section qpWrap">
      ${css()}
      <div class="mc-section-head">
        <div class="mc-section-title">🗓️ Plan de quincenas</div>
        ${!c.hasPlan && prevHas ? `<button class="mc-btn-primary" onclick="qpCopyPrev('${mk}')">Copiar del mes pasado</button>` : ""}
      </div>
      <div class="qpBody">
        <div class="qpHint">Escribe cuánto crees que recibirás y reparte qué pagas con cada quincena. Puedes poner solo una parte (un adelanto).</div>
        ${c.warnings.map((w) => `<div class="qpWarn qpWarn--${w.level}">${w.level === "bad" ? "🔴" : "🟠"} ${esc(w.text)}${w.itemId ? ` <button type="button" class="qpLink" onclick="qpAssign('${mk}','${esc(w.itemId)}','q15')">→ 15</button><button type="button" class="qpLink" onclick="qpAssign('${mk}','${esc(w.itemId)}','q30')">→ 30</button>` : ""}</div>`).join("")}
        <div class="qpGrid">
          ${PERIODS.map((d) => periodHtml(mk, c.periods[d.id], c)).join("")}
        </div>
        ${c.unassigned.length ? `
          <div class="qpSubTitle">Sin asignar · S/ ${fmt(c.unassignedTotal)}</div>
          ${c.unassigned.map((i) => `
            <div class="qpUn">
              <div class="qpRowInfo"><div class="qpRowLabel">${esc(i.name)}</div><div class="qpRowSub">Día ${i.dueDay || "-"} · ${i.assignedAmount ? `resta S/ ${fmt(i.remaining)} de S/ ${fmt(i.amount)}` : `S/ ${fmt(i.remaining)}`}${i.type === "unexpected" ? " · ⚡ imprevisto" : ""}</div></div>
              <button type="button" class="qpTo ${i.suggested === "q15" ? "sug" : ""}" onclick="qpAssign('${mk}','${esc(i.id)}','q15')">→ 15</button>
              <button type="button" class="qpTo ${i.suggested === "q30" ? "sug" : ""}" onclick="qpAssign('${mk}','${esc(i.id)}','q30')">→ 30</button>
            </div>`).join("")}` : (c.hasPlan ? `<div class="qpOk">✅ Todo lo pendiente del mes está en el plan.</div>` : "")}
        ${c.hasPlan ? `
          <div class="qpTotals">
            <div><span>Recibo en el mes</span><b>S/ ${fmt(c.totalIncome)}</b></div>
            <div><span>Planificado</span><b>S/ ${fmt(c.totalAllocated)}</b></div>
            <div><span>${c.freeAfterAll < 0 ? "Falta si pago todo" : "Sobra si pago todo"}</span><b style="color:${c.freeAfterAll < 0 ? "#fb7185" : "#34d399"}">S/ ${fmt(Math.abs(c.freeAfterAll))}</b></div>
          </div>
          <button type="button" class="qpLink" style="margin-top:8px" onclick="qpToggleCard()">🧾 ${ui.showCard ? "Ocultar" : "Ver"} la tarjeta que usa el copiloto</button>
          ${ui.showCard ? `<pre class="qpCard">${esc(card)}</pre>` : ""}` : ""}
      </div>
    </div>`;
}

const actions = {
  qpSetIncome(mk, periodId, value) {
    const plan = loadQuincenaPlan(mk);
    const v = Math.max(0, Number(value) || 0);
    plan.periods[periodId].income = v;
    savePlan(mk, plan, `ingreso esperado del ${periodId === "q15" ? "15" : "30"}: S/ ${fmt(v)}`);
    rerender();
  },
  qpOpenAdd(periodId) {
    ui.addFor = periodId || null;
    rerender();
  },
  qpPickItem(sel) {
    const opt = sel.options[sel.selectedIndex];
    const amt = document.getElementById("qpAddAmount");
    const label = document.getElementById("qpAddLabel");
    if (label) label.style.display = sel.value ? "none" : "";
    if (amt && opt?.dataset?.amt) amt.value = opt.dataset.amt;
    if (!sel.value && label) label.focus();
  },
  qpAddRow(mk, periodId) {
    const itemId = document.getElementById("qpAddItem")?.value || null;
    const amount = Math.max(0, Number(document.getElementById("qpAddAmount")?.value) || 0);
    const note = String(document.getElementById("qpAddNote")?.value || "").trim();
    const item = itemId ? missionItems(mk).find((i) => i.id === itemId) : null;
    const label = item ? item.name : String(document.getElementById("qpAddLabel")?.value || "").trim();
    if (!label || amount <= 0) {
      try { g().toast?.("⚠️ Pon un concepto y un monto"); } catch (_e) {}
      return;
    }
    const plan = loadQuincenaPlan(mk);
    plan.periods[periodId].rows.push({ id: newId(), itemId: item ? item.id : null, label, amount, note, done: false });
    savePlan(mk, plan, `${periodId === "q15" ? "15" : "30"}: ${label} S/ ${fmt(amount)}${item && amount < item.amount ? ` (adelanto de S/ ${fmt(item.amount)})` : ""}`);
    ui.addFor = null;
    rerender();
  },
  qpAssign(mk, itemId, periodId) {
    const items = missionItems(mk);
    const c = computeQuincenaPlan(loadQuincenaPlan(mk), items);
    const un = c.unassigned.find((i) => i.id === itemId);
    if (!un) return;
    const plan = loadQuincenaPlan(mk);
    plan.periods[periodId].rows.push({ id: newId(), itemId, label: un.name, amount: un.remaining, note: un.type === "unexpected" ? "imprevisto" : "", done: false });
    savePlan(mk, plan, `${periodId === "q15" ? "15" : "30"}: ${un.name} S/ ${fmt(un.remaining)}${un.type === "unexpected" ? " (imprevisto)" : ""}`);
    rerender();
  },
  qpSetRowAmount(mk, periodId, rowId, value) {
    const plan = loadQuincenaPlan(mk);
    const row = plan.periods[periodId].rows.find((r) => r.id === rowId);
    if (!row) return;
    const v = Math.max(0, Number(value) || 0);
    if (v === row.amount) return;
    row.amount = v;
    savePlan(mk, plan, `${periodId === "q15" ? "15" : "30"}: ${row.label} ahora S/ ${fmt(v)}`);
    rerender();
  },
  qpRemoveRow(mk, periodId, rowId) {
    const plan = loadQuincenaPlan(mk);
    const row = plan.periods[periodId].rows.find((r) => r.id === rowId);
    plan.periods[periodId].rows = plan.periods[periodId].rows.filter((r) => r.id !== rowId);
    savePlan(mk, plan, row ? `${periodId === "q15" ? "15" : "30"}: quitó ${row.label}` : "");
    rerender();
  },
  qpToggleDone(mk, periodId, rowId) {
    const plan = loadQuincenaPlan(mk);
    const row = plan.periods[periodId].rows.find((r) => r.id === rowId);
    if (!row) return;
    row.done = !row.done;
    savePlan(mk, plan, row.done ? `${row.label} hecho` : "");
    rerender();
  },
  qpCopyPrev(mk) {
    const prev = normalizePlan(g().state?.financeMeta?.quincenaPlans?.[prevMonthKey(mk)]);
    const items = missionItems(mk);
    const byName = new Map(items.map((i) => [String(i.name || "").trim().toLowerCase(), i]));
    const plan = loadQuincenaPlan(mk);
    for (const { id } of PERIODS) {
      plan.periods[id].income = prev.periods[id].income;
      plan.periods[id].rows = prev.periods[id].rows.map((r) => {
        // Las obligaciones cambian de id cada mes: se vuelven a enlazar por nombre
        const match = byName.get(String(r.label || "").trim().toLowerCase());
        return { ...r, id: newId(), itemId: match ? match.id : null, done: false };
      });
    }
    savePlan(mk, plan, "copió el plan del mes pasado");
    rerender();
  },
  qpToggleCard() {
    ui.showCard = !ui.showCard;
    rerender();
  },
};

if (typeof window !== "undefined") Object.assign(window, actions);

function css() {
  return `<style id="qpStyles">
  .qpBody { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
  .qpHint { font-size: 12px; color: rgba(255,255,255,.55); line-height: 1.4; }
  .qpWarn { font-size: 12.5px; padding: 9px 11px; border-radius: 12px; line-height: 1.4; }
  .qpWarn--warn { background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.3); color: #fde68a; }
  .qpWarn--bad { background: rgba(244,63,94,.12); border: 1px solid rgba(244,63,94,.3); color: #fda4af; }
  .qpGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 640px) { .qpGrid { grid-template-columns: 1fr; } }
  .qpPeriod { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .qpPeriodHead { display: flex; gap: 10px; align-items: center; }
  .qpDay { width: 42px; height: 42px; border-radius: 12px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 17px; background: linear-gradient(135deg,#7c5cff,#6366f1); color: #fff; }
  .qpPeriodTitle { font-size: 14px; font-weight: 800; color: #fff; }
  .qpIncome { display: flex; align-items: center; gap: 6px; font-size: 12px; color: rgba(255,255,255,.6); margin-top: 3px; }
  .qpIncome input { width: 110px; background: rgba(0,0,0,.3); border: 1px solid rgba(124,92,255,.45); color: #fff; border-radius: 9px; padding: 6px 8px; font-size: 14px; font-weight: 700; }
  .qpRows { display: flex; flex-direction: column; }
  .qpRow, .qpUn { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .qpRow--done .qpRowLabel { text-decoration: line-through; opacity: .6; }
  .qpCheck { width: 24px; height: 24px; flex: none; border-radius: 7px; border: 1.5px solid rgba(255,255,255,.3); background: transparent; color: #0b1; font-weight: 900; cursor: pointer; }
  .qpCheck.on { background: #34d399; border-color: #34d399; color: #052e16; }
  .qpRowInfo { flex: 1; min-width: 0; }
  .qpRowLabel { font-size: 13px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qpRowSub { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 1px; }
  .qpAmt { width: 84px; flex: none; text-align: right; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.12); color: #fff; border-radius: 8px; padding: 5px 7px; font-size: 13px; font-weight: 700; }
  .qpX { flex: none; background: none; border: none; color: rgba(255,255,255,.4); cursor: pointer; font-size: 13px; padding: 4px; }
  .qpEmpty { font-size: 12px; color: rgba(255,255,255,.4); padding: 6px 0; }
  .qpAddBtn { background: rgba(124,92,255,.12); border: 1px dashed rgba(124,92,255,.5); color: #c4b5fd; border-radius: 10px; padding: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .qpAdd { display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,.2); border-radius: 12px; padding: 8px; }
  .qpAddRow { display: flex; gap: 6px; }
  .qpAddRow > * { flex: 1; min-width: 0; }
  .qpInput { width: 100%; box-sizing: border-box; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14); color: #fff; border-radius: 9px; padding: 8px 9px; font-size: 13px; }
  .qpBtn { background: #7c5cff; color: #fff; border: none; border-radius: 9px; padding: 8px; font-weight: 800; cursor: pointer; }
  .qpBtnGhost { background: rgba(255,255,255,.06); color: #e5e7eb; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; padding: 8px; cursor: pointer; }
  .qpMath { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: rgba(255,255,255,.65); border-top: 1px solid rgba(255,255,255,.08); padding-top: 8px; }
  .qpMath div { display: flex; justify-content: space-between; }
  .qpReserve { color: #fbbf24; }
  .qpFree { font-size: 14px; color: #fff; font-weight: 800; margin-top: 2px; }
  .qpSubTitle { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: rgba(255,255,255,.5); margin-top: 4px; }
  .qpTo { flex: none; font-size: 11.5px; font-weight: 800; padding: 5px 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: #e5e7eb; cursor: pointer; }
  .qpTo.sug { border-color: rgba(124,92,255,.7); background: rgba(124,92,255,.2); color: #ddd6fe; }
  .qpOk { font-size: 12.5px; color: #34d399; }
  .qpTotals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .qpTotals div { background: rgba(255,255,255,.04); border-radius: 11px; padding: 8px; display: flex; flex-direction: column; gap: 2px; text-align: center; }
  .qpTotals span { font-size: 10.5px; color: rgba(255,255,255,.5); }
  .qpTotals b { font-size: 14px; color: #fff; }
  .qpLink { background: none; border: none; color: #a78bfa; font-size: 12px; font-weight: 700; cursor: pointer; padding: 2px 4px; }
  .qpCard { white-space: pre-wrap; font-size: 11.5px; line-height: 1.45; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px; color: rgba(255,255,255,.8); margin: 4px 0 0; font-family: ui-monospace, monospace; }
  </style>`;
}

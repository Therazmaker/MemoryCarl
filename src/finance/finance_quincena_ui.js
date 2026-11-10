/**
 * finance_quincena_ui.js — Plan de quincenas: Hoja de Ruta (editor) y resumen en Mission Control
 * MemoryCarl · Finanzas
 *
 * Guardado en state.financeMeta.quincenaPlans[YYYY-MM] (se sincroniza con finance_extras).
 * El mes es el mismo que el de Mission Control (state.financeMissionMonthKey).
 */

import { PERIODS, PEOPLE, normalizePlan, computeQuincenaPlan, buildQuincenaPlanCard, buildCashTimeline, incomeKey, periodForDay } from "./finance_quincena_plan.js";

const ui = { addFor: null, showCard: false, assignAs: "me", view: "plan" };

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

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function currentPlanMonthKey() {
  const st = g().state || {};
  if (st.financeMissionMonthKey) return st.financeMissionMonthKey;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${MONTHS[m - 1] || ""} ${y}`;
}

function lastDayOf(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m, 0).getDate();
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

const pName = (id) => (id === "fergis" ? "Fergis" : "Tú");
const pEmoji = (id) => (id === "fergis" ? "💜" : "🧑");
const perLabel = (id) => (id === "q15" ? "15" : "último");

/** Tarjeta del plan para el copiloto (texto). */
export function quincenaPlanCardFor(mk, items, monthLabel) {
  return buildQuincenaPlanCard(loadQuincenaPlan(mk), items, { monthLabel });
}

/**
 * Trae una vez los datos de la Hoja de Ruta anterior (sueldo y Fergis por mes, y la deuda
 * a la que iba lo de Fergis) si el plan del mes está vacío.
 */
function migrateOldRoadmap(mk, items) {
  const st = g().state;
  const old = st?.financeRoadmap?.[mk];
  if (!old || old._migratedToPlan) return;
  const plan = loadQuincenaPlan(mk);
  const empty = PERIODS.every(({ id }) => !plan.periods[id].income && !plan.periods[id].fergisIncome && !plan.periods[id].rows.length);
  const sueldo = Number(old.sueldo) || 0;
  const fergis = Number(old.fergisIncome) || 0;
  old._migratedToPlan = true;
  try { localStorage.setItem("memorycarl_v2_finance_roadmap", JSON.stringify(st.financeRoadmap)); } catch (_e) {}
  if (!empty || (!sueldo && !fergis)) return;
  for (const { id } of PERIODS) {
    plan.periods[id].income = Math.round((sueldo / 2) * 100) / 100;
    plan.periods[id].fergisIncome = Math.round((fergis / 2) * 100) / 100;
  }
  if (old.fergisTarget) {
    const item = items.find((i) => i.refId === old.fergisTarget);
    if (item) {
      const per = periodForDay(item.dueDay);
      plan.periods[per].rows.push({ id: newId(), itemId: item.id, label: item.name, amount: Math.min(Number(item.amount) || 0, fergis || Number(item.amount) || 0), note: "", done: false, payer: "fergis" });
    }
  }
  savePlan(mk, plan, "trajo los ingresos de la Hoja de Ruta anterior");
}

// ---------------------------------------------------------------- Piezas

function rowHtml(mk, periodId, r, idx, count) {
  const status = r.itemPaid || r.done;
  const sub = [
    r.partial ? `adelanto de S/ ${fmt(r.itemTotal)}` : "",
    r.note && !(r.partial && /^adelanto$/i.test(r.note.trim())) ? esc(r.note) : "",
    r.dueDay ? `vence el ${r.dueDay}` : "",
    r.itemPaid ? "✅ pagado" : "",
    r.missing ? "⚠️ ya no está en el mes" : "",
  ].filter(Boolean).join(" · ");
  const other = r.payer === "fergis" ? "me" : "fergis";
  return `
    <div class="qpRow ${status ? "qpRow--done" : ""}">
      <button type="button" class="qpCheck ${status ? "on" : ""}" onclick="qpToggleDone('${mk}','${periodId}','${esc(r.id)}')" aria-label="Marcar hecho">${status ? "✓" : ""}</button>
      <div class="qpRowInfo">
        <div class="qpRowLabel">${esc(r.label)}${r.late && !status ? ` <span class="qpLate" title="Vence antes de este cobro">⏰</span>` : ""}</div>
        ${sub ? `<div class="qpRowSub">${sub}</div>` : ""}
      </div>
      <input class="qpAmt" type="number" inputmode="decimal" min="0" step="0.01" value="${r.amount}" onchange="qpSetRowAmount('${mk}','${periodId}','${esc(r.id)}', this.value)" aria-label="Monto"/>
      <div class="qpRowTools">
        <button type="button" class="qpMini" title="Que lo pague ${pName(other)}" onclick="qpSetPayer('${mk}','${periodId}','${esc(r.id)}','${other}')">${pEmoji(other)}</button>
        <button type="button" class="qpMini" title="Moverlo al ${perLabel(periodId === "q15" ? "q30" : "q15")}" onclick="qpMoveToPeriod('${mk}','${periodId}','${esc(r.id)}')">⇄</button>
        <button type="button" class="qpMini" ${idx === 0 ? "disabled" : ""} onclick="qpMoveRow('${mk}','${periodId}','${esc(r.id)}',-1)" aria-label="Subir">▲</button>
        <button type="button" class="qpMini" ${idx >= count - 1 ? "disabled" : ""} onclick="qpMoveRow('${mk}','${periodId}','${esc(r.id)}',1)" aria-label="Bajar">▼</button>
        <button type="button" class="qpMini qpMini--x" onclick="qpRemoveRow('${mk}','${periodId}','${esc(r.id)}')" aria-label="Quitar">✕</button>
      </div>
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
      <div class="qpSeg" role="radiogroup" aria-label="Quién paga">
        ${PEOPLE.map((p) => `<label><input type="radio" name="qpAddPayer" value="${p.id}" ${ui.assignAs === p.id ? "checked" : ""}/> ${p.emoji} Paga ${p.id === "me" ? "tú" : "Fergis"}</label>`).join("")}
      </div>
      <div class="qpAddRow">
        <button type="button" class="qpBtnGhost" onclick="qpOpenAdd(null)">Cancelar</button>
        <button type="button" class="qpBtn" onclick="qpAddRow('${mk}','${periodId}')">Agregar</button>
      </div>
    </div>`;
}

function personMath(per, personId, isQ15) {
  const pp = per.people[personId];
  const free = pp.free;
  const color = free < 0 ? "#fb7185" : free === 0 ? "#fbbf24" : "#34d399";
  return `
    <div class="qpMath">
      <div><span>Cobra</span><b>S/ ${fmt(pp.income)}</b></div>
      <div><span>Paga</span><b>− S/ ${fmt(pp.allocated)}</b></div>
      ${isQ15 && pp.reserveForNext > 0 ? `<div class="qpReserve"><span>Guardar para el último</span><b>− S/ ${fmt(pp.reserveForNext)}</b></div>` : ""}
      ${!isQ15 && pp.reserveNeeded > 0 ? `<div class="qpReserve"><span>Viene guardado del 15</span><b>+ S/ ${fmt(pp.reserveNeeded)}</b></div>` : ""}
      <div class="qpFree"><span>${free < 0 ? "Falta" : "Sobra"}</span><b style="color:${color}">S/ ${fmt(Math.abs(free))}</b></div>
    </div>`;
}

function periodHtml(mk, per, c, showFergis) {
  const isQ15 = per.id === "q15";
  const lanes = (showFergis ? PEOPLE : PEOPLE.slice(0, 1)).map((p) => {
    const rows = per.rows.filter((r) => r.payer === p.id);
    return `
      <div class="qpLane qpLane--${p.id}">
        ${showFergis ? `<div class="qpLaneHead">${p.emoji} ${p.id === "me" ? "Pagas tú" : "Paga Fergis"}</div>` : ""}
        <div class="qpRows">${rows.map((r, i) => rowHtml(mk, per.id, r, i, rows.length)).join("") || `<div class="qpEmpty">Nada asignado.</div>`}</div>
        ${personMath(per, p.id, isQ15)}
      </div>`;
  }).join("");
  return `
    <div class="qpPeriod">
      <div class="qpPeriodHead">
        <div class="qpDay">${per.short}</div>
        <div style="flex:1;min-width:0">
          <div class="qpPeriodTitle">${esc(per.label)}</div>
          <div class="qpRowSub">Entra S/ ${fmt(per.income)} · sale S/ ${fmt(per.allocated)}</div>
        </div>
        <div class="qpPeriodFree" style="color:${per.free < 0 ? "#fb7185" : "#34d399"}">${per.free < 0 ? "−" : ""}S/ ${fmt(Math.abs(per.free))}</div>
      </div>
      <div class="qpLanes ${showFergis ? "qpLanes--two" : ""}">${lanes}</div>
      ${ui.addFor === per.id ? addFormHtml(mk, per.id, c) : `<button type="button" class="qpAddBtn" onclick="qpOpenAdd('${per.id}')">➕ Agregar pago al ${perLabel(per.id)}</button>`}
    </div>`;
}

function incomePanelHtml(mk, c) {
  const cell = (perId, personId) => {
    const v = c.plan.periods[perId][incomeKey(personId)];
    return `<input class="qpIncomeInput" type="number" inputmode="decimal" min="0" step="0.01" value="${v || ""}" placeholder="0" onchange="qpSetIncome('${mk}','${perId}','${personId}', this.value)" aria-label="${pName(personId)} cobra el ${perLabel(perId)}"/>`;
  };
  return `
    <div class="qpIncomeGrid">
      <div></div><div class="qpIncHead">El 15</div><div class="qpIncHead">El último</div>
      ${PEOPLE.map((p) => `
        <div class="qpIncName">${p.emoji} ${p.label}</div>
        ${cell("q15", p.id)}
        ${cell("q30", p.id)}`).join("")}
    </div>`;
}

function unassignedHtml(mk, c) {
  if (!c.unassigned.length) return c.hasPlan ? `<div class="qpOk">✅ Todo lo pendiente del mes está en el plan.</div>` : "";
  return `
    <div class="qpUnHead">
      <div class="qpSubTitle">Sin asignar · S/ ${fmt(c.unassignedTotal)}</div>
      <div class="qpSegMini">
        ${PEOPLE.map((p) => `<button type="button" class="${ui.assignAs === p.id ? "on" : ""}" onclick="qpSetAssignAs('${p.id}')">${p.emoji} ${p.label}</button>`).join("")}
      </div>
    </div>
    ${c.unassigned.map((i) => `
      <div class="qpUn">
        <div class="qpRowInfo"><div class="qpRowLabel">${esc(i.name)}</div><div class="qpRowSub">Día ${i.dueDay || "-"} · ${i.assignedAmount ? `resta S/ ${fmt(i.remaining)} de S/ ${fmt(i.amount)}` : `S/ ${fmt(i.remaining)}`}${i.type === "unexpected" ? " · ⚡ imprevisto" : ""}</div></div>
        <button type="button" class="qpTo ${i.suggested === "q15" ? "sug" : ""}" onclick="qpAssign('${mk}','${esc(i.id)}','q15')">→ 15</button>
        <button type="button" class="qpTo ${i.suggested === "q30" ? "sug" : ""}" onclick="qpAssign('${mk}','${esc(i.id)}','q30')">→ Últ</button>
      </div>`).join("")}`;
}

function timelineHtml(mk, items) {
  const t = buildCashTimeline(loadQuincenaPlan(mk), items, { lastDay: lastDayOf(mk) });
  if (!t.events.length) return `<div class="qpEmpty">Escribe los ingresos y asigna pagos para ver la caja día a día.</div>`;
  const showF = t.events.some((e) => e.person === "fergis");
  return `
    <div class="qpTl">
      ${t.events.map((e) => {
        const b = e.balance;
        const neg = (b.me < 0) || (b.fergis < 0);
        return `<div class="qpTlRow ${e.kind === "in" ? "qpTlIn" : ""} ${e.done ? "qpRow--done" : ""}">
          <div class="qpTlDay">${e.day}</div>
          <div class="qpRowInfo"><div class="qpRowLabel">${e.kind === "in" ? "💰" : pEmoji(e.person)} ${esc(e.label)}</div></div>
          <div class="qpTlAmt ${e.kind === "in" ? "qpIn" : ""}">${e.kind === "in" ? "+" : "−"}S/ ${fmt(e.amount)}</div>
          <div class="qpTlBal ${neg ? "neg" : ""}">${showF ? `🧑 ${fmt(b.me)} · 💜 ${fmt(b.fergis)}` : `S/ ${fmt(b.me)}`}</div>
        </div>`;
      }).join("")}
    </div>
    ${t.lowest.me < 0 || t.lowest.fergis < 0 ? `<div class="qpWarn qpWarn--bad">🔴 En algún momento del mes la caja queda en negativo${showF ? ` (${t.lowest.me < 0 ? `tú −S/ ${fmt(-t.lowest.me)}` : ""}${t.lowest.me < 0 && t.lowest.fergis < 0 ? ", " : ""}${t.lowest.fergis < 0 ? `Fergis −S/ ${fmt(-t.lowest.fergis)}` : ""})` : ` (−S/ ${fmt(-t.lowest.me)})`}: reordena o mueve pagos.</div>` : ""}
    <div class="qpRowSub" style="margin-top:6px">Cada pago se ubica en su día de vencimiento, pero nunca antes del cobro con que lo vas a pagar.</div>`;
}

function warningsHtml(mk, c) {
  return c.warnings.map((w) => `<div class="qpWarn qpWarn--${w.level}">${w.level === "bad" ? "🔴" : "🟠"} ${esc(w.text)}${w.itemId ? ` <button type="button" class="qpLink" onclick="qpAssign('${mk}','${esc(w.itemId)}','q15')">→ 15</button><button type="button" class="qpLink" onclick="qpAssign('${mk}','${esc(w.itemId)}','q30')">→ Últ</button>` : ""}</div>`).join("");
}

function totalsHtml(c) {
  if (!c.hasPlan) return "";
  return `
    <div class="qpTotals">
      <div><span>Entra en el mes</span><b>S/ ${fmt(c.totalIncome)}</b></div>
      <div><span>Planificado</span><b>S/ ${fmt(c.totalAllocated)}</b></div>
      <div><span>${c.freeAfterAll < 0 ? "Falta si se paga todo" : "Sobra si se paga todo"}</span><b style="color:${c.freeAfterAll < 0 ? "#fb7185" : "#34d399"}">S/ ${fmt(Math.abs(c.freeAfterAll))}</b></div>
    </div>
    ${c.usesFergis ? `<div class="qpTotals qpTotals--two">
      <div><span>🧑 Te queda libre</span><b style="color:${c.people.me.free < 0 ? "#fb7185" : "#e5e7eb"}">S/ ${fmt(c.people.me.free)}</b></div>
      <div><span>💜 A Fergis le queda</span><b style="color:${c.people.fergis.free < 0 ? "#fb7185" : "#e5e7eb"}">S/ ${fmt(c.people.fergis.free)}</b></div>
    </div>` : ""}`;
}

// ---------------------------------------------------------------- Vistas

/** Hoja de Ruta: el editor completo del plan del mes. */
export function renderRoadmapTab() {
  const mk = currentPlanMonthKey();
  const items = missionItems(mk);
  migrateOldRoadmap(mk, items);
  const plan = loadQuincenaPlan(mk);
  const c = computeQuincenaPlan(plan, items);
  const prev = normalizePlan(g().state?.financeMeta?.quincenaPlans?.[prevMonthKey(mk)]);
  const prevHas = PERIODS.some(({ id }) => prev.periods[id].income || prev.periods[id].fergisIncome || prev.periods[id].rows.length);
  const showFergis = true;
  const card = buildQuincenaPlanCard(plan, items, { monthLabel: monthLabelOf(mk) });
  return `
    <section class="card homeCard homeWide qpWrap qpRoadmap">
      ${css()}
      <div class="qpMonthNav">
        <button type="button" class="qpBtnGhost" onclick="mcChangeMonth(-1)">◀</button>
        <div class="qpMonthTitle" onclick="mcSetCurrentMonth()">🗺️ Hoja de Ruta · ${esc(monthLabelOf(mk))}</div>
        <button type="button" class="qpBtnGhost" onclick="mcChangeMonth(1)">▶</button>
      </div>
      <div class="qpBody">
        <div class="qpHint">Escribe cuánto cobran tú y Fergis el 15 y el último, y reparte qué paga cada uno. Puedes poner solo una parte (un adelanto). Los pagos salen de Mission Control.</div>
        ${incomePanelHtml(mk, c)}
        ${!c.hasPlan && prevHas ? `<button type="button" class="qpAddBtn" onclick="qpCopyPrev('${mk}')">📋 Copiar el plan del mes pasado</button>` : ""}
        ${warningsHtml(mk, c)}
        <div class="qpViewTabs">
          <button type="button" class="${ui.view === "plan" ? "on" : ""}" onclick="qpSetView('plan')">🗓️ Por quincena</button>
          <button type="button" class="${ui.view === "timeline" ? "on" : ""}" onclick="qpSetView('timeline')">📅 Caja día a día</button>
        </div>
        ${ui.view === "timeline" ? timelineHtml(mk, items) : `<div class="qpGrid">${PERIODS.map((d) => periodHtml(mk, c.periods[d.id], c, showFergis)).join("")}</div>`}
        ${unassignedHtml(mk, c)}
        ${totalsHtml(c)}
        ${c.hasPlan ? `
          <button type="button" class="qpLink" style="margin-top:8px;align-self:flex-start" onclick="qpToggleCard()">🧾 ${ui.showCard ? "Ocultar" : "Ver"} la tarjeta que usa el copiloto</button>
          ${ui.showCard ? `<pre class="qpCard">${esc(card)}</pre>` : ""}` : ""}
      </div>
    </section>`;
}

/** Resumen en Mission Control (el editor está en la Hoja de Ruta). */
export function renderQuincenaPlanSection(mk, items) {
  const c = computeQuincenaPlan(loadQuincenaPlan(mk), items);
  const open = `<button class="mc-btn-primary" onclick="setFinanceSubTab('roadmap')">🗺️ ${c.hasPlan ? "Editar" : "Armar"} en Hoja de Ruta</button>`;
  if (!c.hasPlan) {
    return `
      <div class="mc-section qpWrap">
        ${css()}
        <div class="mc-section-head"><div class="mc-section-title">🗓️ Plan de quincenas</div>${open}</div>
        <div class="qpBody"><div class="qpHint">Reparte qué pagan tú y Fergis con el cobro del 15 y del último. El copiloto lo usa para aconsejarte.</div></div>
      </div>`;
  }
  const line = (per) => {
    const p = c.periods[per];
    const parts = PEOPLE.filter((x) => x.id === "me" || c.usesFergis).map((x) => {
      const pp = p.people[x.id];
      return `${c.usesFergis ? `${x.emoji} ` : ""}<b style="color:${pp.free < 0 ? "#fb7185" : "#34d399"}">${pp.free < 0 ? "falta" : "sobra"} S/ ${fmt(Math.abs(pp.free))}</b>${per === "q15" && pp.reserveForNext > 0 ? ` <span class="qpRowSub">(guardando S/ ${fmt(pp.reserveForNext)})</span>` : ""}`;
    });
    return `<div class="qpSumRow"><div class="qpDay qpDay--sm">${p.short}</div><div style="flex:1">${parts.join(" · ")}</div><div class="qpRowSub">${p.rows.length} pago${p.rows.length === 1 ? "" : "s"}</div></div>`;
  };
  return `
    <div class="mc-section qpWrap">
      ${css()}
      <div class="mc-section-head"><div class="mc-section-title">🗓️ Plan de quincenas</div>${open}</div>
      <div class="qpBody">
        ${warningsHtml(mk, c)}
        ${line("q15")}
        ${line("q30")}
        ${c.unassigned.length ? `<div class="qpRowSub">Sin asignar: ${c.unassigned.length} pago${c.unassigned.length === 1 ? "" : "s"} · S/ ${fmt(c.unassignedTotal)}</div>` : `<div class="qpOk">✅ Todo lo pendiente está en el plan.</div>`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Acciones

function findRow(plan, periodId, rowId) {
  return plan.periods[periodId]?.rows.find((r) => r.id === rowId) || null;
}

const actions = {
  qpSetIncome(mk, periodId, person, value) {
    const plan = loadQuincenaPlan(mk);
    const v = Math.max(0, Number(value) || 0);
    plan.periods[periodId][incomeKey(person)] = v;
    savePlan(mk, plan, `${pName(person)} cobra el ${perLabel(periodId)}: S/ ${fmt(v)}`);
    rerender();
  },
  qpOpenAdd(periodId) {
    ui.addFor = periodId || null;
    rerender();
  },
  qpSetView(v) {
    ui.view = v === "timeline" ? "timeline" : "plan";
    rerender();
  },
  qpSetAssignAs(p) {
    ui.assignAs = p === "fergis" ? "fergis" : "me";
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
    const payer = document.querySelector('input[name="qpAddPayer"]:checked')?.value === "fergis" ? "fergis" : "me";
    const item = itemId ? missionItems(mk).find((i) => i.id === itemId) : null;
    const label = item ? item.name : String(document.getElementById("qpAddLabel")?.value || "").trim();
    if (!label || amount <= 0) {
      try { g().toast?.("⚠️ Pon un concepto y un monto"); } catch (_e) {}
      return;
    }
    const plan = loadQuincenaPlan(mk);
    plan.periods[periodId].rows.push({ id: newId(), itemId: item ? item.id : null, label, amount, note, done: false, payer });
    savePlan(mk, plan, `${perLabel(periodId)}: ${label} S/ ${fmt(amount)}${item && amount < item.amount ? ` (adelanto de S/ ${fmt(item.amount)})` : ""}${payer === "fergis" ? ", paga Fergis" : ""}`);
    ui.addFor = null;
    ui.assignAs = payer;
    rerender();
  },
  qpAssign(mk, itemId, periodId) {
    const items = missionItems(mk);
    const c = computeQuincenaPlan(loadQuincenaPlan(mk), items);
    const un = c.unassigned.find((i) => i.id === itemId);
    if (!un) return;
    const plan = loadQuincenaPlan(mk);
    const payer = ui.assignAs;
    plan.periods[periodId].rows.push({ id: newId(), itemId, label: un.name, amount: un.remaining, note: un.type === "unexpected" ? "imprevisto" : "", done: false, payer });
    savePlan(mk, plan, `${perLabel(periodId)}: ${un.name} S/ ${fmt(un.remaining)}${un.type === "unexpected" ? " (imprevisto)" : ""}${payer === "fergis" ? ", paga Fergis" : ""}`);
    rerender();
  },
  qpSetRowAmount(mk, periodId, rowId, value) {
    const plan = loadQuincenaPlan(mk);
    const row = findRow(plan, periodId, rowId);
    if (!row) return;
    const v = Math.max(0, Number(value) || 0);
    if (v === row.amount) return;
    row.amount = v;
    savePlan(mk, plan, `${perLabel(periodId)}: ${row.label} ahora S/ ${fmt(v)}`);
    rerender();
  },
  qpSetPayer(mk, periodId, rowId, payer) {
    const plan = loadQuincenaPlan(mk);
    const row = findRow(plan, periodId, rowId);
    if (!row) return;
    row.payer = payer === "fergis" ? "fergis" : "me";
    savePlan(mk, plan, `${row.label} lo paga ${row.payer === "fergis" ? "Fergis" : "el usuario"}`);
    rerender();
  },
  qpMoveToPeriod(mk, periodId, rowId) {
    const plan = loadQuincenaPlan(mk);
    const row = findRow(plan, periodId, rowId);
    if (!row) return;
    const target = periodId === "q15" ? "q30" : "q15";
    plan.periods[periodId].rows = plan.periods[periodId].rows.filter((r) => r.id !== rowId);
    plan.periods[target].rows.push(row);
    savePlan(mk, plan, `${row.label} pasa al ${perLabel(target)}`);
    rerender();
  },
  qpMoveRow(mk, periodId, rowId, delta) {
    const plan = loadQuincenaPlan(mk);
    const rows = plan.periods[periodId].rows;
    const row = findRow(plan, periodId, rowId);
    if (!row) return;
    // Se mueve dentro de los pagos de la misma persona
    const same = rows.filter((r) => r.payer === row.payer);
    const i = same.indexOf(row);
    const j = i + Number(delta);
    if (j < 0 || j >= same.length) return;
    const a = rows.indexOf(same[i]);
    const b = rows.indexOf(same[j]);
    [rows[a], rows[b]] = [rows[b], rows[a]];
    savePlan(mk, plan, "");
    rerender();
  },
  qpRemoveRow(mk, periodId, rowId) {
    const plan = loadQuincenaPlan(mk);
    const row = findRow(plan, periodId, rowId);
    plan.periods[periodId].rows = plan.periods[periodId].rows.filter((r) => r.id !== rowId);
    savePlan(mk, plan, row ? `${perLabel(periodId)}: quitó ${row.label}` : "");
    rerender();
  },
  qpToggleDone(mk, periodId, rowId) {
    const plan = loadQuincenaPlan(mk);
    const row = findRow(plan, periodId, rowId);
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
      plan.periods[id].fergisIncome = prev.periods[id].fergisIncome;
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
  .qpRoadmap .qpBody { padding: 4px 2px 6px; }
  .qpHint { font-size: 12px; color: rgba(255,255,255,.55); line-height: 1.4; }
  .qpMonthNav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .qpMonthTitle { font-size: 16px; font-weight: 800; color: #fff; cursor: pointer; text-align: center; }
  .qpIncomeGrid { display: grid; grid-template-columns: auto 1fr 1fr; gap: 6px 8px; align-items: center; background: rgba(124,92,255,.08); border: 1px solid rgba(124,92,255,.22); border-radius: 14px; padding: 10px 12px; }
  .qpIncHead { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: rgba(255,255,255,.5); text-align: center; }
  .qpIncName { font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; }
  .qpIncomeInput { width: 100%; box-sizing: border-box; background: rgba(0,0,0,.3); border: 1px solid rgba(124,92,255,.45); color: #fff; border-radius: 9px; padding: 7px 8px; font-size: 15px; font-weight: 700; text-align: right; }
  .qpWarn { font-size: 12.5px; padding: 9px 11px; border-radius: 12px; line-height: 1.4; }
  .qpWarn--warn { background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.3); color: #fde68a; }
  .qpWarn--bad { background: rgba(244,63,94,.12); border: 1px solid rgba(244,63,94,.3); color: #fda4af; }
  .qpViewTabs { display: flex; gap: 6px; }
  .qpViewTabs button, .qpSegMini button { flex: 1; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #d1d5db; padding: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .qpViewTabs button.on, .qpSegMini button.on { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  .qpGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 760px) { .qpGrid { grid-template-columns: 1fr; } }
  .qpPeriod { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .qpPeriodHead { display: flex; gap: 10px; align-items: center; }
  .qpPeriodFree { font-weight: 800; font-size: 15px; white-space: nowrap; }
  .qpDay { width: 42px; height: 42px; border-radius: 12px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; background: linear-gradient(135deg,#7c5cff,#6366f1); color: #fff; }
  .qpDay--sm { width: 34px; height: 34px; font-size: 12px; border-radius: 10px; }
  .qpPeriodTitle { font-size: 14px; font-weight: 800; color: #fff; }
  .qpLanes { display: flex; flex-direction: column; gap: 8px; }
  .qpLane { border-radius: 12px; padding: 8px 10px; background: rgba(0,0,0,.14); }
  .qpLane--fergis { background: rgba(232,121,249,.07); border: 1px solid rgba(232,121,249,.18); }
  .qpLaneHead { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: rgba(255,255,255,.6); margin-bottom: 2px; }
  .qpRows { display: flex; flex-direction: column; }
  .qpRow, .qpUn { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05); flex-wrap: wrap; }
  .qpRow--done .qpRowLabel { text-decoration: line-through; opacity: .6; }
  .qpCheck { width: 24px; height: 24px; flex: none; border-radius: 7px; border: 1.5px solid rgba(255,255,255,.3); background: transparent; font-weight: 900; cursor: pointer; }
  .qpCheck.on { background: #34d399; border-color: #34d399; color: #052e16; }
  .qpRowInfo { flex: 1; min-width: 110px; }
  .qpRowLabel { font-size: 13px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qpRowSub { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 1px; }
  .qpLate { font-size: 12px; }
  .qpAmt { width: 80px; flex: none; text-align: right; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.12); color: #fff; border-radius: 8px; padding: 5px 7px; font-size: 13px; font-weight: 700; }
  .qpRowTools { display: flex; gap: 3px; flex: none; }
  .qpMini { width: 26px; height: 26px; border-radius: 7px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: #e5e7eb; cursor: pointer; font-size: 11px; padding: 0; }
  .qpMini:disabled { opacity: .25; cursor: default; }
  .qpMini--x { color: rgba(255,255,255,.5); }
  .qpEmpty { font-size: 12px; color: rgba(255,255,255,.4); padding: 6px 0; }
  .qpAddBtn { background: rgba(124,92,255,.12); border: 1px dashed rgba(124,92,255,.5); color: #c4b5fd; border-radius: 10px; padding: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .qpAdd { display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,.2); border-radius: 12px; padding: 8px; }
  .qpAddRow { display: flex; gap: 6px; }
  .qpAddRow > * { flex: 1; min-width: 0; }
  .qpSeg { display: flex; gap: 10px; font-size: 13px; color: #e5e7eb; }
  .qpSeg label { display: flex; align-items: center; gap: 4px; }
  .qpInput { width: 100%; box-sizing: border-box; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14); color: #fff; border-radius: 9px; padding: 8px 9px; font-size: 13px; }
  .qpBtn { background: #7c5cff; color: #fff; border: none; border-radius: 9px; padding: 8px; font-weight: 800; cursor: pointer; }
  .qpBtnGhost { background: rgba(255,255,255,.06); color: #e5e7eb; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; padding: 8px 12px; cursor: pointer; }
  .qpMath { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: rgba(255,255,255,.65); border-top: 1px solid rgba(255,255,255,.08); padding-top: 6px; margin-top: 4px; }
  .qpMath div { display: flex; justify-content: space-between; }
  .qpReserve { color: #fbbf24; }
  .qpFree { font-size: 14px; color: #fff; font-weight: 800; margin-top: 2px; }
  .qpUnHead { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px; }
  .qpSegMini { display: flex; gap: 4px; }
  .qpSegMini button { flex: none; padding: 5px 9px; font-size: 11.5px; }
  .qpSubTitle { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: rgba(255,255,255,.5); }
  .qpTo { flex: none; font-size: 11.5px; font-weight: 800; padding: 5px 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: #e5e7eb; cursor: pointer; }
  .qpTo.sug { border-color: rgba(124,92,255,.7); background: rgba(124,92,255,.2); color: #ddd6fe; }
  .qpOk { font-size: 12.5px; color: #34d399; }
  .qpTotals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .qpTotals--two { grid-template-columns: repeat(2, 1fr); }
  .qpTotals div { background: rgba(255,255,255,.04); border-radius: 11px; padding: 8px; display: flex; flex-direction: column; gap: 2px; text-align: center; }
  .qpTotals span { font-size: 10.5px; color: rgba(255,255,255,.5); }
  .qpTotals b { font-size: 14px; color: #fff; }
  .qpLink { background: none; border: none; color: #a78bfa; font-size: 12px; font-weight: 700; cursor: pointer; padding: 2px 4px; }
  .qpCard { white-space: pre-wrap; font-size: 11.5px; line-height: 1.45; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px; color: rgba(255,255,255,.8); margin: 4px 0 0; font-family: ui-monospace, monospace; }
  .qpSumRow { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #e5e7eb; }
  .qpTl { display: flex; flex-direction: column; }
  .qpTlRow { display: grid; grid-template-columns: 30px 1fr auto; grid-template-areas: "day info amt" "day info bal"; gap: 0 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05); align-items: center; }
  .qpTlRow .qpTlDay { grid-area: day; font-weight: 800; color: rgba(255,255,255,.7); text-align: center; }
  .qpTlRow .qpRowInfo { grid-area: info; }
  .qpTlAmt { grid-area: amt; font-weight: 800; font-size: 13px; text-align: right; }
  .qpTlBal { grid-area: bal; font-size: 11px; color: rgba(255,255,255,.5); text-align: right; white-space: nowrap; }
  .qpTlBal.neg { color: #fb7185; font-weight: 800; }
  .qpTlIn { background: rgba(52,211,153,.06); }
  .qpIn { color: #34d399; }
  </style>`;
}

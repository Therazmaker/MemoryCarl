/*************************************************************
 * FINANCE ROADMAP v1 — Planificador de Flujo Mensual
 * Carlos Herraz · MemoryCarl
 *
 * Flujo: Ingresos → Compromisos fijos → Deudas priorizadas
 *        → Asignación Fergis → Libre restante
 *
 * Deps: state, persist(), view(), escapeHtml(), _financeFmt(),
 *       getCurrentMonthKey(), financeDebtsActive(),
 *       financeDebtSafeNum(), toast()
 *************************************************************/

/* ── LS Key & State bootstrap ──────────────────────────── */
LS.financeRoadmap = 'memorycarl_v2_finance_roadmap';
state.financeRoadmap = load(LS.financeRoadmap, {});

/* Persist hook — injected into existing persist() via guard */
(function patchPersist(){
  const _orig = window._financeRoadmapPersistPatched;
  if(_orig) return;
  window._financeRoadmapPersistPatched = true;
  const origPersist = window.persist || persist;
  // We hook by appending a save call after the module loads;
  // persist() is called from within state mutations below.
})();

function _roadmapSave(){
  try{ localStorage.setItem(LS.financeRoadmap, JSON.stringify(state.financeRoadmap)); }catch(_e){}
}

/* ── Data helpers ───────────────────────────────────────── */

function roadmapGetMonth(mk){
  if(!state.financeRoadmap[mk]){
    state.financeRoadmap[mk] = {
      sueldo: 0,          // ingreso fijo Carlos
      fergisIncome: 0,    // ingreso Fergis
      fergisTarget: null, // id deuda destino Fergis
      order: [],          // [{id, type:'commitment'|'debt', deferrable:bool, priority:int}]
      activeView: 'cascade' // 'cascade' | 'timeline' | 'cashflow'
    };
  }
  return state.financeRoadmap[mk];
}

function roadmapSet(mk, patch){
  const cur = roadmapGetMonth(mk);
  Object.assign(cur, patch);
  _roadmapSave();
  view();
}

function roadmapSetOrder(mk, order){
  roadmapGetMonth(mk).order = order;
  _roadmapSave();
  view();
}

/* Build merged item list (commitments + debts) synced with order */
function roadmapBuildItems(mk){
  const plan = roadmapGetMonth(mk);

  // Commitments from state
  const commitments = (state.financeCommitments||[])
    .filter(c => c && c.active !== false)
    .map(c => ({
      id: c.id,
      type: 'commitment',
      name: c.name || '—',
      amount: financeDebtSafeNum(c.amount||0),
      dueDay: c.dueDay || null,
      deferrable: false
    }));

  // Active debts
  const debts = (financeDebtsActive ? financeDebtsActive() : (state.financeDebts||[]))
    .filter(d => String(d.status||'active') === 'active')
    .map(d => ({
      id: d.id,
      type: 'debt',
      name: d.name || '—',
      amount: financeDebtSafeNum(d.monthlyDue||0),
      balance: financeDebtSafeNum(d.balance||0),
      dueDay: d.dueDay || null,
      deferrable: false
    }));

  const allById = {};
  [...commitments, ...debts].forEach(x => { allById[x.id] = x; });

  // Merge saved order overrides (deferrable flag)
  const savedOrder = plan.order || [];
  savedOrder.forEach(o => {
    if(allById[o.id]){
      allById[o.id].deferrable = !!o.deferrable;
    }
  });

  // Build ordered list: use saved priority positions, append new items at end
  const orderedIds = savedOrder.map(o => o.id).filter(id => allById[id]);
  const newIds = Object.keys(allById).filter(id => !orderedIds.includes(id));
  const finalOrder = [...orderedIds, ...newIds];

  return finalOrder.map((id, idx) => ({ ...allById[id], priority: idx }));
}

/* Cascade simulation */
function roadmapSimulate(mk){
  const plan = roadmapGetMonth(mk);
  const items = roadmapBuildItems(mk);

  const totalIncome = financeDebtSafeNum(plan.sueldo||0)
                    + financeDebtSafeNum(plan.fergisIncome||0);

  let remaining = totalIncome;
  const steps = [];

  for(const item of items){
    const pay = Math.min(remaining, Math.max(0, item.amount));
    const canPay = remaining >= item.amount;
    remaining = Math.max(0, remaining - item.amount);

    steps.push({
      ...item,
      pay,
      canPay,
      remainingAfter: remaining,
      isFergisTarget: item.id === plan.fergisTarget
    });
  }

  // Fergis allocation note
  const fergisItem = steps.find(s => s.id === plan.fergisTarget);
  const fergisAmt = financeDebtSafeNum(plan.fergisIncome||0);

  return { steps, remaining, totalIncome, fergisItem, fergisAmt };
}

/* Build weekly cashflow grid (4 weeks) */
function roadmapCashflow(mk){
  const plan = roadmapGetMonth(mk);
  const items = roadmapBuildItems(mk);
  const weeklyIncome = financeDebtSafeNum(plan.sueldo||0) / 4;
  const fergisWeekly = financeDebtSafeNum(plan.fergisIncome||0) / 4;

  const weeks = [1,2,3,4].map(w => {
    const wItems = items.filter(it => {
      if(!it.dueDay) return w === 1;
      const day = Number(it.dueDay);
      if(day <= 7)  return w === 1;
      if(day <= 14) return w === 2;
      if(day <= 21) return w === 3;
      return w === 4;
    });
    const totalOut = wItems.reduce((s,x) => s + x.amount, 0);
    const income = weeklyIncome + fergisWeekly;
    return { week: w, items: wItems, income, totalOut, balance: income - totalOut };
  });

  return weeks;
}

/* ── Render ─────────────────────────────────────────────── */

function renderFinanceRoadmapTab(){
  const mk = getCurrentMonthKey();
  const plan = roadmapGetMonth(mk);
  const sim = roadmapSimulate(mk);
  const fmt = _financeFmt;

  const tabs = ['cascade','timeline','cashflow'];
  const tabLabels = { cascade:'💧 Cascada', timeline:'📅 Calendario', cashflow:'📊 Flujo semanal' };
  const activeView = plan.activeView || 'cascade';

  const tabBtns = tabs.map(t => `
    <button class="rmTab ${activeView===t?'rmTabActive':''}"
      onclick="roadmapSetView('${mk}','${t}')">${tabLabels[t]}</button>
  `).join('');

  /* ── Income panel ── */
  const sueldo = financeDebtSafeNum(plan.sueldo||0);
  const fergis = financeDebtSafeNum(plan.fergisIncome||0);
  const totalIn = sueldo + fergis;

  const incomePanel = `
    <div class="rmIncomePanel">
      <div class="rmIncomePanelTitle">💰 Ingresos del mes</div>
      <div class="rmIncomeGrid">
        <div class="rmIncomeRow">
          <div class="rmIncomeIcon">🧑</div>
          <div class="rmIncomeInfo">
            <div class="rmIncomeLabel">Tu sueldo</div>
            <input class="rmIncomeInput" type="number" inputmode="decimal"
              placeholder="0.00" value="${sueldo||''}"
              oninput="roadmapSetIncome('${mk}','sueldo',this.value)" />
          </div>
          <div class="rmIncomeAmt">S/ ${fmt(sueldo)}</div>
        </div>
        <div class="rmIncomeRow">
          <div class="rmIncomeIcon">💜</div>
          <div class="rmIncomeInfo">
            <div class="rmIncomeLabel">Fergis</div>
            <input class="rmIncomeInput" type="number" inputmode="decimal"
              placeholder="0.00" value="${fergis||''}"
              oninput="roadmapSetIncome('${mk}','fergisIncome',this.value)" />
          </div>
          <div class="rmIncomeAmt">S/ ${fmt(fergis)}</div>
        </div>
      </div>
      <div class="rmIncomeTotalRow">
        <span class="muted">Total disponible</span>
        <strong class="rmIncomeTotal">S/ ${fmt(totalIn)}</strong>
      </div>
    </div>
  `;

  /* ── View bodies ── */
  let viewBody = '';
  if(activeView === 'cascade')  viewBody = _roadmapCascadeView(mk, sim, fmt);
  if(activeView === 'timeline') viewBody = _roadmapTimelineView(mk, sim, fmt);
  if(activeView === 'cashflow') viewBody = _roadmapCashflowView(mk, fmt);

  /* ── Fergis assignment ── */
  const debtOptions = (financeDebtsActive ? financeDebtsActive() : [])
    .filter(d => String(d.status||'active')==='active')
    .map(d => `<option value="${d.id}" ${plan.fergisTarget===d.id?'selected':''}>${escapeHtml(d.name)} (S/ ${fmt(financeDebtSafeNum(d.monthlyDue||0))})</option>`)
    .join('');

  const fergisAssign = fergis > 0 ? `
    <div class="rmFergisBox">
      <div class="rmFergisTitle">💜 Asignación Fergis — S/ ${fmt(fergis)}</div>
      <div class="muted" style="margin-bottom:8px">¿A qué deuda/compromiso va este ingreso?</div>
      <select class="rmFergisSelect" onchange="roadmapSetFergisTarget('${mk}',this.value)">
        <option value="">— Sin asignar —</option>
        ${debtOptions}
      </select>
      ${plan.fergisTarget ? `<div class="rmFergisNote">✅ S/ ${fmt(fergis)} asignado para reforzar el pago de <strong>${escapeHtml((financeDebtsActive()||[]).find(d=>d.id===plan.fergisTarget)?.name||'')}</strong></div>` : ''}
    </div>
  ` : '';

  /* ── Free balance summary ── */
  const freeColor = sim.remaining >= 0 ? 'rmFreeGood' : 'rmFreeBad';
  const freeSummary = `
    <div class="rmFreeSummary ${freeColor}">
      <div class="rmFreeLabel">${sim.remaining >= 0 ? '✅ Libre después de todo' : '⚠️ Déficit estimado'}</div>
      <div class="rmFreeAmt">S/ ${fmt(Math.abs(sim.remaining))}</div>
      ${sim.remaining < 0 ? `<div class="muted" style="margin-top:4px">Faltan S/ ${fmt(Math.abs(sim.remaining))} para cubrir todos los compromisos.</div>` : `<div class="muted" style="margin-top:4px">Puedes ahorrar, acelerar una deuda o guardarlo.</div>`}
    </div>
  `;

  return `
    <section class="card homeCard homeWide rmWrap">
      <div class="cardTop">
        <h2 class="cardTitle">🗺️ Hoja de Ruta Mensual</h2>
      </div>
      <div class="hr"></div>

      ${incomePanel}

      <div class="hr" style="margin-top:12px"></div>
      ${fergisAssign}
      ${fergisAssign ? '<div class="hr" style="margin-top:12px"></div>' : ''}

      <div class="rmTabBar">${tabBtns}</div>

      <div class="rmViewBody">
        ${viewBody}
      </div>

      <div class="hr" style="margin-top:12px"></div>
      ${freeSummary}
    </section>

    ${_roadmapStyles()}
  `;
}

/* ── Cascade view ───────────────────────────────────────── */
function _roadmapCascadeView(mk, sim, fmt){
  const items = roadmapBuildItems(mk);

  if(!items.length) return `<div class="muted" style="padding:16px">Agrega compromisos o deudas para ver la cascada de pagos.</div>`;

  let balanceLeft = sim.totalIncome;

  const rows = sim.steps.map((s, idx) => {
    const pct = sim.totalIncome > 0 ? Math.max(0, Math.min(100, (s.remainingAfter / sim.totalIncome) * 100)) : 0;
    const payPct = sim.totalIncome > 0 ? Math.min(100, (s.amount / sim.totalIncome) * 100) : 0;
    const chip = s.deferrable
      ? `<span class="rmChipDefer">aplazable</span>`
      : `<span class="rmChipFixed">fijo</span>`;
    const status = s.canPay
      ? `<span class="rmStatusOk">✓</span>`
      : `<span class="rmStatusBad">✗</span>`;
    const fergisTag = s.isFergisTarget ? `<span class="rmChipFergis">💜 Fergis</span>` : '';

    return `
      <div class="rmCascadeRow" data-id="${s.id}">
        <div class="rmCascadeLeft">
          <div class="rmCascadeOrder">${idx+1}</div>
          <div class="rmCascadeInfo">
            <div class="rmCascadeName">
              ${status} ${escapeHtml(s.name)}
              <span class="rmCascadeType">${s.type==='commitment'?'💼':'💳'}</span>
              ${chip} ${fergisTag}
            </div>
            <div class="muted">Pago: S/ ${fmt(s.amount)} · queda S/ ${fmt(s.remainingAfter)} después</div>
            <div class="rmCascadeBar">
              <div class="rmCascadeBarFill" style="width:${pct.toFixed(1)}%"></div>
            </div>
          </div>
        </div>
        <div class="rmCascadeRight">
          <div class="rmCascadeAmt ${s.canPay?'rmAmtOk':'rmAmtBad'}">S/ ${fmt(s.amount)}</div>
          <div class="rmDeferToggle">
            <label class="rmToggleLabel">
              <input type="checkbox" ${s.deferrable?'checked':''}
                onchange="roadmapToggleDeferrable('${mk}','${s.id}',this.checked)" />
              <span class="muted" style="font-size:10px">aplazar</span>
            </label>
          </div>
          <div class="rmMoveButtons">
            <button class="rmMoveBtn" title="Subir" onclick="roadmapMoveItem('${mk}','${s.id}',-1)">▲</button>
            <button class="rmMoveBtn" title="Bajar" onclick="roadmapMoveItem('${mk}','${s.id}',1)">▼</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const deferTotal = sim.steps.filter(s=>s.deferrable).reduce((a,s)=>a+s.amount,0);
  const deferHint = deferTotal > 0
    ? `<div class="rmDeferHint">Si aplazas los ítems marcados, liberas S/ ${fmt(deferTotal)} adicionales.</div>`
    : '';

  return `
    <div class="rmCascadeList">${rows}</div>
    ${deferHint}
  `;
}

/* ── Timeline view ──────────────────────────────────────── */
function _roadmapTimelineView(mk, sim, fmt){
  // Group by due week
  const items = roadmapBuildItems(mk);
  const weeks = { '1-7':[], '8-14':[], '15-21':[], '22-31':[] };
  const weekLabels = { '1-7':'Semana 1 (días 1–7)', '8-14':'Semana 2 (días 8–14)', '15-21':'Semana 3 (días 15–21)', '22-31':'Semana 4 (días 22–31)' };

  items.forEach(it => {
    const day = Number(it.dueDay||1);
    const key = day<=7 ? '1-7' : day<=14 ? '8-14' : day<=21 ? '15-21' : '22-31';
    weeks[key].push(it);
  });

  const weekIncome = financeDebtSafeNum(roadmapGetMonth(mk).sueldo||0) / 4;
  const fergisWeekly = financeDebtSafeNum(roadmapGetMonth(mk).fergisIncome||0) / 4;

  const weekCards = Object.entries(weeks).map(([key, wItems]) => {
    const total = wItems.reduce((s,x)=>s+x.amount,0);
    const income = weekIncome + fergisWeekly;
    const ok = income >= total;
    const rows = wItems.map(it=>`
      <div class="rmTimelineItem">
        <span class="rmTimelineIcon">${it.type==='commitment'?'💼':'💳'}</span>
        <span class="rmTimelineName">${escapeHtml(it.name)}</span>
        <span class="rmTimelineAmt">S/ ${fmt(it.amount)}</span>
        ${it.deferrable?`<span class="rmChipDefer">aplazable</span>`:''}
      </div>
    `).join('') || `<div class="muted" style="padding:6px 0">Sin pagos esta semana</div>`;

    return `
      <div class="rmWeekCard ${ok?'rmWeekOk':'rmWeekBad'}">
        <div class="rmWeekHead">
          <div class="rmWeekLabel">${weekLabels[key]}</div>
          <div class="rmWeekBalance ${ok?'':'rmAmtBad'}">
            ${ok ? `+S/ ${fmt(income-total)}` : `-S/ ${fmt(total-income)}`}
          </div>
        </div>
        <div class="rmWeekIncome muted">Ingreso semanal estimado: S/ ${fmt(income)}</div>
        ${rows}
        <div class="rmWeekTotal">Total salida: S/ ${fmt(total)}</div>
      </div>
    `;
  }).join('');

  return `<div class="rmTimelineGrid">${weekCards}</div>`;
}

/* ── Cash flow view ─────────────────────────────────────── */
function _roadmapCashflowView(mk, fmt){
  const weeks = roadmapCashflow(mk);
  let accumulated = 0;

  const rows = weeks.map(w => {
    accumulated += w.balance;
    const isPos = accumulated >= 0;
    const barPct = Math.min(100, Math.abs(w.balance) / Math.max(...weeks.map(x=>Math.max(Math.abs(x.income), Math.abs(x.totalOut)))) * 100);

    return `
      <div class="rmCfRow">
        <div class="rmCfWeek">S${w.week}</div>
        <div class="rmCfBars">
          <div class="rmCfBarIn" style="width:${(w.income / Math.max(...weeks.map(x=>x.income+0.01)) * 100).toFixed(1)}%"></div>
          <div class="rmCfBarOut" style="width:${(w.totalOut / Math.max(...weeks.map(x=>x.income+0.01)) * 100).toFixed(1)}%"></div>
        </div>
        <div class="rmCfNums">
          <span class="rmCfIn">+${fmt(w.income)}</span>
          <span class="rmCfOut">-${fmt(w.totalOut)}</span>
        </div>
        <div class="rmCfAcum ${isPos?'rmCfPos':'rmCfNeg'}">
          ${isPos?'':''}S/ ${fmt(accumulated)}
        </div>
      </div>
    `;
  }).join('');

  const itemLegend = roadmapBuildItems(mk).slice(0,8).map(it=>`
    <div class="rmCfItem">
      <span>${it.type==='commitment'?'💼':'💳'}</span>
      <span>${escapeHtml(it.name)}</span>
      <span class="rmCfItemAmt">S/ ${fmt(it.amount)}</span>
    </div>
  `).join('');

  return `
    <div class="rmCfWrap">
      <div class="rmCfLegend">
        <span class="rmCfLegIn">■ Entrada</span>
        <span class="rmCfLegOut">■ Salida</span>
      </div>
      <div class="rmCfChart">${rows}</div>
      <div class="hr" style="margin:10px 0"></div>
      <div class="muted" style="margin-bottom:6px;font-size:11px">Ítems por semana</div>
      <div class="rmCfItemList">${itemLegend}</div>
    </div>
  `;
}

/* ── State mutators (global) ────────────────────────────── */

function roadmapSetView(mk, view){
  roadmapGetMonth(mk).activeView = view;
  _roadmapSave();
  window.view ? window.view() : view();
}

function roadmapSetIncome(mk, key, val){
  roadmapGetMonth(mk)[key] = financeDebtSafeNum(val);
  _roadmapSave();
  // debounce view refresh
  clearTimeout(window._rmInputTimer);
  window._rmInputTimer = setTimeout(()=>{ try{ view(); }catch(_e){} }, 400);
}

function roadmapSetFergisTarget(mk, id){
  roadmapGetMonth(mk).fergisTarget = id || null;
  _roadmapSave();
  view();
}

function roadmapToggleDeferrable(mk, id, flag){
  const order = roadmapBuildItems(mk).map(it => ({
    id: it.id,
    deferrable: it.id === id ? !!flag : !!it.deferrable
  }));
  roadmapGetMonth(mk).order = order;
  _roadmapSave();
  view();
}

function roadmapMoveItem(mk, id, delta){
  const items = roadmapBuildItems(mk);
  const idx = items.findIndex(x=>x.id===id);
  if(idx === -1) return;
  const newIdx = Math.max(0, Math.min(items.length-1, idx+delta));
  if(newIdx === idx) return;
  const arr = [...items];
  const [moved] = arr.splice(idx,1);
  arr.splice(newIdx,0,moved);
  roadmapGetMonth(mk).order = arr.map(x=>({ id:x.id, deferrable:!!x.deferrable }));
  _roadmapSave();
  view();
}

try{
  window.roadmapSetView = roadmapSetView;
  window.roadmapSetIncome = roadmapSetIncome;
  window.roadmapSetFergisTarget = roadmapSetFergisTarget;
  window.roadmapToggleDeferrable = roadmapToggleDeferrable;
  window.roadmapMoveItem = roadmapMoveItem;
  window.renderFinanceRoadmapTab = renderFinanceRoadmapTab;
}catch(e){}

/* ── Styles ─────────────────────────────────────────────── */
function _roadmapStyles(){
  if(document.getElementById('_rmStyles')) return '';
  return `
  <style id="_rmStyles">
  /* ── Wrap ── */
  .rmWrap { padding-bottom: 20px; }

  /* ── Income panel ── */
  .rmIncomePanel {
    background: rgba(124,92,255,.08);
    border: 1px solid rgba(124,92,255,.2);
    border-radius: 16px;
    padding: 14px 16px;
    margin-top: 12px;
  }
  .rmIncomePanelTitle {
    font-size: 12px; font-weight: 700; letter-spacing: .6px;
    text-transform: uppercase; color: rgba(255,255,255,.45); margin-bottom: 12px;
  }
  .rmIncomeGrid { display: flex; flex-direction: column; gap: 10px; }
  .rmIncomeRow {
    display: flex; align-items: center; gap: 10px;
  }
  .rmIncomeIcon { font-size: 20px; flex-shrink: 0; width: 28px; text-align: center; }
  .rmIncomeInfo { flex: 1; min-width: 0; }
  .rmIncomeLabel { font-size: 11px; color: rgba(255,255,255,.4); margin-bottom: 4px; }
  .rmIncomeInput {
    width: 100%; max-width: 140px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    border-radius: 8px; padding: 6px 10px;
    color: inherit; font-size: 14px; font-weight: 600;
    outline: none;
  }
  .rmIncomeInput:focus { border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.1); }
  .rmIncomeAmt { font-size: 16px; font-weight: 700; white-space: nowrap; min-width: 80px; text-align: right; }
  .rmIncomeTotalRow {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 12px; padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,.08);
  }
  .rmIncomeTotal { font-size: 20px; font-weight: 800; color: #36d399; }

  /* ── Tab bar ── */
  .rmTabBar {
    display: flex; gap: 6px; flex-wrap: wrap;
    margin: 12px 0 10px;
  }
  .rmTab {
    padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.55); cursor: pointer; transition: all .15s;
  }
  .rmTab:hover { background: rgba(255,255,255,.1); color: #fff; }
  .rmTabActive {
    background: rgba(124,92,255,.25) !important;
    border-color: rgba(124,92,255,.5) !important;
    color: #c4b5fd !important;
  }

  /* ── Cascade ── */
  .rmCascadeList { display: flex; flex-direction: column; gap: 2px; }
  .rmCascadeRow {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 6px; border-radius: 12px;
    transition: background .12s;
  }
  .rmCascadeRow:hover { background: rgba(255,255,255,.04); }
  .rmCascadeLeft { display: flex; gap: 10px; flex: 1; min-width: 0; }
  .rmCascadeOrder {
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 2px;
  }
  .rmCascadeInfo { flex: 1; min-width: 0; }
  .rmCascadeName {
    font-size: 13px; font-weight: 600;
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  }
  .rmCascadeType { font-size: 12px; }
  .rmCascadeBar {
    height: 3px; background: rgba(255,255,255,.07);
    border-radius: 2px; overflow: hidden; margin-top: 6px;
  }
  .rmCascadeBarFill {
    height: 100%; background: linear-gradient(90deg,#7c5cff,#36d399);
    border-radius: 2px; transition: width .4s ease;
  }
  .rmCascadeRight {
    display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
    flex-shrink: 0;
  }
  .rmCascadeAmt { font-size: 15px; font-weight: 700; }
  .rmAmtOk  { color: #36d399; }
  .rmAmtBad { color: #fb7185; }
  .rmStatusOk  { color: #36d399; }
  .rmStatusBad { color: #fb7185; }

  /* Move buttons */
  .rmMoveButtons { display: flex; gap: 2px; }
  .rmMoveBtn {
    width: 22px; height: 22px; border-radius: 6px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
    font-size: 9px; cursor: pointer; color: rgba(255,255,255,.5);
    display: flex; align-items: center; justify-content: center;
    transition: background .12s;
  }
  .rmMoveBtn:hover { background: rgba(255,255,255,.14); color: #fff; }

  /* Defer toggle */
  .rmDeferToggle { display: flex; align-items: center; gap: 4px; }
  .rmToggleLabel { display: flex; align-items: center; gap: 4px; cursor: pointer; }

  /* Chips */
  .rmChipFixed  { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(251,113,133,.15); color: #fb7185; font-weight: 700; }
  .rmChipDefer  { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(251,191,36,.15); color: #fbbf24; font-weight: 700; }
  .rmChipFergis { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(168,85,247,.2); color: #c084fc; font-weight: 700; }
  .rmDeferHint  { font-size: 12px; color: #fbbf24; margin-top: 10px; padding: 8px 12px; background: rgba(251,191,36,.08); border-radius: 10px; border: 1px solid rgba(251,191,36,.2); }

  /* ── Timeline ── */
  .rmTimelineGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media(max-width:480px){ .rmTimelineGrid { grid-template-columns: 1fr; } }
  .rmWeekCard {
    border-radius: 14px; padding: 12px 14px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.03);
  }
  .rmWeekOk  { border-color: rgba(54,211,153,.2) !important; }
  .rmWeekBad { border-color: rgba(251,113,133,.25) !important; }
  .rmWeekHead {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 6px;
  }
  .rmWeekLabel { font-size: 12px; font-weight: 700; }
  .rmWeekBalance { font-size: 13px; font-weight: 700; color: #36d399; }
  .rmWeekIncome { font-size: 11px; margin-bottom: 8px; }
  .rmWeekTotal { font-size: 11px; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,.45); }
  .rmTimelineItem {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.05);
    font-size: 12px;
  }
  .rmTimelineItem:last-child { border-bottom: none; }
  .rmTimelineIcon { flex-shrink: 0; }
  .rmTimelineName { flex: 1; }
  .rmTimelineAmt { font-weight: 600; white-space: nowrap; }

  /* ── Cash flow ── */
  .rmCfWrap { padding: 4px 0; }
  .rmCfLegend { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; }
  .rmCfLegIn  { color: #36d399; }
  .rmCfLegOut { color: #fb7185; }
  .rmCfChart { display: flex; flex-direction: column; gap: 8px; }
  .rmCfRow {
    display: grid; grid-template-columns: 28px 1fr 110px 80px;
    align-items: center; gap: 8px;
  }
  .rmCfWeek { font-size: 11px; font-weight: 700; color: rgba(255,255,255,.4); }
  .rmCfBars { display: flex; flex-direction: column; gap: 3px; }
  .rmCfBarIn  { height: 6px; background: #36d399; border-radius: 3px; min-width: 4px; transition: width .4s; }
  .rmCfBarOut { height: 6px; background: #fb7185; border-radius: 3px; min-width: 4px; transition: width .4s; }
  .rmCfNums { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
  .rmCfIn  { color: #36d399; }
  .rmCfOut { color: #fb7185; }
  .rmCfAcum { font-size: 13px; font-weight: 700; text-align: right; }
  .rmCfPos { color: #36d399; }
  .rmCfNeg { color: #fb7185; }
  .rmCfItemList { display: flex; flex-direction: column; gap: 4px; }
  .rmCfItem {
    display: flex; align-items: center; gap: 8px; font-size: 12px;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .rmCfItem:last-child { border-bottom: none; }
  .rmCfItemAmt { margin-left: auto; font-weight: 600; }

  /* ── Fergis box ── */
  .rmFergisBox {
    background: rgba(168,85,247,.08);
    border: 1px solid rgba(168,85,247,.2);
    border-radius: 14px; padding: 14px 16px; margin-top: 12px;
  }
  .rmFergisTitle { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .rmFergisSelect {
    width: 100%; padding: 8px 10px; border-radius: 10px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    color: inherit; font-size: 13px; outline: none;
  }
  .rmFergisSelect:focus { border-color: rgba(168,85,247,.5); }
  .rmFergisNote {
    margin-top: 8px; font-size: 12px; color: #c084fc;
    padding: 6px 10px; background: rgba(168,85,247,.1); border-radius: 8px;
  }

  /* ── Free summary ── */
  .rmFreeSummary {
    border-radius: 14px; padding: 14px 16px; margin-top: 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .rmFreeGood { background: rgba(54,211,153,.1); border: 1px solid rgba(54,211,153,.25); }
  .rmFreeBad  { background: rgba(251,113,133,.1); border: 1px solid rgba(251,113,133,.25); }
  .rmFreeLabel { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .rmFreeAmt { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
  .rmFreeGood .rmFreeAmt { color: #36d399; }
  .rmFreeBad  .rmFreeAmt { color: #fb7185; }
  </style>
  `;
}

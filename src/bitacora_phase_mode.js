/**
 * SISTEMA DE FASES PROGRESIVAS v2
 * Lógica fiel al Excel 3FASES — escalera bola de nieve, reinicio al perder, soles
 */

export const DEFAULT_PHASES = [
  { id: 1, name: 'FASE 1', picks: 2, minOdds: 1.35, maxOdds: 1.50 },
  { id: 2, name: 'FASE 2', picks: 4, minOdds: 1.35, maxOdds: 1.50 },
  { id: 3, name: 'FASE 3', picks: 4, minOdds: 1.35, maxOdds: 1.50 }
];

const RESULT_VALUES = ['win', 'loss', 'void', 'pending'];

function clamp(v, min, max){ return Math.max(min, Math.min(max, Number(v) || 0)); }
function safeNum(v, fb){ const n = Number(v); return Number.isFinite(n) ? n : (fb ?? 0); }
function safeStr(v, fb){ return String(v ?? (fb ?? '')).trim(); }
function uid(p){ return `${p || 'p'}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

function buildSteps(phases){
  const ph = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  const steps = [];
  let order = 1;
  for(const phase of ph){
    const total = Math.max(1, safeNum(phase.picks, 2));
    for(let pn = 1; pn <= total; pn++){
      steps.push({ order, phaseId: safeNum(phase.id, order), phaseName: safeStr(phase.name, `FASE ${phase.id}`), pickNumber: pn, totalInPhase: total });
      order++;
    }
  }
  return steps;
}

function normalizePick(raw){
  raw = raw || {};
  return {
    id:              safeStr(raw.id || uid('pp')),
    date:            safeStr(raw.date || new Date().toISOString().slice(0,10)),
    league:          safeStr(raw.league),
    match:           safeStr(raw.match),
    market:          safeStr(raw.market),
    selection:       safeStr(raw.selection),
    odds:            clamp(safeNum(raw.odds, 1.40), 1.01, 50),
    result:          RESULT_VALUES.includes(raw.result) ? raw.result : 'pending',
    notes:           safeStr(raw.notes),
    narrativeScore:  clamp(safeNum(raw.narrativeScore, 0), 0, 100),
    emotionalFlag:   !!raw.emotionalFlag,
    marketConsistent: raw.marketConsistent !== false,
    phase:           safeNum(raw.phase, 1),
    pickNumber:      safeNum(raw.pickNumber, 1),
    phaseName:       safeStr(raw.phaseName),
    stepOrder:       safeNum(raw.stepOrder, 0),
    stakeUsed:       safeNum(raw.stakeUsed, 0),
    bankrollBefore:  safeNum(raw.bankrollBefore, 0),
    bankrollAfter:   safeNum(raw.bankrollAfter, 0),
    profit:          safeNum(raw.profit, 0),
    netFromUnit:     safeNum(raw.netFromUnit, 0),
    pctFromUnit:     safeNum(raw.pctFromUnit, 0),
    grossReturn:     safeNum(raw.grossReturn, 0),
    invalidSequence: !!raw.invalidSequence
  };
}

export function recomputePhaseCampaign(campaign){
  const phases  = Array.isArray(campaign.phases) && campaign.phases.length ? campaign.phases : DEFAULT_PHASES;
  const steps   = buildSteps(phases);
  const unit    = clamp(safeNum(campaign.initialUnit, 25), 0.5, 1e9);
  let bankroll  = unit;
  let status    = 'active';
  let stepCursor = 0;
  let failedAt  = null;
  let completedAt = null;
  let blockedPending = false;

  const picks = (Array.isArray(campaign.picks) ? campaign.picks : []).map((rawPick) => {
    const pick = normalizePick(rawPick);
    const step = steps[stepCursor] || steps[steps.length - 1];
    if(status !== 'active' || blockedPending){ pick.invalidSequence = true; return pick; }
    pick.phase = step.phaseId;
    pick.phaseName = step.phaseName;
    pick.pickNumber = step.pickNumber;
    pick.stepOrder = step.order;
    pick.invalidSequence = false;
    pick.stakeUsed = bankroll;
    pick.bankrollBefore = bankroll;
    if(pick.result === 'win'){
      const gross = pick.stakeUsed * pick.odds;
      pick.grossReturn = Number(gross.toFixed(2));
      pick.profit = Number((gross - pick.stakeUsed).toFixed(2));
      pick.bankrollAfter = gross;
      pick.netFromUnit = Number((gross - unit).toFixed(2));
      pick.pctFromUnit = Number(((gross / unit - 1) * 100).toFixed(1));
      bankroll = gross;
      stepCursor++;
      if(stepCursor >= steps.length){ status = 'completed'; completedAt = pick.date; }
    } else if(pick.result === 'loss'){
      pick.grossReturn = 0;
      pick.profit = -pick.stakeUsed;
      pick.bankrollAfter = 0;
      pick.netFromUnit = -unit;
      pick.pctFromUnit = -100;
      bankroll = 0;
      status = 'failed';
      failedAt = { phaseId: step.phaseId, phaseName: step.phaseName, pickNumber: step.pickNumber, stepOrder: step.order, lostStake: pick.stakeUsed, date: pick.date };
    } else if(pick.result === 'void'){
      pick.grossReturn = bankroll;
      pick.profit = 0;
      pick.bankrollAfter = bankroll;
      pick.netFromUnit = Number((bankroll - unit).toFixed(2));
      pick.pctFromUnit = Number(((bankroll / unit - 1) * 100).toFixed(1));
      if(campaign.allowVoidAdvance) stepCursor++;
    } else {
      pick.grossReturn = bankroll;
      pick.profit = 0;
      pick.bankrollAfter = bankroll;
      pick.netFromUnit = Number((bankroll - unit).toFixed(2));
      pick.pctFromUnit = Number(((bankroll / unit - 1) * 100).toFixed(1));
      blockedPending = true;
    }
    return pick;
  });

  const nextStep = steps[Math.min(stepCursor, steps.length - 1)] || null;
  const stepsCompleted = Math.min(stepCursor, steps.length);
  const currentPhaseId = status === 'completed' ? phases[phases.length-1]?.id : (nextStep?.phaseId || 1);
  const currentPickNum = status === 'completed' ? (phases[phases.length-1]?.picks || 1) : (nextStep?.pickNumber || 1);
  const finalBankroll  = status === 'failed' ? 0 : bankroll;
  const netProfit      = finalBankroll - unit;

  return {
    ...campaign,
    picks, phases, steps,
    initialUnit: unit,
    bankroll: finalBankroll,
    status,
    currentPhaseId, currentPickNum,
    stepsCompleted, totalSteps: steps.length,
    failedAt, completedAt, blockedPending,
    netProfit: Number(netProfit.toFixed(2)),
    netPct: Number(((finalBankroll / unit - 1) * 100).toFixed(1)),
    allowVoidAdvance: !!campaign.allowVoidAdvance
  };
}

export function createPhaseCampaign({ initialUnit = 25, phases, name = '' } = {}){
  const ph = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  return recomputePhaseCampaign({
    id: uid('camp'),
    name: name || `Campaña ${new Date().toLocaleDateString('es-PE')}`,
    startDate: new Date().toISOString().slice(0,10),
    initialUnit, phases: ph, picks: [], allowVoidAdvance: false, status: 'active'
  });
}

export function ensurePhaseModeState(raw){
  const st = { config: { phases: DEFAULT_PHASES }, campaigns: [], selectedCampaignId: '', ...(raw || {}) };
  const sourcePhases = Array.isArray(st.config?.phases) && st.config.phases.length ? st.config.phases : DEFAULT_PHASES;
  st.config = { phases: sourcePhases.map((p, i) => ({ id: i+1, name: safeStr(p.name || `FASE ${i+1}`), picks: Math.max(1, safeNum(p.picks, 2)), minOdds: clamp(safeNum(p.minOdds, 1.35), 1.01, 10), maxOdds: clamp(safeNum(p.maxOdds, 1.50), 1.01, 10) })) };
  st.campaigns = Array.isArray(st.campaigns) ? st.campaigns.map(c => recomputePhaseCampaign({ ...c, phases: st.config.phases })) : [];
  st.selectedCampaignId = safeStr(st.selectedCampaignId);
  return st;
}

export function ensurePhaseCampaign(raw, phases){ return recomputePhaseCampaign({ ...(raw || {}), phases: phases || DEFAULT_PHASES }); }

export function calcPhaseMetrics(campaign){
  const unit = clamp(safeNum(campaign.initialUnit, 1), 0.01, 1e9);
  const bankroll = clamp(safeNum(campaign.bankroll, 0), 0, 1e9);
  const profit = bankroll - unit;
  let streak = 0;
  for(const p of campaign.picks || []){ if(p.result === 'win') streak++; else if(p.result === 'loss') streak = 0; }
  return { profit, roi: profit/unit, multiplier: bankroll/unit, growth: (bankroll/unit-1)*100, cleanStreak: streak };
}

export function phaseAlertFlags(campaign){
  const flags = [];
  const picks = campaign.picks || [];
  const last = picks[picks.length - 1];
  if(!last) return flags;
  const phase = (campaign.phases || DEFAULT_PHASES).find(p => p.id === last.phase);
  if(phase){ if(last.odds < phase.minOdds) flags.push(`Cuota ${last.odds} por debajo del mínimo (${phase.minOdds})`); if(last.odds > phase.maxOdds) flags.push(`Cuota ${last.odds} por encima del máximo (${phase.maxOdds})`); }
  if(last.result === 'pending') flags.push('Pick pendiente — campaña bloqueada');
  if(last.result === 'void' && !campaign.allowVoidAdvance) flags.push('Void — mismo paso hasta resolver');
  if((last.narrativeScore||0) < 55) flags.push('Narrativa débil (< 55)');
  if(last.emotionalFlag) flags.push('⚠️ Pick emocional');
  if(last.marketConsistent === false) flags.push('Mercado inconsistente');
  if(campaign.status === 'failed') flags.push(`🔴 Fallida en ${last.phaseName} paso ${last.pickNumber}`);
  return flags;
}

export function buildPhasePostAnalysis(campaigns){
  const rows = Array.isArray(campaigns) ? campaigns : [];
  const failByPhase = {}, marketMap = new Map(), failPatterns = new Map();
  const winnerOdds = [];
  rows.forEach(camp => {
    if(camp.status === 'failed' && camp.failedAt){ const k = camp.failedAt.phaseName || 'FASE ?'; failByPhase[k] = (failByPhase[k]||0)+1; }
    (camp.picks||[]).forEach(pick => {
      if(pick.result === 'win') winnerOdds.push(safeNum(pick.odds));
      const key = pick.market||'Sin mercado';
      const slot = marketMap.get(key)||{market:key,wins:0,picks:0};
      slot.picks++; if(pick.result==='win') slot.wins++; marketMap.set(key,slot);
      if(pick.result==='loss'){ const r=[]; if((pick.narrativeScore||0)<55) r.push('Narrativa débil'); if(pick.emotionalFlag) r.push('Emocional'); if(pick.marketConsistent===false) r.push('Mercado inconsistente'); if(!r.length) r.push('Sin patrón'); r.forEach(x=>failPatterns.set(x,(failPatterns.get(x)||0)+1)); }
    });
  });
  const topMarket = Array.from(marketMap.values()).map(r=>({...r,wr:r.picks?r.wins/r.picks:0})).sort((a,b)=>b.wr-a.wr).slice(0,3);
  const topFails = Array.from(failPatterns.entries()).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const avgWinnerOdds = winnerOdds.length ? winnerOdds.reduce((s,v)=>s+v,0)/winnerOdds.length : 0;
  const completed = rows.filter(c=>c.status==='completed').length;
  const failed = rows.filter(c=>c.status==='failed').length;
  return { failByPhase, avgWinnerOdds, topMarket, topFails, totalCampaigns: rows.length, completed, failed, completionRate: rows.length ? (completed/rows.length)*100 : null, totalProfit: Number(rows.reduce((s,c)=>s+safeNum(c.netProfit),0).toFixed(2)) };
}

export function simulateFullCampaign(unit = 25, phases = DEFAULT_PHASES, defaultOdds = 1.44){
  const steps = buildSteps(phases);
  let bankroll = unit;
  const rows = [];
  for(const step of steps){
    const stake = bankroll, gross = stake * defaultOdds, gain = gross - stake, net = gross - unit, pct = (gross/unit-1)*100;
    rows.push({ step: step.order, phase: step.phaseName, pickNum: step.pickNumber, stake: Number(stake.toFixed(2)), odds: defaultOdds, gross: Number(gross.toFixed(2)), gain: Number(gain.toFixed(2)), net: Number(net.toFixed(2)), pct: Number(pct.toFixed(0)) });
    bankroll = gross;
  }
  return { unit, finalBankroll: Number(bankroll.toFixed(2)), totalProfit: Number((bankroll-unit).toFixed(2)), totalPct: Number(((bankroll/unit-1)*100).toFixed(0)), rows };
}

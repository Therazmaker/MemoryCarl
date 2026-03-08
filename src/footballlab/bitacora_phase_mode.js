const DEFAULT_PHASES = [
  { id: 1, name: "FASE 1", picks: 2, minOdds: 1.35, maxOdds: 1.45 },
  { id: 2, name: "FASE 2", picks: 4, minOdds: 1.35, maxOdds: 1.45 },
  { id: 3, name: "FASE 3", picks: 4, minOdds: 1.35, maxOdds: 1.45 }
];

export function ensurePhaseModeState(raw){
  const base = {
    config: { phases: DEFAULT_PHASES },
    campaigns: [],
    selectedCampaignId: ""
  };
  const st = { ...base, ...(raw || {}) };
  const sourcePhases = Array.isArray(st.config?.phases) && st.config.phases.length
    ? st.config.phases
    : DEFAULT_PHASES;
  st.config = {
    phases: sourcePhases.map((phase, idx)=>({
      id: idx + 1,
      name: String(phase?.name || `FASE ${idx+1}`),
      picks: Math.max(1, Number(phase?.picks) || 1),
      minOdds: Math.max(1.01, Number(phase?.minOdds) || 1.35),
      maxOdds: Math.max(1.01, Number(phase?.maxOdds) || 1.45)
    }))
  };
  st.campaigns = Array.isArray(st.campaigns) ? st.campaigns.map(c=>ensurePhaseCampaign(c, st.config.phases)) : [];
  st.selectedCampaignId = String(st.selectedCampaignId || "");
  return st;
}

export function ensurePhaseCampaign(raw, phases = DEFAULT_PHASES){
  const firstPhase = phases[0] || DEFAULT_PHASES[0];
  const startUnit = Math.max(0.5, Number(raw?.initialUnit) || 1);
  const picks = Array.isArray(raw?.picks) ? raw.picks.map(p=>ensurePhasePick(p)) : [];
  const camp = {
    id: String(raw?.id || `phase_${Date.now()}`),
    startDate: String(raw?.startDate || new Date().toISOString()),
    initialUnit: startUnit,
    bankroll: startUnit,
    currentPhase: 1,
    currentPick: 1,
    status: raw?.status === "failed" || raw?.status === "completed" ? raw.status : "active",
    picks,
    phases: phases.map(p=>({ ...p }))
  };
  return recomputePhaseCampaign(camp);
}

function ensurePhasePick(raw){
  return {
    id: String(raw?.id || `pp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`),
    date: String(raw?.date || new Date().toISOString()),
    league: String(raw?.league || "Sin liga"),
    match: String(raw?.match || "Partido sin definir"),
    market: String(raw?.market || "Mercado"),
    selection: String(raw?.selection || "Selección"),
    odds: Math.max(1.01, Number(raw?.odds) || 1.01),
    autoStake: Math.max(0, Number(raw?.autoStake) || 0),
    manualStake: raw?.manualStake == null ? null : Math.max(0, Number(raw.manualStake) || 0),
    result: ["win","loss"].includes(raw?.result) ? raw.result : "loss",
    profit: Number(raw?.profit) || 0,
    bankrollAfter: Math.max(0, Number(raw?.bankrollAfter) || 0),
    notes: String(raw?.notes || ""),
    phase: Math.max(1, Number(raw?.phase) || 1),
    pickNumber: Math.max(1, Number(raw?.pickNumber) || 1),
    narrativeScore: Math.max(0, Math.min(100, Number(raw?.narrativeScore) || 0)),
    emotionalFlag: !!raw?.emotionalFlag,
    marketConsistent: raw?.marketConsistent !== false
  };
}

export function recomputePhaseCampaign(campaign){
  const camp = { ...campaign, phases: (campaign.phases || DEFAULT_PHASES).map(p=>({ ...p })) };
  let bankroll = Math.max(0.5, Number(camp.initialUnit) || 1);
  let status = "active";
  let phaseCursor = 1;
  let pickCursor = 1;
  camp.picks = (camp.picks || []).map((pickRaw)=>{
    const pick = ensurePhasePick(pickRaw);
    const phaseDef = camp.phases[pick.phase - 1] || camp.phases[camp.phases.length - 1] || DEFAULT_PHASES[0];
    pick.autoStake = bankroll;
    const usedStake = pick.manualStake != null ? pick.manualStake : pick.autoStake;
    if(pick.result === "win"){
      bankroll = usedStake * pick.odds;
      pick.profit = bankroll - usedStake;
      pick.bankrollAfter = bankroll;
    }else{
      bankroll = 0;
      pick.profit = -usedStake;
      pick.bankrollAfter = 0;
      status = "failed";
    }
    phaseCursor = pick.phase;
    pickCursor = pick.pickNumber + 1;
    if(pick.pickNumber >= phaseDef.picks){
      phaseCursor = pick.phase + 1;
      pickCursor = 1;
    }
    return pick;
  });
  const totalPhases = camp.phases.length;
  if(status === "active" && phaseCursor > totalPhases){
    status = "completed";
    phaseCursor = totalPhases;
    pickCursor = camp.phases[totalPhases - 1]?.picks || 1;
  }
  camp.bankroll = bankroll;
  camp.status = status;
  camp.currentPhase = Math.max(1, Math.min(totalPhases, phaseCursor));
  camp.currentPick = Math.max(1, pickCursor);
  return camp;
}

export function createPhaseCampaign({ initialUnit, phases }){
  return ensurePhaseCampaign({
    id: `phase_${Date.now()}`,
    startDate: new Date().toISOString(),
    initialUnit,
    picks: []
  }, phases);
}

export function calcPhaseMetrics(campaign){
  const initial = Math.max(0.01, Number(campaign.initialUnit) || 1);
  const bankroll = Math.max(0, Number(campaign.bankroll) || 0);
  const profit = bankroll - initial;
  const roi = profit / initial;
  const multiplier = bankroll / initial;
  const growth = (multiplier - 1) * 100;
  const impliedAcc = (campaign.picks || []).reduce((acc, pick)=>acc * (1 / Math.max(1.01, Number(pick.odds) || 1.01)), 1);
  let streak = 0;
  for(const pick of campaign.picks || []){
    if(pick.result === "win") streak += 1;
    else streak = 0;
  }
  return { profit, roi, multiplier, growth, impliedAcc, cleanStreak: streak };
}

export function phaseAlertFlags(campaign){
  const flags = [];
  const last = campaign.picks?.[campaign.picks.length - 1];
  if(!last) return flags;
  const phase = campaign.phases[last.phase - 1];
  if(phase && (last.odds < phase.minOdds || last.odds > phase.maxOdds)) flags.push("Cuota fuera del rango recomendado");
  if(last.manualStake != null && Math.abs(last.manualStake - last.autoStake) > 0.0001) flags.push("Stake manual alterado");
  if((last.narrativeScore || 0) < 55) flags.push("Narrativa débil");
  if(last.emotionalFlag) flags.push("Pick emocional");
  if(last.marketConsistent === false) flags.push("Mercado inconsistente");
  return flags;
}

export function buildPhasePostAnalysis(campaigns){
  const rows = Array.isArray(campaigns) ? campaigns : [];
  const failByPhase = {};
  const winnerOdds = [];
  const marketMap = new Map();
  const failPatterns = new Map();
  rows.forEach((camp)=>{
    if(camp.status === "failed"){
      const failedPick = (camp.picks || []).find(p=>p.result === "loss");
      if(failedPick) failByPhase[failedPick.phase] = (failByPhase[failedPick.phase] || 0) + 1;
    }
    (camp.picks || []).forEach((pick)=>{
      if(pick.result === "win") winnerOdds.push(Number(pick.odds) || 0);
      const key = pick.market || "Sin mercado";
      const slot = marketMap.get(key) || { market: key, wins: 0, picks: 0 };
      slot.picks += 1;
      if(pick.result === "win") slot.wins += 1;
      marketMap.set(key, slot);
      if(pick.result === "loss"){
        const reasons = [];
        if((pick.narrativeScore || 0) < 55) reasons.push("Narrativa débil");
        if(pick.emotionalFlag) reasons.push("Emocional");
        if(pick.marketConsistent === false) reasons.push("Mercado inconsistente");
        if(!reasons.length) reasons.push("Sin patrón etiquetado");
        reasons.forEach((reason)=>failPatterns.set(reason, (failPatterns.get(reason) || 0) + 1));
      }
    });
  });
  const topMarket = Array.from(marketMap.values())
    .map((row)=>({ ...row, wr: row.picks ? row.wins / row.picks : 0 }))
    .sort((a,b)=>b.wr-a.wr)
    .slice(0,3);
  const topFails = Array.from(failPatterns.entries()).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const avgWinnerOdds = winnerOdds.length ? winnerOdds.reduce((s,v)=>s+v,0)/winnerOdds.length : 0;
  return { failByPhase, avgWinnerOdds, topMarket, topFails };
}

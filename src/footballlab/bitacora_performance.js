function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

function parseDate(value){
  if(!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function computePickCLV({ oddsTaken, closingOdds }){
  const taken = toNumber(oddsTaken);
  const close = toNumber(closingOdds);
  if(!(taken > 1) || !(close > 1)) return null;
  const impliedTaken = 1 / taken;
  const impliedClose = 1 / close;
  return {
    clvDelta: impliedClose - impliedTaken,
    oddsDelta: taken - close,
    impliedTaken,
    impliedClose
  };
}

export function normalizePickRecord(row = {}, index = 0){
  const stake = Math.max(0, toNumber(row.stake) ?? 0);
  const odds = Math.max(1.01, toNumber(row.odds) ?? 1.01);
  const resultRaw = String(row.result || row.settlementResult || '').toLowerCase();
  const result = ["win", "loss", "push"].includes(resultRaw) ? resultRaw : "push";
  const resultNormalized = result === "win" ? 1 : (result === "loss" ? -1 : 0);
  const probability = clamp(toNumber(row.probability) ?? 0.5, 0.01, 0.99);
  const roiContribution = stake > 0 ? (result === "win" ? (odds - 1) : (result === "loss" ? -1 : 0)) : null;
  const profit = toNumber(row.profit) ?? (result === "win" ? stake * (odds - 1) : (result === "loss" ? -stake : 0));
  const evValue = toNumber(row.evValue ?? row.ev);
  const confidence = toNumber(row.confidence);
  const clv = computePickCLV({ oddsTaken: odds, closingOdds: row.closingOdds });
  const dateObj = parseDate(row.date);
  return {
    id: row.id || `legacy_${index}`,
    date: row.date || "",
    dateObj,
    stake,
    odds,
    closingOdds: toNumber(row.closingOdds),
    impliedCloseProb: clv?.impliedClose ?? null,
    result,
    resultNormalized,
    probability,
    pickType: row.pickType || row.type || "N/A",
    league: row.league || row.liga || "Sin liga",
    tag: row.tag || row.label || "Sin etiqueta",
    confidence: confidence !== null ? clamp(confidence, 0, 1) : null,
    profit,
    evValue,
    roiContribution,
    clvDelta: clv?.clvDelta ?? null,
    clvOddsDelta: clv?.oddsDelta ?? null
  };
}

function computeAggregate(records = []){
  const settled = records.filter((r)=>["win", "loss", "push"].includes(r.result));
  const picks = settled.length;
  const wins = settled.filter((r)=>r.result === "win").length;
  const winRate = picks ? wins / picks : 0;
  const stakeTotal = settled.reduce((acc, r)=>acc + r.stake, 0);
  const profitTotal = settled.reduce((acc, r)=>acc + r.profit, 0);
  const roi = stakeTotal > 0 ? profitTotal / stakeTotal : null;
  const yieldPct = roi;
  const evRows = settled.filter((r)=>typeof r.evValue === 'number');
  const evCumulative = evRows.reduce((acc, r)=>acc + (r.evValue * r.stake), 0);
  const clvRows = settled.filter((r)=>typeof r.clvDelta === 'number');
  const clvAverage = clvRows.length ? clvRows.reduce((acc, r)=>acc + r.clvDelta, 0) / clvRows.length : null;
  return {
    picks,
    wins,
    winRate,
    stakeTotal,
    profitTotal,
    roi,
    yieldPct,
    evCumulative,
    clvAverage,
    clvCount: clvRows.length,
    evCount: evRows.length
  };
}

export function computeRollingMetrics(records = [], { windowSize = 20 } = {}){
  const settled = records.filter((r)=>["win", "loss", "push"].includes(r.result));
  if(!settled.length) return [];
  return settled.map((_, idx)=>{
    const from = Math.max(0, idx - windowSize + 1);
    const window = settled.slice(from, idx + 1);
    const agg = computeAggregate(window);
    return {
      index: idx,
      label: window[window.length - 1]?.date?.slice(5, 10) || `#${idx + 1}`,
      roi: agg.roi,
      winRate: agg.winRate,
      clv: agg.clvAverage
    };
  });
}

function oddsBucket(odds = 0){
  if(odds < 1.6) return "<1.60";
  if(odds < 2.0) return "1.60-1.99";
  if(odds < 2.5) return "2.00-2.49";
  return "2.50+";
}

function confidenceBucket(confidence = null){
  if(typeof confidence !== 'number') return "N/A";
  if(confidence >= 0.75) return "Alta";
  if(confidence >= 0.55) return "Media";
  return "Baja";
}

function buildBreakdownRows(records = [], grouper = ()=>"N/A"){
  const map = new Map();
  records.forEach((row)=>{
    const key = grouper(row) || "N/A";
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return [...map.entries()].map(([key, items])=>{
    const agg = computeAggregate(items);
    return {
      key,
      picks: agg.picks,
      winRate: agg.winRate,
      roi: agg.roi,
      clv: agg.clvAverage
    };
  }).sort((a,b)=>b.picks - a.picks);
}

export function buildPerformanceBreakdowns(records = []){
  return {
    byType: buildBreakdownRows(records, (r)=>r.pickType),
    byOdds: buildBreakdownRows(records, (r)=>oddsBucket(r.odds)),
    byLeague: buildBreakdownRows(records, (r)=>r.league),
    byTag: buildBreakdownRows(records, (r)=>r.tag),
    byConfidence: buildBreakdownRows(records, (r)=>confidenceBucket(r.confidence))
  };
}

export function buildPerformanceInsights({ global, breakdowns, rolling = [] }){
  const insights = [];
  if(typeof global.clvAverage === 'number' && global.clvAverage > 0 && typeof global.roi === 'number' && global.roi < 0){
    insights.push('CLV positivo pero ROI negativo: posible varianza adversa.');
  }
  const bestType = (breakdowns.byType || []).filter((r)=>r.picks >= 3 && typeof r.roi === 'number').sort((a,b)=>b.roi-a.roi)[0];
  if(bestType){
    insights.push(`Mejor rendimiento por tipo: ${bestType.key} (ROI ${(bestType.roi*100).toFixed(1)}%).`);
  }
  const bestTag = (breakdowns.byTag || []).filter((r)=>r.picks >= 3 && typeof r.roi === 'number').sort((a,b)=>b.roi-a.roi)[0];
  if(bestTag && bestTag.key !== 'Sin etiqueta'){
    insights.push(`Etiqueta más fuerte: ${bestTag.key} (${bestTag.picks} picks).`);
  }
  const bestOdds = (breakdowns.byOdds || []).filter((r)=>r.picks >= 3 && typeof r.roi === 'number').sort((a,b)=>b.roi-a.roi)[0];
  if(bestOdds){
    insights.push(`Mejor franja de cuota: ${bestOdds.key}.`);
  }
  if(rolling.length >= 10){
    const last = rolling[rolling.length - 1];
    const prev = rolling[Math.max(0, rolling.length - 6)];
    if(typeof last.roi === 'number' && typeof prev.roi === 'number'){
      insights.push(last.roi >= prev.roi
        ? 'El ROI rolling mejora en la última ventana.'
        : 'El ROI rolling cae en la última ventana; revisar selección reciente.');
    }
  }
  return insights.slice(0, 6);
}

export function computePortfolioMetrics(records = [], { lastDays = 7, lastPicks = 30 } = {}){
  const sorted = [...records].sort((a,b)=>{
    const ta = a.dateObj?.getTime() || 0;
    const tb = b.dateObj?.getTime() || 0;
    return ta - tb;
  });
  const global = computeAggregate(sorted);
  const now = Date.now();
  const recentDays = sorted.filter((r)=>{
    const ts = r.dateObj?.getTime();
    return Number.isFinite(ts) ? (now - ts) <= lastDays*86400000 : false;
  });
  const lastByCount = sorted.slice(-lastPicks);
  return {
    global,
    last7d: computeAggregate(recentDays),
    last30: computeAggregate(lastByCount),
    records: sorted
  };
}

export function buildBitacoraPerformanceLab(entries = [], { rollingWindow = 20 } = {}){
  const normalized = entries.map((row, idx)=>normalizePickRecord(row, idx));
  const portfolio = computePortfolioMetrics(normalized);
  const rolling = computeRollingMetrics(portfolio.records, { windowSize: rollingWindow });
  const breakdowns = buildPerformanceBreakdowns(portfolio.records);
  const insights = buildPerformanceInsights({ global: portfolio.global, breakdowns, rolling });

  let equity = 0;
  let ev = 0;
  const charts = portfolio.records.map((row, idx)=>{
    equity += row.profit;
    if(typeof row.evValue === 'number') ev += row.evValue * row.stake;
    return {
      label: row.date ? row.date.slice(5, 10) : `#${idx + 1}`,
      equity,
      ev,
      clv: row.clvDelta,
      rollingRoi: rolling[idx]?.roi ?? null
    };
  });

  return {
    normalized,
    portfolio,
    rolling,
    breakdowns,
    insights,
    charts
  };
}

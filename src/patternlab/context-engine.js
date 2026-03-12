const CONTEXT_LABELS = [
  { min: 85, label: 'Strong' },
  { min: 70, label: 'Favorable' },
  { min: 55, label: 'Neutral' },
  { min: 40, label: 'Weak' },
  { min: 0, label: 'Poor' }
];

const SEMAPHORE_BY_LABEL = {
  Strong: '🟢 Vale',
  Favorable: '🟢 Vale',
  Neutral: '🟡 Meh',
  Weak: '🔴 No vale',
  Poor: '🔴 No vale'
};

function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

function num(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(value){
  return Array.isArray(value) ? value : [];
}

function toCandleMetrics(candles = []){
  if(!candles.length) return null;
  const deltas = [];
  const ranges = [];
  let wickHeavy = 0;
  for(const c of candles){
    const open = num(c.open, num(c.o));
    const close = num(c.close, num(c.c));
    const high = num(c.high, num(c.h));
    const low = num(c.low, num(c.l));
    const body = Math.abs(close - open);
    const range = Math.max(0.00001, high - low);
    deltas.push(close - open);
    ranges.push(range);
    if((range - body) / range > 0.62) wickHeavy += 1;
  }
  const avgRange = ranges.reduce((a, b)=>a + b, 0) / ranges.length;
  const lastRange = ranges[ranges.length - 1];
  const drift = deltas.reduce((a, b)=>a + b, 0);
  const directionConsistency = Math.abs(deltas.filter((d)=>d >= 0).length / deltas.length - 0.5) * 2;
  return {
    avgRange,
    lastRange,
    expansionRatio: avgRange > 0 ? lastRange / avgRange : 1,
    drift,
    directionConsistency,
    wickRatio: wickHeavy / candles.length
  };
}

export function computeSessionProfile(session = {}, surroundingCandles = []){
  const candles = asArray(session.candles).length ? asArray(session.candles) : asArray(surroundingCandles);
  const metrics = toCandleMetrics(candles);

  if(!metrics){
    return {
      label: 'Mixed Session',
      confidence: 'low',
      explanation: 'Session profile tentative: limited OHLC/session candles available.',
      tags: ['limited-data']
    };
  }

  const { expansionRatio, directionConsistency, wickRatio, drift } = metrics;
  const absDrift = Math.abs(drift);
  const trendSignal = directionConsistency > 0.65 && absDrift > (metrics.avgRange * 1.8);
  const sidewaysSignal = directionConsistency < 0.35 && wickRatio > 0.4;
  const compressionSignal = expansionRatio < 0.8 && absDrift < (metrics.avgRange * 1.2);
  const recoverySignal = absDrift > (metrics.avgRange * 1.3) && directionConsistency > 0.5 && wickRatio < 0.45;
  const exhaustionSignal = expansionRatio > 1.6 && wickRatio > 0.5;

  let label = 'Mixed Session';
  let explanation = 'Flujo mixto sin una dominancia estructural clara.';
  let confidence = 'medium';

  if(trendSignal){
    label = 'Trend Session';
    explanation = 'Continuidad direccional y desplazamiento consistente.';
    confidence = directionConsistency > 0.8 ? 'high' : 'medium';
  }else if(recoverySignal){
    label = 'Recovery Session';
    explanation = 'Recuperación ordenada tras presión inicial, con intención limpia.';
    confidence = 'medium';
  }else if(sidewaysSignal){
    label = 'Sideways Noise';
    explanation = 'Lateralidad con mechas frecuentes y continuidad pobre.';
    confidence = wickRatio > 0.55 ? 'high' : 'medium';
  }else if(compressionSignal){
    label = 'Compression Session';
    explanation = 'Compresión de rango y expansión limitada.';
    confidence = 'medium';
  }else if(exhaustionSignal){
    label = 'Exhaustion Risk';
    explanation = 'Movimiento extendido con señales de agotamiento y rechazo.';
    confidence = 'medium';
  }

  return { label, confidence, explanation, tags: [label.toLowerCase().replace(/\s+/g, '-')] };
}

function computeHistoricalContextStats(stats = {}, contextKey = 'default'){
  const scoped = stats.contexts?.[contextKey] || stats.byBucket?.[contextKey] || null;
  if(scoped){
    return {
      sample: num(scoped.sample, num(scoped.n, 0)),
      winRate: num(scoped.winRate, num(scoped.wins, 0) / Math.max(1, num(scoped.sample, num(scoped.n, 1)))),
      avgMfe: num(scoped.avgMfe, num(scoped.mfe, 0)),
      avgMae: Math.abs(num(scoped.avgMae, num(scoped.mae, 0)))
    };
  }
  return {
    sample: num(stats.sample, 0),
    winRate: num(stats.winRate, 0),
    avgMfe: num(stats.avgMfe, 0),
    avgMae: Math.abs(num(stats.avgMae, 0))
  };
}

function getSignalDirection(signal = {}){
  const raw = String(signal.side || signal.direction || signal.type || '').toLowerCase();
  if(raw.includes('short') || raw.includes('sell') || raw.includes('bear')) return 'short';
  if(raw.includes('long') || raw.includes('buy') || raw.includes('bull')) return 'long';
  return 'unknown';
}

export function computeContextBucket(signal = {}, session = {}, sessionProfile = null){
  const profile = sessionProfile || computeSessionProfile(session);
  const hasNearSupport = Boolean(signal.nearSupport || signal.context?.nearSupport || session.nearSupport);
  const hasNearResistance = Boolean(signal.nearResistance || signal.context?.nearResistance || session.nearResistance);
  const reclaimQuality = num(signal.reclaimQuality, signal.analyticalRead?.reclaimQuality);
  const expansion = num(signal.expansionScore, session.expansionScore);

  const base = reclaimQuality >= 0.6 ? 'reclaim' : reclaimQuality > 0.25 ? 'weak reclaim' : 'no reclaim';
  const sr = hasNearSupport || hasNearResistance ? 'with S/R confluence' : 'no S/R';
  const profileSlug = profile.label.toLowerCase();

  if(profileSlug.includes('sideways') && expansion < 0.45) return `${base} + sideways noise`;
  if(profileSlug.includes('trend')) return `${base} + favorable session`;
  if(profileSlug.includes('recovery') && hasNearSupport) return `near support + recovery structure`;
  if(profileSlug.includes('mixed') && reclaimQuality < 0.6) return `weak reclaim + mixed structure`;
  if(expansion < 0.35) return `${sr} + low expansion`;
  return `${base} + ${profile.label}`;
}

export function getContextLabel(score = 0){
  const safeScore = clamp(num(score, 0), 0, 100);
  const found = CONTEXT_LABELS.find((entry)=>safeScore >= entry.min);
  return found ? found.label : 'Poor';
}

export function getContextReasoning({
  structure = {},
  sessionProfile = {},
  confirmation = {},
  historical = {},
  confidence = 'medium'
} = {}){
  const reasons = [];

  if(structure.sidewaysNoise) reasons.push('La sesión muestra lateralidad y mechas frecuentes.');
  if(structure.lowExpansion) reasons.push('No hay expansión clara en la estructura reciente.');
  if(confirmation.reclaimLate) reasons.push('El reclaim existe pero llega tarde respecto al impulso inicial.');
  if(confirmation.clearRead) reasons.push('La lectura analítica es clara y alineada con la señal registrada.');
  if(structure.srConfluence) reasons.push('Confluencia S/R presente cerca del gatillo de señal.');
  if(historical.sample > 0 && historical.avgMfe > historical.avgMae) reasons.push('Históricamente este contexto presenta mejor MFE que MAE.');
  if(historical.sample > 0 && historical.sample < 15) reasons.push('Low sample context: lectura histórica aún frágil.');
  if(historical.sample === 0) reasons.push('Limited context available: aún no hay muestra histórica para este bucket.');
  if(confidence === 'low') reasons.push('Session profile tentative por datos incompletos.');

  return reasons.length ? reasons : ['Contexto mixto sin ventaja estadística clara.'];
}

export function computeSignalContextScore(signal = {}, session = {}, surroundingCandles = [], stats = {}){
  const sessionProfile = computeSessionProfile(session, surroundingCandles);
  const direction = getSignalDirection(signal);

  const structureContinuity = clamp(num(signal.structure?.continuity, signal.analyticalRead?.continuity), 0, 1);
  const structureCompression = clamp(num(signal.structure?.compression, signal.analyticalRead?.compression), 0, 1);
  const structureExpansion = clamp(num(signal.structure?.expansion, signal.expansionScore), 0, 1);
  const structureNoise = clamp(num(signal.structure?.noise, signal.analyticalRead?.noise), 0, 1);

  const nearSupport = Boolean(signal.nearSupport || signal.context?.nearSupport || session.nearSupport);
  const nearResistance = Boolean(signal.nearResistance || signal.context?.nearResistance || session.nearResistance);
  const srConfluence = nearSupport || nearResistance;

  const readClarity = clamp(num(signal.analyticalRead?.clarity, signal.analyticalReadScore), 0, 1);
  const reclaimQuality = clamp(num(signal.reclaimQuality, signal.analyticalRead?.reclaimQuality), 0, 1);
  const signalAlignment = clamp(num(signal.recordedAlignment, signal.analyticalRead?.alignment), 0, 1);

  const bucket = computeContextBucket(signal, session, sessionProfile);
  const historical = computeHistoricalContextStats(stats, bucket);

  let score = 50;

  // A) estructura reciente
  score += (structureContinuity - 0.5) * 22;
  score += (structureExpansion - 0.5) * 18;
  score -= structureNoise * 14;
  score += (0.5 - structureCompression) * 6;

  // B) calidad de sesión
  if(sessionProfile.label === 'Trend Session') score += 9;
  if(sessionProfile.label === 'Recovery Session') score += 7;
  if(sessionProfile.label === 'Sideways Noise') score -= 12;
  if(sessionProfile.label === 'Compression Session') score -= 5;
  if(sessionProfile.label === 'Exhaustion Risk') score -= 8;

  // C) soporte/resistencia con dirección
  if(srConfluence) score += 5;
  if(direction === 'long' && nearResistance && !nearSupport) score -= 4;
  if(direction === 'short' && nearSupport && !nearResistance) score -= 4;

  // D) comportamiento histórico
  if(historical.sample >= 8){
    score += clamp((historical.winRate - 0.5) * 24, -10, 10);
    score += clamp((historical.avgMfe - historical.avgMae) * 8, -8, 8);
  }

  // E) confirmación
  score += (readClarity - 0.5) * 10;
  score += (reclaimQuality - 0.5) * 12;
  score += (signalAlignment - 0.5) * 10;

  // penalización por datos incompletos (sin inventar confianza)
  let missingPenalty = 0;
  if(!session || Object.keys(session).length === 0) missingPenalty += 6;
  if(!asArray(surroundingCandles).length && !asArray(session.candles).length) missingPenalty += 7;
  if(!signal.analyticalRead && !signal.analyticalReadScore) missingPenalty += 5;
  if(historical.sample === 0) missingPenalty += 4;
  score -= missingPenalty;

  const finalScore = Math.round(clamp(score, 0, 100));
  const label = getContextLabel(finalScore);
  const semaphore = SEMAPHORE_BY_LABEL[label] || '🟡 Meh';

  const why = getContextReasoning({
    structure: {
      sidewaysNoise: sessionProfile.label === 'Sideways Noise' || structureNoise > 0.6,
      lowExpansion: structureExpansion < 0.45,
      srConfluence
    },
    sessionProfile,
    confirmation: {
      reclaimLate: reclaimQuality > 0.2 && reclaimQuality < 0.5,
      clearRead: readClarity > 0.65 && signalAlignment > 0.55
    },
    historical,
    confidence: sessionProfile.confidence
  });

  const confidence = missingPenalty >= 12 ? 'low' : missingPenalty >= 6 ? 'medium' : 'high';
  const caution = [];
  if(missingPenalty >= 6) caution.push('Limited context available');
  if(historical.sample > 0 && historical.sample < 15) caution.push('Low sample context');
  if(sessionProfile.confidence === 'low') caution.push('Session profile tentative');

  return {
    score: finalScore,
    label,
    semaphore,
    confidence,
    sessionProfile,
    bucket,
    why,
    caution,
    historical: {
      ...historical,
      hasEnoughSample: historical.sample >= 15
    }
  };
}

export function buildContextDashboard(signals = [], sessionsById = {}, stats = {}){
  const rows = asArray(signals).map((signal)=>{
    const session = signal.sessionId ? (sessionsById[signal.sessionId] || {}) : {};
    const candles = asArray(signal.surroundingCandles);
    const context = computeSignalContextScore(signal, session, candles, stats);
    return { signal, context };
  });

  function groupBy(keyFn){
    const map = new Map();
    for(const row of rows){
      const key = keyFn(row);
      const bucket = map.get(key) || [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return map;
  }

  function summarize(map){
    return [...map.entries()].map(([name, list])=>{
      const wins = list.filter((r)=>String(r.signal.review || '').toLowerCase() === 'win').length;
      const mfes = list.map((r)=>num(r.signal.mfe, NaN)).filter(Number.isFinite);
      const maes = list.map((r)=>Math.abs(num(r.signal.mae, NaN))).filter(Number.isFinite);
      return {
        name,
        count: list.length,
        winRate: list.length ? wins / list.length : 0,
        avgMfe: mfes.length ? mfes.reduce((a, b)=>a + b, 0) / mfes.length : 0,
        avgMae: maes.length ? maes.reduce((a, b)=>a + b, 0) / maes.length : 0
      };
    }).sort((a, b)=>b.count - a.count);
  }

  const byLabel = summarize(groupBy((r)=>r.context.label));
  const bySessionProfile = summarize(groupBy((r)=>r.context.sessionProfile.label));
  const byBucket = summarize(groupBy((r)=>r.context.bucket));

  const topGoodContexts = [...byBucket].sort((a, b)=>b.winRate - a.winRate).slice(0, 5);
  const topBadContexts = [...byBucket].sort((a, b)=>a.winRate - b.winRate).slice(0, 5);

  return {
    hasSample: rows.length >= 5,
    sampleSize: rows.length,
    byLabel,
    bySessionProfile,
    byBucket,
    topGoodContexts,
    topBadContexts,
    emptyState: rows.length < 5 ? 'Aún no hay suficiente muestra para analytics V4 robustos.' : ''
  };
}

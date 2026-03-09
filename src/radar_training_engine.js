/**
 * RADAR TRAINING ENGINE
 * Sistema de entrenamiento independiente del Radar del Día.
 *
 * Flow completo:
 *   1. Importar JSON de predicción IA (radar_ai_prediction_v2)
 *   2. Agregar contexto manual (cosas que el sistema no ve)
 *   3. Registrar resultado real (score, mercados)
 *   4. El engine calcula precisión por mercado y ajusta pesos de señales
 */

const RADAR_TRAINING_VERSION = 'radar_training_v1';
const SCHEMA_AI_PRED        = 'radar_ai_prediction_v2';
const SCHEMA_TRAINING_KEY   = 'FL_RADAR_TRAINING';

// ─── Utilidades ──────────────────────────────────────────────────────────────

function clamp(v, min = 0, max = 1){ return Math.max(min, Math.min(max, Number(v) || 0)); }
function safeNum(v, fb = 0){ const n = Number(v); return Number.isFinite(n) ? n : fb; }
function safeStr(v, fb = ''){ return String(v ?? fb).trim(); }
function toArr(v){ return Array.isArray(v) ? v : []; }
function now(){ return new Date().toISOString(); }
function uid(prefix = 'rt'){ return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }

// ─── Mercados reconocidos ─────────────────────────────────────────────────────
const MARKET_KEYS = ['result','btts','over15','over25','cleanSheet','htCleanSheet','htResult'];

// ─── Señales del sistema que queremos aprender a ponderar ────────────────────
const SIGNAL_KEYS = [
  'FAVORITE_LOW_PRESSURE',
  'UNDERDOG_SOLID_DEFENSE',
  'HIGH_DRAW_SIGNAL',
  'HT_CLEAN_SHEET_LIKELY',
  'HIGH_FSI_HOME',
  'HIGH_FSI_AWAY',
  'BALANCED_STRENGTH',
  'STRONG_FAVORITE_UNSTABLE',
  'MARKET_BLIND_DEFENSE',
  'FAVORITE_NOT_PROVEN'
];

// ─── Pesos iniciales de señales (aprenden con el tiempo) ─────────────────────
function defaultSignalWeights(){
  return SIGNAL_KEYS.reduce((acc, k) => {
    acc[k] = { n: 0, hits: 0, weight: 0.5, lastUpdated: null };
    return acc;
  }, {});
}

// ─── Pesos iniciales de mercados ──────────────────────────────────────────────
function defaultMarketWeights(){
  return MARKET_KEYS.reduce((acc, k) => {
    acc[k] = { n: 0, hits: 0, accuracy: null, calibration: 0 };
    return acc;
  }, {});
}

// ─── Estado de entrenamiento vacío ───────────────────────────────────────────
export function defaultTrainingState(){
  return {
    schemaVersion: RADAR_TRAINING_VERSION,
    createdAt: now(),
    updatedAt: now(),
    records: [],           // Historial de entradas de entrenamiento
    signalWeights: defaultSignalWeights(),
    marketWeights: defaultMarketWeights(),
    globalMetrics: {
      totalRecords: 0,
      resolvedRecords: 0,
      overallAccuracy: null,
      lastRecomputed: null
    },
    manualRules: []        // Reglas que el usuario puede escribir a mano
  };
}

// ─── Normalizar y cargar estado desde localStorage ───────────────────────────
export function loadTrainingState(rawJson){
  const parsed = rawJson && typeof rawJson === 'object' ? rawJson : {};
  return {
    schemaVersion: RADAR_TRAINING_VERSION,
    createdAt: safeStr(parsed.createdAt || now()),
    updatedAt: safeStr(parsed.updatedAt || now()),
    records: toArr(parsed.records),
    signalWeights: { ...defaultSignalWeights(), ...(parsed.signalWeights || {}) },
    marketWeights: { ...defaultMarketWeights(), ...(parsed.marketWeights || {}) },
    globalMetrics: {
      totalRecords: safeNum(parsed.globalMetrics?.totalRecords, 0),
      resolvedRecords: safeNum(parsed.globalMetrics?.resolvedRecords, 0),
      overallAccuracy: parsed.globalMetrics?.overallAccuracy ?? null,
      lastRecomputed: parsed.globalMetrics?.lastRecomputed ?? null
    },
    manualRules: toArr(parsed.manualRules)
  };
}

// ─── Parsear el JSON de predicción IA ────────────────────────────────────────
export function parseAIPredictionJSON(rawText){
  const errors = [];

  let parsed;
  try {
    const clean = String(rawText || '').replace(/```json|```/gi, '').trim();
    parsed = JSON.parse(clean);
  } catch(e) {
    errors.push(`JSON inválido: ${e.message}`);
    return { ok: false, errors, data: null };
  }

  if(!parsed || typeof parsed !== 'object'){
    errors.push('El JSON no es un objeto válido.');
    return { ok: false, errors, data: null };
  }

  // Soportar tanto el schema de export completo como la respuesta directa de predicción
  let predPayload = parsed;
  if(parsed.schemaVersion === 'radar_day_export_v2' && parsed.prompt){
    // Es el export completo — no lo que queremos aquí
    errors.push('Este es el JSON de Export. Necesitas pegar la RESPUESTA de la IA (el JSON con "predictions").');
    return { ok: false, errors, data: null };
  }

  const preds = toArr(predPayload.predictions);
  if(!preds.length){
    errors.push('El JSON no contiene "predictions". Asegúrate de pegar la respuesta de la IA.');
    return { ok: false, errors, data: null };
  }

  const normalizedPreds = preds.map(p => ({
    matchId:       safeStr(p.matchId || p.match_id || ''),
    home:          safeStr(p.home || ''),
    away:          safeStr(p.away || ''),
    confidence:    clamp(safeNum(p.confidence, 0.5)),
    incongruencias: toArr(p.incongruencias),
    markets:       normalizeMarkets(p.markets || {}),
    drawWarning:   safeStr(p.drawWarning || ''),
    valueAlert:    safeStr(p.valueAlert || ''),
    summary:       safeStr(p.summary || '')
  }));

  return {
    ok: true,
    errors: [],
    data: {
      schemaVersion: safeStr(predPayload.schemaVersion || SCHEMA_AI_PRED),
      generatedAt:   safeStr(predPayload.generatedAt || now()),
      predictions:   normalizedPreds,
      systemNotes:   safeStr(predPayload.systemNotes || '')
    }
  };
}

function normalizeMarkets(raw){
  const out = {};
  for(const key of MARKET_KEYS){
    const m = raw[key] || {};
    out[key] = {
      pick:       safeStr(m.pick || ''),
      confidence: clamp(safeNum(m.confidence, 0.5)),
      reasoning:  safeStr(m.reasoning || '')
    };
  }
  return out;
}

// ─── Crear un registro de entrenamiento ──────────────────────────────────────
/**
 * Combina: datos del partido del radar + predicción IA + notas manuales
 * El resultado real se agrega después con registerActualResult()
 */
export function createTrainingRecord({
  matchData,        // objeto del radar (buildRadarMatches output)
  aiPrediction,     // objeto de predicción de 1 partido (normalizado)
  manualNotes = '', // texto libre del usuario
  manualAdjustments = {} // ajustes manuales por mercado { result: 'draw', ... }
}){
  if(!matchData || !aiPrediction){
    return { ok: false, error: 'matchData y aiPrediction son requeridos.' };
  }

  return {
    ok: true,
    record: {
      id: uid('rtr'),
      createdAt: now(),
      updatedAt: now(),
      status: 'pending',  // pending | resolved

      // ── Datos del partido
      match: {
        id:          safeStr(matchData.id || matchData.match_id || ''),
        home:        safeStr(matchData.home || ''),
        away:        safeStr(matchData.away || ''),
        league:      safeStr(matchData.league || ''),
        kickoff:     safeStr(matchData.kickoff || ''),
        odds:        matchData.odds || {},
        studyScore:  safeNum(matchData.studyScore, 0),
        type:        safeStr(matchData.type || ''),
        flags:       toArr(matchData.flags),
        strengthHome: safeNum(matchData.strengthHome, 50),
        strengthAway: safeNum(matchData.strengthAway, 50),
        strengthGap:  safeNum(matchData.strengthGap, 0),
        fsiHome:      safeNum(matchData.fsiHome, 0),
        fsiAway:      safeNum(matchData.fsiAway, 0),
        favoritePressureIndex: matchData.favoritePressureIndex || null,
        underdogDefenseIndex:  matchData.underdogDefenseIndex  || null,
        drawIndex:             matchData.drawIndex             || null,
        htCleanSheetSignal:    matchData.htCleanSheetSignal    || null,
        dataWindow:            safeNum(matchData.dataWindow, 20)
      },

      // ── Predicción IA
      aiPrediction: {
        matchId:        safeStr(aiPrediction.matchId || ''),
        confidence:     clamp(safeNum(aiPrediction.confidence, 0.5)),
        incongruencias: toArr(aiPrediction.incongruencias),
        markets:        normalizeMarkets(aiPrediction.markets || {}),
        drawWarning:    safeStr(aiPrediction.drawWarning || ''),
        valueAlert:     safeStr(aiPrediction.valueAlert || ''),
        summary:        safeStr(aiPrediction.summary || '')
      },

      // ── Ajustes manuales (usuario puede sobreescribir picks)
      manualAdjustments: normalizeManualAdjustments(manualAdjustments),
      manualNotes: safeStr(manualNotes),

      // ── Resultado final (se llena después)
      actualResult: null,

      // ── Evaluación calculada (se llena al registrar resultado)
      evaluation: null
    }
  };
}

function normalizeManualAdjustments(raw){
  const out = {};
  for(const key of MARKET_KEYS){
    if(raw[key] !== undefined){
      out[key] = {
        pick:      safeStr(raw[key].pick || raw[key] || ''),
        reason:    safeStr(raw[key].reason || ''),
        overrides: true
      };
    }
  }
  return out;
}

// ─── Resultado real ───────────────────────────────────────────────────────────
/**
 * Registrar el resultado real de un partido
 * @param {object} record - El registro de entrenamiento
 * @param {object} result - {
 *   homeGoals: number,
 *   awayGoals: number,
 *   htHomeGoals: number,   (opcional)
 *   htAwayGoals: number,   (opcional)
 *   notes: string          (opcional — e.g. "expulsión min 35")
 * }
 */
export function registerActualResult(record, result){
  if(!record || !result) return { ok: false, error: 'record y result son requeridos.' };

  const hg = safeNum(result.homeGoals, -1);
  const ag = safeNum(result.awayGoals, -1);
  if(hg < 0 || ag < 0) return { ok: false, error: 'homeGoals y awayGoals son requeridos.' };

  const htHg = result.htHomeGoals !== undefined ? safeNum(result.htHomeGoals, -1) : null;
  const htAg = result.htAwayGoals !== undefined ? safeNum(result.htAwayGoals, -1) : null;

  const fullResult  = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
  const htResult    = (htHg !== null && htAg !== null)
    ? (htHg > htAg ? 'home' : htHg < htAg ? 'away' : 'draw')
    : null;
  const totalGoals  = hg + ag;
  const btts        = hg > 0 && ag > 0;
  const over15      = totalGoals >= 2;
  const over25      = totalGoals >= 3;
  const homeCS      = ag === 0;
  const awayCS      = hg === 0;
  const htTotalGoals = (htHg !== null && htAg !== null) ? htHg + htAg : null;
  const htCleanSheet = htTotalGoals !== null ? htTotalGoals === 0 : null;

  const actualResult = {
    homeGoals:     hg,
    awayGoals:     ag,
    htHomeGoals:   htHg,
    htAwayGoals:   htAg,
    result:        fullResult,
    htResult,
    totalGoals,
    btts,
    over15,
    over25,
    homeCS,
    awayCS,
    htCleanSheet,
    notes:         safeStr(result.notes || ''),
    registeredAt:  now()
  };

  // ── Evaluar mercados
  const evaluation = evaluateMarkets(record.aiPrediction, record.manualAdjustments, actualResult);

  return {
    ok: true,
    updatedRecord: {
      ...record,
      actualResult,
      evaluation,
      status: 'resolved',
      updatedAt: now()
    }
  };
}

// ─── Evaluar mercados ─────────────────────────────────────────────────────────
function evaluateMarkets(aiPrediction, manualAdjustments, actual){
  const markets = aiPrediction?.markets || {};
  const results = {};

  const getEffectivePick = (key) => {
    if(manualAdjustments?.[key]?.overrides) return manualAdjustments[key].pick;
    return markets[key]?.pick || '';
  };

  const getEffectiveConf = (key) => {
    return clamp(safeNum(markets[key]?.confidence, 0.5));
  };

  // result
  const rPick = getEffectivePick('result');
  results.result = {
    pick:       rPick,
    actual:     actual.result,
    hit:        rPick === actual.result,
    confidence: getEffectiveConf('result'),
    wasManual:  !!manualAdjustments?.result?.overrides
  };

  // btts
  const bttsPick = getEffectivePick('btts');
  const bttsActual = actual.btts ? 'yes' : 'no';
  results.btts = {
    pick:       bttsPick,
    actual:     bttsActual,
    hit:        bttsPick === bttsActual,
    confidence: getEffectiveConf('btts'),
    wasManual:  !!manualAdjustments?.btts?.overrides
  };

  // over15
  const o15pick = getEffectivePick('over15');
  const o15actual = actual.over15 ? 'yes' : 'no';
  results.over15 = {
    pick:       o15pick,
    actual:     o15actual,
    hit:        o15pick === o15actual,
    confidence: getEffectiveConf('over15'),
    wasManual:  !!manualAdjustments?.over15?.overrides
  };

  // over25
  const o25pick = getEffectivePick('over25');
  const o25actual = actual.over25 ? 'yes' : 'no';
  results.over25 = {
    pick:       o25pick,
    actual:     o25actual,
    hit:        o25pick === o25actual,
    confidence: getEffectiveConf('over25'),
    wasManual:  !!manualAdjustments?.over25?.overrides
  };

  // cleanSheet
  const csPick = getEffectivePick('cleanSheet');
  let csActual = 'none';
  if(actual.homeCS && actual.awayCS) csActual = 'both';
  else if(actual.homeCS) csActual = 'home';
  else if(actual.awayCS) csActual = 'away';
  results.cleanSheet = {
    pick:       csPick,
    actual:     csActual,
    hit:        csPick === csActual || (csPick === 'home' && actual.homeCS) || (csPick === 'away' && actual.awayCS),
    confidence: getEffectiveConf('cleanSheet'),
    wasManual:  !!manualAdjustments?.cleanSheet?.overrides
  };

  // htCleanSheet
  if(actual.htCleanSheet !== null){
    const htCSPick = getEffectivePick('htCleanSheet');
    const htCSActual = actual.htCleanSheet ? 'yes' : 'no';
    results.htCleanSheet = {
      pick:       htCSPick,
      actual:     htCSActual,
      hit:        htCSPick === htCSActual,
      confidence: getEffectiveConf('htCleanSheet'),
      wasManual:  !!manualAdjustments?.htCleanSheet?.overrides
    };
  }

  // htResult
  if(actual.htResult !== null){
    const htRPick = getEffectivePick('htResult');
    results.htResult = {
      pick:       htRPick,
      actual:     actual.htResult,
      hit:        htRPick === actual.htResult,
      confidence: getEffectiveConf('htResult'),
      wasManual:  !!manualAdjustments?.htResult?.overrides
    };
  }

  // ── Score general del partido
  const evaluated = Object.values(results).filter(r => r.pick && r.actual);
  const hits = evaluated.filter(r => r.hit).length;
  const matchAccuracy = evaluated.length > 0 ? hits / evaluated.length : null;

  // ── Brier Score (penaliza confianza mal calibrada)
  const brierScores = evaluated.map(r => {
    const p = r.hit ? r.confidence : (1 - r.confidence);
    return Math.pow(p - 1, 2);  // Brier: (prob - outcome)^2, outcome=1 if hit
  });
  const brierScore = brierScores.length > 0
    ? brierScores.reduce((s, v) => s + v, 0) / brierScores.length
    : null;

  return {
    markets: results,
    summary: {
      total:         evaluated.length,
      hits,
      matchAccuracy,
      brierScore,
      valuableAlert: !!aiPrediction?.valueAlert
    }
  };
}

// ─── Recomputar métricas globales y pesos de señales ─────────────────────────
export function recomputeTrainingMetrics(state){
  const resolved = state.records.filter(r => r.status === 'resolved' && r.evaluation);

  if(!resolved.length){
    return {
      ...state,
      globalMetrics: { ...state.globalMetrics, resolvedRecords: 0, overallAccuracy: null, lastRecomputed: now() }
    };
  }

  // ── Métricas por mercado
  const marketWeights = { ...defaultMarketWeights() };
  for(const key of MARKET_KEYS){
    const relevant = resolved.filter(r => r.evaluation?.markets?.[key]?.pick && r.evaluation?.markets?.[key]?.actual);
    const hits = relevant.filter(r => r.evaluation.markets[key].hit).length;
    const n = relevant.length;
    const accuracy = n > 0 ? hits / n : null;

    // Calibración: diferencia entre confianza promedio y accuracy
    const avgConf = n > 0
      ? relevant.reduce((s, r) => s + safeNum(r.evaluation.markets[key]?.confidence, 0.5), 0) / n
      : null;
    const calibration = accuracy !== null && avgConf !== null ? accuracy - avgConf : null;

    marketWeights[key] = { n, hits, accuracy, calibration };
  }

  // ── Pesos de señales (aprende si una señal correlaciona con aciertos)
  const signalWeights = { ...state.signalWeights };
  for(const signal of SIGNAL_KEYS){
    const withSignal    = resolved.filter(r => toArr(r.match?.flags).includes(signal));
    const withoutSignal = resolved.filter(r => !toArr(r.match?.flags).includes(signal));

    const accWith    = avgAccuracy(withSignal);
    const accWithout = avgAccuracy(withoutSignal);

    if(accWith !== null && accWithout !== null && withSignal.length >= 3){
      // Si la señal mejora la predicción → subir peso, sino bajar
      const delta = accWith - accWithout;
      const currentWeight = safeNum(signalWeights[signal]?.weight, 0.5);
      const newWeight = clamp(currentWeight + (delta * 0.15), 0.1, 1.0);

      signalWeights[signal] = {
        n:           withSignal.length,
        hits:        withSignal.filter(r => r.evaluation?.summary?.hits > 0).length,
        weight:      Number(newWeight.toFixed(3)),
        accWith:     accWith !== null ? Number(accWith.toFixed(3)) : null,
        accWithout:  accWithout !== null ? Number(accWithout.toFixed(3)) : null,
        lastUpdated: now()
      };
    }
  }

  // ── Accuracy global
  const allAccuracies = resolved
    .map(r => r.evaluation?.summary?.matchAccuracy)
    .filter(v => v !== null && Number.isFinite(v));
  const overallAccuracy = allAccuracies.length > 0
    ? allAccuracies.reduce((s, v) => s + v, 0) / allAccuracies.length
    : null;

  return {
    ...state,
    signalWeights,
    marketWeights,
    globalMetrics: {
      totalRecords:     state.records.length,
      resolvedRecords:  resolved.length,
      overallAccuracy,
      lastRecomputed:   now()
    },
    updatedAt: now()
  };
}

function avgAccuracy(records){
  const accs = records
    .map(r => r.evaluation?.summary?.matchAccuracy)
    .filter(v => v !== null && Number.isFinite(v));
  return accs.length > 0 ? accs.reduce((s, v) => s + v, 0) / accs.length : null;
}

// ─── Generar reporte de aprendizaje ──────────────────────────────────────────
export function buildTrainingReport(state){
  const resolved = state.records.filter(r => r.status === 'resolved');
  const pending  = state.records.filter(r => r.status === 'pending');

  const signalInsights = SIGNAL_KEYS
    .map(k => {
      const sw = state.signalWeights[k];
      if(!sw || sw.n < 3) return null;
      const diff = sw.accWith !== null && sw.accWithout !== null
        ? sw.accWith - sw.accWithout
        : null;
      return {
        signal: k,
        n:      sw.n,
        weight: sw.weight,
        accWith: sw.accWith,
        accWithout: sw.accWithout,
        predictivePower: diff !== null ? Number(diff.toFixed(3)) : null,
        verdict: diff === null ? 'sin datos'
          : diff >= 0.1  ? '✅ Señal útil'
          : diff >= 0    ? '⚠️ Señal neutra'
          : '❌ Señal ruido'
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.predictivePower || 0) - (a.predictivePower || 0));

  const marketInsights = MARKET_KEYS.map(k => {
    const mw = state.marketWeights[k];
    return {
      market: k,
      n: mw?.n || 0,
      accuracy: mw?.accuracy !== null ? Number((mw.accuracy * 100).toFixed(1)) : null,
      calibration: mw?.calibration !== null ? Number(mw.calibration.toFixed(3)) : null,
      verdict: mw?.accuracy === null ? 'sin datos'
        : mw.accuracy >= 0.65 ? '✅ Buena precisión'
        : mw.accuracy >= 0.50 ? '⚠️ Precisión media'
        : '❌ Mejorar'
    };
  });

  return {
    summary: {
      totalRecords:     state.records.length,
      resolvedRecords:  resolved.length,
      pendingRecords:   pending.length,
      overallAccuracy:  state.globalMetrics.overallAccuracy !== null
        ? Number((state.globalMetrics.overallAccuracy * 100).toFixed(1))
        : null,
      lastRecomputed:   state.globalMetrics.lastRecomputed
    },
    signalInsights,
    marketInsights,
    topSignals: signalInsights.slice(0, 3),
    worstSignals: [...signalInsights].sort((a, b) => (a.predictivePower || 0) - (b.predictivePower || 0)).slice(0, 3)
  };
}

// ─── Exportar constantes y helpers para el UI ─────────────────────────────────
export { RADAR_TRAINING_VERSION, SCHEMA_TRAINING_KEY, MARKET_KEYS, SIGNAL_KEYS };

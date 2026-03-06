/**
 * Football Lab — Clean rebuild
 * Local-first simulator with JSON import and football-data.org helpers.
 */

import { Cerebelo } from "./Cerebelo.js";
import { HybridBrainService, inferOutcomeLabel, estimateLiveDelta } from "./HybridBrain.js";
import { buildTrainingDataset, createTensorflowBrainModel, trainTensorflowBrainModel, saveBrainArtifacts, loadBrainArtifacts, inferWithBrain, buildTeamProfile, buildFeatureVectorFromProfiles, extractNarrativeFeatures } from "./footballlab/brain/tensorflow_brain.js";
import { computeExpectedGoals } from "./footballlab/xg_engine.js";
import { scoreMatrix, matrixToOutcome, mostLikelyScore, oddsToMarketProbabilities, blendOutcomes } from "./footballlab/poisson_engine.js";
import { buildMneClaudeExport, parseClaudeFeedbackText, updateClaudeMemoryState, getLatestClaudeFeedback, safeJsonPreview, observeLearningAuditsForMatch } from "./footballlab/mne_claude_exchange.js";
import { resolveTeamAliases, collectMatchesForTeam } from "./footballlab/readiness_memory.js";
import { normalizeTeamProfilesState, indexMemoryMatchIntoTeamProfiles, getTeamMatchRefs, rebuildTeamProfileIndex } from "./footballlab/team_memory_index.js";
import { collectPrematchData, buildPrematchInsights, composePrematchEditorial } from "./footballlab/prematch_story_engine_v2.js";
import { getResultsSyncSummary, syncMemoryMatchesIntoResultsModule } from "./footballlab/results_memory_sync.js";
import { buildBitacoraPerformanceLab, normalizePickRecord } from "./footballlab/bitacora_performance.js";

export function initFootballLab(){
  if(window.__footballLabInitialized && window.__FOOTBALL_LAB__?.open){
    return window.__FOOTBALL_LAB__;
  }

  window.__footballLabInitialized = true;
  window.FOOTBALL_LAB_FILE = "footballLab_v8e.js";

  const KEY = "footballDB";
  const COMP_CACHE_KEY = "footballLab_competitions";
  const TEAMS_CACHE_PREFIX = "footballLab_teams_";
  const FOOTBALL_DATA_BASE_URL = "https://api.football-data.org/v4";
  const TEAM_PACKS_KEY = "FL_TEAMPACKS";
  const TEAM_PACKS_INDEX_KEY = "FL_TEAMPACKS_INDEX";
  const TEAM_PACKS_DB = "footballLabTeamPacks";
  const TEAM_PACKS_STORE = "packs";
  const TEAM_MODELS_KEY = "FL_TEAMMODELS";
  const TEAM_BRAIN_FEATURES_KEY = "FL_TEAM_BRAIN_FEATURES";
  const BRAIN_V2_KEY = "FL_BRAIN_V2";
  const GPE_TAG_ON = 0.25;
  const GPE_TOP_TAGS = 3;
  const GIE_TAG_TRAINED_N = 20;
  const GIE_TAG_STRONG_N = 40;
  const GIE_COMBO_TRAINED_N = 30;
  const GIE_COMBO_STRONG_N = 60;
  const hybridBrain = new HybridBrainService();
  let tfLoadPromise = null;

  async function ensureTensorFlowReady(){
    if(typeof window !== "undefined" && window.tf) return window.tf;
    if(tfLoadPromise) return tfLoadPromise;
    tfLoadPromise = new Promise((resolve, reject)=>{
      const existing = document.querySelector('script[data-tfjs="1"]');
      if(existing){
        existing.addEventListener("load", ()=>resolve(window.tf));
        existing.addEventListener("error", ()=>reject(new Error("No se pudo cargar TensorFlow.js")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
      script.async = true;
      script.dataset.tfjs = "1";
      script.onload = ()=>resolve(window.tf);
      script.onerror = ()=>reject(new Error("No se pudo cargar TensorFlow.js"));
      document.head.appendChild(script);
    });
    return tfLoadPromise;
  }

  const defaultDb = {
    settings: {
      apiToken: "",
      season: String(new Date().getFullYear()),
      selectedLeagueId: ""
    },
    leagues: [],
    teams: [],
    teamCompetitions: [],
    players: [],
    tracker: [],
    diagProfiles: {},
    versus: {
      homeAdvantage: 1.1,
      paceFactor: 1,
      sampleSize: 20,
      marketBlend: 0.35,
      matchday: 20,
      tableContextTrust: 0.45,
      tableContext: {},
      simV2: {
        baseGoalRatePerBlock: 0.22,
        globalVolatility: 0.34,
        leagueGoalsAvg: 2.6
      }
    },
    predictions: [],
    marketTracker: [],
    teamRatings: {},
    leagueTableSnapshots: [],
    marketOddsSnapshots: [],
    bitacora: {
      bank: 15,
      kellyFraction: 0.25,
      minUnit: 1,
      maxStakePct: 0.2,
      dailyGoalPct: 0.05,
      dailyRiskPct: 0.15,
      stopLoss: 2,
      stopWin: 1,
      maxBetsPerDay: 3,
      maxConsecutiveLosses: 2,
      entries: []
    },
    learning: {
      schemaVersion: 2,
      leagueScale: {},
      teamBias: {},
      temperatureByLeague: {},
      metrics: { global: null, byLeague: {} },
      trainingSet: [],
      matchSnapshots: [],
      marketTrust: 0.35,
      lrLeague: 0.12,
      lrTeam: 0.08
    }
  };

  function uid(prefix){
    return `${prefix}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`;
  }

  function safeParseJSON(value, fallback){
    try{
      return JSON.parse(value);
    }catch(_err){
      return fallback;
    }
  }

  function loadBrainV2(){
    const raw = localStorage.getItem(BRAIN_V2_KEY);
    const parsed = safeParseJSON(raw, {});
    const normalized = {
      memories: parsed && typeof parsed === "object" && parsed.memories && typeof parsed.memories === "object"
        ? parsed.memories
        : {},
      teamProfiles: parsed && typeof parsed === "object" && parsed.teamProfiles && typeof parsed.teamProfiles === "object"
        ? parsed.teamProfiles
        : {},
      gpe: normalizeGpeState(parsed?.gpe),
      mne: normalizeMneLearningState(parsed?.mne),
      orchestratorLearning: normalizeOrchestratorLearningState(parsed?.orchestratorLearning)
    };
    normalizeTeamProfilesState(normalized, { rebuildIfMissing: true });
    return normalized;
  }

  function normalizeOrchestratorLearningState(raw){
    const parsed = raw && typeof raw === "object" ? raw : {};
    const buildPerf = (engine)=>{
      const row = parsed?.enginePerformance?.[engine] || {};
      return {
        n: Math.max(0, Number(row.n) || 0),
        accuracy: clamp(Number(row.accuracy) || 0, 0, 1),
        brierLike: clamp(Number(row.brierLike) || 0, 0, 1)
      };
    };
    const buildBias = (engine)=>Number(clamp(Number(parsed?.learnedBias?.[engine]) || 0, -0.10, 0.10).toFixed(3));
    return {
      version: 1,
      enginePerformance: {
        MNE: buildPerf("MNE"),
        MCE: buildPerf("MCE"),
        MRE: buildPerf("MRE"),
        GPE: buildPerf("GPE"),
        LSF: buildPerf("LSF"),
        Emotional: buildPerf("Emotional")
      },
      learnedBias: {
        MNE: buildBias("MNE"),
        MCE: buildBias("MCE"),
        MRE: buildBias("MRE"),
        GPE: buildBias("GPE"),
        LSF: buildBias("LSF"),
        Emotional: buildBias("Emotional")
      },
      updatedAt: parsed?.updatedAt || null
    };
  }


  function normalizeClaudeExchangeState(raw){
    const parsed = raw && typeof raw === "object" ? raw : {};
    const learningAuditRaw = parsed.learningAudit && typeof parsed.learningAudit === "object" ? parsed.learningAudit : {};
    return {
      historyByMatch: parsed.historyByMatch && typeof parsed.historyByMatch === "object" ? parsed.historyByMatch : {},
      candidateRules: Array.isArray(parsed.candidateRules) ? parsed.candidateRules : [],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      trainingNotes: Array.isArray(parsed.trainingNotes) ? parsed.trainingNotes : [],
      learningAudit: {
        audits: Array.isArray(learningAuditRaw.audits) ? learningAuditRaw.audits : []
      }
    };
  }

  function normalizeMneLearningState(raw){
    const parsed = raw && typeof raw === "object" ? raw : {};
    return {
      sceneWeights: parsed.sceneWeights && typeof parsed.sceneWeights === "object" ? parsed.sceneWeights : {},
      triggerWeights: parsed.triggerWeights && typeof parsed.triggerWeights === "object" ? parsed.triggerWeights : {},
      confidenceScale: clamp(Number(parsed.confidenceScale) || 1, 0.75, 1.15),
      phasePredictions: parsed.phasePredictions && typeof parsed.phasePredictions === "object" ? parsed.phasePredictions : {},
      phaseObservations: parsed.phaseObservations && typeof parsed.phaseObservations === "object" ? parsed.phaseObservations : {},
      lsfForecasts: parsed.lsfForecasts && typeof parsed.lsfForecasts === "object" ? parsed.lsfForecasts : {},
      lsfEvalHistory: Array.isArray(parsed.lsfEvalHistory) ? parsed.lsfEvalHistory : [],
      lsfState: normalizeLsfState(parsed.lsfState),
      learningLog: Array.isArray(parsed.learningLog) ? parsed.learningLog : [],
      claudeExchange: normalizeClaudeExchangeState(parsed.claudeExchange)
    };
  }

  const LSF_FEATURE_KEYS = [
    "tempoLow", "balanced", "controlHome", "controlAway", "cornersSurgeHome", "cornersSurgeAway",
    "shotsOTSurgeHome", "shotsOTSurgeAway", "finishingFailureHome", "finishingFailureAway", "varShock", "redCard", "surprise", "calError"
  ];

  function normalizeLsfWeights(raw = {}, seed = {}){
    const out = {};
    LSF_FEATURE_KEYS.forEach((key)=>{ out[key] = Number(raw?.[key]); if(!Number.isFinite(out[key])) out[key] = Number(seed?.[key]) || 0; });
    return out;
  }

  function normalizeLsfState(raw){
    const parsed = raw && typeof raw === "object" ? raw : {};
    const seed = {
      base: { tempoLow: 0.18, balanced: 0.12, controlHome: 0.06, controlAway: 0.06, finishingFailureHome: 0.05, finishingFailureAway: 0.05 },
      trigger: { cornersSurgeHome: 0.22, cornersSurgeAway: 0.22, shotsOTSurgeHome: 0.18, shotsOTSurgeAway: 0.18, finishingFailureHome: 0.08, finishingFailureAway: 0.08 },
      chaos: { varShock: 0.35, redCard: 0.40, surprise: 0.20, calError: 0.12 }
    };
    return {
      version: 1,
      weights: {
        base: normalizeLsfWeights(parsed?.weights?.base, seed.base),
        trigger: normalizeLsfWeights(parsed?.weights?.trigger, seed.trigger),
        chaos: normalizeLsfWeights(parsed?.weights?.chaos, seed.chaos)
      },
      calibrator: {
        temp: clamp(Number(parsed?.calibrator?.temp) || 1, 0.85, 1.3),
        confScale: clamp(Number(parsed?.calibrator?.confScale) || 0.92, 0.75, 1)
      },
      stats: {
        forecastsMade: Math.max(0, Number(parsed?.stats?.forecastsMade) || 0),
        correct: Math.max(0, Number(parsed?.stats?.correct) || 0),
        brierSum: Math.max(0, Number(parsed?.stats?.brierSum) || 0)
      }
    };
  }

  function normalizeGpeState(gpe){
    const parsed = gpe && typeof gpe === "object" ? gpe : {};
    return {
      tagStats: parsed.tagStats && typeof parsed.tagStats === "object" ? parsed.tagStats : {},
      comboStats: parsed.comboStats && typeof parsed.comboStats === "object" ? parsed.comboStats : {},
      tagImpact: parsed.tagImpact && typeof parsed.tagImpact === "object" ? parsed.tagImpact : {},
      comboImpact: parsed.comboImpact && typeof parsed.comboImpact === "object" ? parsed.comboImpact : {},
      contextStats: parsed.contextStats && typeof parsed.contextStats === "object" ? parsed.contextStats : {},
      meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : { matches: 0, updatedAt: null }
    };
  }

  function reliabilityFromSample(n = 0){
    return Number((1 - Math.exp(-(Number(n) || 0) / 20)).toFixed(3));
  }

  function reliabilityFromSampleCombo(n = 0){
    return Number((1 - Math.exp(-(Number(n) || 0) / 30)).toFixed(3));
  }

  function computeBaseline(meta = {}){
    const totalN = Math.max(0, Number(meta?.totalN) || Number(meta?.totalMatches) || Number(meta?.matches) || 0);
    if(!totalN){
      return { pW: Number((1/3).toFixed(4)), pD: Number((1/3).toFixed(4)), pL: Number((1/3).toFixed(4)), totalN: 0 };
    }
    const pW = clamp((Number(meta?.totalW) || 0) / totalN, 0, 1);
    const pD = clamp((Number(meta?.totalD) || 0) / totalN, 0, 1);
    const pL = clamp((Number(meta?.totalL) || 0) / totalN, 0, 1);
    const sum = Math.max(0.0001, pW + pD + pL);
    return {
      pW: Number((pW / sum).toFixed(4)),
      pD: Number((pD / sum).toFixed(4)),
      pL: Number((pL / sum).toFixed(4)),
      totalN
    };
  }

  function computeImpactCore(stats = {}, baseline = {}, { combo = false } = {}){
    const n = Math.max(0, Number(stats?.n) || 0);
    const rel = combo ? reliabilityFromSampleCombo(n) : reliabilityFromSample(n);
    const probs = smoothedProbs(stats);
    const liftW = Number((probs.pW - (Number(baseline?.pW) || 0)).toFixed(4));
    const liftD = Number((probs.pD - (Number(baseline?.pD) || 0)).toFixed(4));
    const liftL = Number((probs.pL - (Number(baseline?.pL) || 0)).toFixed(4));
    const effectSize = Number((((Math.abs(liftW) + Math.abs(liftD) + Math.abs(liftL)) / 2)).toFixed(4));
    const impactScore = Number((rel * effectSize).toFixed(4));
    const maxAbs = Math.max(Math.abs(liftW), Math.abs(liftD), Math.abs(liftL));
    let polarity = "mixed";
    if(effectSize < 0.04) polarity = "none";
    else if(maxAbs === Math.abs(liftW)) polarity = "W";
    else if(maxAbs === Math.abs(liftD)) polarity = "D";
    else if(maxAbs === Math.abs(liftL)) polarity = "L";
    const volatility = Number((rel * (Math.abs(liftD) + Math.abs(liftW) + Math.abs(liftL))).toFixed(4));
    const isTrap = rel >= 0.6 && probs.pD >= (Number(baseline?.pD) || 0) + 0.1;
    const isChaos = rel >= 0.6 && probs.pW >= (Number(baseline?.pW) || 0) + 0.12 && probs.pL >= (Number(baseline?.pL) || 0) + 0.12;
    const smoke = effectSize < 0.04 || rel < 0.35;
    return {
      n,
      rel,
      pW: probs.pW,
      pD: probs.pD,
      pL: probs.pL,
      liftW,
      liftD,
      liftL,
      effectSize,
      impactScore,
      polarity,
      volatility,
      isTrap,
      isChaos,
      smoke,
      lastUpdated: stats?.lastUpdated || null
    };
  }

  function computeImpactForTag(stats = {}, baseline = {}){
    return computeImpactCore(stats, baseline, { combo: false });
  }

  function computeImpactForCombo(stats = {}, baseline = {}){
    return computeImpactCore(stats, baseline, { combo: true });
  }

  function formatIsoShort(value){
    if(!value) return "-";
    const d = new Date(value);
    if(Number.isNaN(d.getTime())) return "-";
    return d.toISOString().slice(0, 10);
  }

  function computeGlobalLearningProgress(memories = {}, gpe = null){
    const safeGpe = normalizeGpeState(gpe);
    const facts = Object.values(memories || {})
      .flatMap((rows)=>Array.isArray(rows) ? rows : [])
      .map((row)=>buildBrainV2MatchFact(row));
    const totalMatches = Number(safeGpe?.meta?.totalMatches || safeGpe?.meta?.matches || facts.length) || 0;
    const totalTeams = Number(safeGpe?.meta?.totalTeams || 0) || new Set(facts.map((fact)=>fact.teamId).filter(Boolean)).size;
    const baseline = computeBaseline(safeGpe?.meta || {});
    const tagRows = Object.entries(safeGpe.tagStats || {}).map(([tagId, stats])=>{
      const impact = safeGpe.tagImpact?.[tagId] || computeImpactForTag(stats, baseline);
      return {
        tagId,
        ...impact,
        badge: impact.smoke ? "HUMO" : impact.isChaos ? "CHAOS" : impact.isTrap ? "TRAP" : impact.polarity === "W" ? "WIN" : impact.polarity === "D" ? "DRAW" : impact.polarity === "L" ? "LOSS" : "MIXED"
      };
    }).sort((a,b)=>b.impactScore-a.impactScore || b.rel-a.rel || b.n-a.n);
    const comboRows = Object.entries(safeGpe.comboStats || {}).map(([comboKey, stats])=>{
      const impact = safeGpe.comboImpact?.[comboKey] || computeImpactForCombo(stats, baseline);
      return {
        comboKey,
        ...impact,
        badge: impact.smoke ? "HUMO" : impact.isChaos ? "CHAOS" : impact.isTrap ? "TRAP" : impact.polarity === "W" ? "WIN" : impact.polarity === "D" ? "DRAW" : impact.polarity === "L" ? "LOSS" : "MIXED"
      };
    }).sort((a,b)=>b.impactScore-a.impactScore || b.rel-a.rel || b.n-a.n);
    const tagsTrained = tagRows.filter((r)=>r.n >= GIE_TAG_TRAINED_N).length;
    const tagsStrong = tagRows.filter((r)=>r.n >= GIE_TAG_STRONG_N).length;
    const combosTrained = comboRows.filter((r)=>r.n >= GIE_COMBO_TRAINED_N).length;
    const combosStrong = comboRows.filter((r)=>r.n >= GIE_COMBO_STRONG_N).length;
    const strongSignals = tagRows.filter((r)=>r.rel >= 0.6 && r.effectSize >= 0.08).length;
    const trapSignals = tagRows.filter((r)=>r.isTrap).length;
    const chaosSignals = tagRows.filter((r)=>r.isChaos).length;
    const top5 = tagRows.slice(0,5);
    const avgRelTop5Tags = top5.length ? top5.reduce((acc, row)=>acc + row.rel, 0) / top5.length : 0;
    const readiness = clamp(100 * avgRelTop5Tags * (totalMatches / 120), 0, 100);
    const warnings = tagRows
      .filter((row)=>row.rel >= 0.6)
      .slice(0, 6)
      .map((row)=>{
        if(row.isChaos) return `🌀 ${row.tagId} produce caos (sube W ${(row.liftW*100).toFixed(1)}% y L ${(row.liftL*100).toFixed(1)}%).`;
        if(row.isTrap) return `⚠️ ${row.tagId} tiende a aumentar empates (+${(row.liftD*100).toFixed(1)}%) con rel ${row.rel.toFixed(2)}.`;
        if(row.polarity === "W") return `🔥 ${row.tagId} aumenta wins (${row.liftW>=0?'+':''}${(row.liftW*100).toFixed(1)}%).`;
        if(row.polarity === "L") return `📉 ${row.tagId} empuja losses (${row.liftL>=0?'+':''}${(row.liftL*100).toFixed(1)}%).`;
        return `ℹ️ ${row.tagId} mueve draws (${row.liftD>=0?'+':''}${(row.liftD*100).toFixed(1)}%).`;
      });
    return {
      totalMatches,
      totalTeams,
      baseline,
      tagRows,
      comboRows,
      tagsTrained,
      tagsStrong,
      combosTrained,
      combosStrong,
      strongSignals,
      trapSignals,
      chaosSignals,
      avgRelTop5Tags,
      readiness,
      warnings
    };
  }

  function smoothedProbs({ w = 0, d = 0, l = 0, n = 0 } = {}){
    const base = Math.max(0, Number(n) || 0);
    return {
      pW: Number(((Number(w) + 1) / (base + 3)).toFixed(4)),
      pD: Number(((Number(d) + 1) / (base + 3)).toFixed(4)),
      pL: Number(((Number(l) + 1) / (base + 3)).toFixed(4))
    };
  }

  function buildBrainV2MatchFact(row = {}){
    const reasons = (row?.summary?.reasons || []).filter((reason)=>Number(reason?.strength) >= GPE_TAG_ON);
    const topReasons = reasons
      .slice()
      .sort((a,b)=>(Number(b?.strength) || 0) - (Number(a?.strength) || 0))
      .slice(0, GPE_TOP_TAGS);
    const tags = {};
    topReasons.forEach((reason)=>{
      const tagId = String(reason?.tagId || reason?.tag || "").trim();
      if(!tagId) return;
      tags[tagId] = clamp(Number(reason?.strength) || 0, 0, 1);
    });
    const [gfRaw, gaRaw] = String(row?.score || "0-0")
      .split(/[-:]/)
      .map((part)=>Number(part.trim()));
    const goalsFor = Number.isFinite(gfRaw) ? gfRaw : 0;
    const goalsAgainst = Number.isFinite(gaRaw) ? gaRaw : 0;
    const result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
    return {
      matchId: row?.id || uid("b2mf"),
      teamId: row?.teamId || "",
      leagueId: row?.leagueId || "",
      date: row?.date || "",
      goalsFor,
      goalsAgainst,
      result,
      tags,
      topTags: topReasons.map((reason)=>String(reason?.tagId || reason?.tag || "")).filter(Boolean),
      odds: row?.odds || null,
      oas: row?.oas || null,
      context: {
        side: String(row?.side || "unknown")
      }
    };
  }

  function buildGlobalPatternEngine(memories = {}){
    const state = normalizeGpeState();
    const facts = Object.values(memories || {})
      .flatMap((rows)=>Array.isArray(rows) ? rows : [])
      .map((row)=>buildBrainV2MatchFact(row))
      .filter((fact)=>Object.keys(fact.tags || {}).length);

    let totalW = 0;
    let totalD = 0;
    let totalL = 0;
    facts.forEach((fact)=>{
      const resultKey = fact.result === "W" ? "w" : fact.result === "L" ? "l" : "d";
      if(resultKey === "w") totalW += 1;
      else if(resultKey === "d") totalD += 1;
      else totalL += 1;
      const tagEntries = Object.entries(fact.tags || {});
      const contextKey = `side:${fact?.context?.side || 'unknown'}`;
      const contextBucket = state.contextStats[contextKey] || { n: 0, w: 0, d: 0, l: 0 };
      contextBucket.n += 1;
      contextBucket[resultKey] += 1;
      state.contextStats[contextKey] = contextBucket;
      tagEntries.forEach(([tagId, strength])=>{
        const bucket = state.tagStats[tagId] || { n: 0, w: 0, d: 0, l: 0, goalsForSum: 0, goalsAgainstSum: 0, strengthSum: 0, lastUpdated: null };
        bucket.n += 1;
        bucket[resultKey] += 1;
        bucket.goalsForSum += Number(fact.goalsFor) || 0;
        bucket.goalsAgainstSum += Number(fact.goalsAgainst) || 0;
        bucket.strengthSum += Number(strength) || 0;
        bucket.lastUpdated = new Date().toISOString();
        state.tagStats[tagId] = bucket;
      });
      const comboTags = tagEntries
        .sort((a,b)=>(Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, GPE_TOP_TAGS)
        .map(([tagId])=>tagId);
      for(let i=0; i<comboTags.length; i += 1){
        for(let j=i+1; j<comboTags.length; j += 1){
          const comboKey = [comboTags[i], comboTags[j]].sort().join("|");
          const combo = state.comboStats[comboKey] || { n: 0, w: 0, d: 0, l: 0, avgStrength: 0, strengthSum: 0, lastUpdated: null };
          combo.n += 1;
          combo[resultKey] += 1;
          combo.strengthSum += ((Number(fact.tags[comboTags[i]]) || 0) + (Number(fact.tags[comboTags[j]]) || 0)) / 2;
          combo.avgStrength = Number((combo.strengthSum / Math.max(1, combo.n)).toFixed(3));
          combo.lastUpdated = new Date().toISOString();
          state.comboStats[comboKey] = combo;
        }
      }
    });

    state.meta = {
      matches: facts.length,
      totalMatches: facts.length,
      totalN: facts.length,
      totalW,
      totalD,
      totalL,
      totalTeams: new Set(facts.map((fact)=>fact.teamId).filter(Boolean)).size,
      updatedAt: new Date().toISOString()
    };
    const baseline = computeBaseline(state.meta);
    const tagImpact = {};
    Object.entries(state.tagStats || {}).forEach(([tagId, stats])=>{
      tagImpact[tagId] = computeImpactForTag(stats, baseline);
    });
    const comboImpact = {};
    Object.entries(state.comboStats || {}).forEach(([comboKey, stats])=>{
      comboImpact[comboKey] = computeImpactForCombo(stats, baseline);
    });
    state.tagImpact = tagImpact;
    state.comboImpact = comboImpact;
    return state;
  }

  function saveBrainV2(state){
    const next = state && typeof state === "object" ? state : { memories: {} };
    next.memories ||= {};
    normalizeTeamProfilesState(next, { rebuildIfMissing: true });
    next.gpe = buildGlobalPatternEngine(next.memories);
    next.mne = normalizeMneLearningState(next.mne);
    localStorage.setItem(BRAIN_V2_KEY, JSON.stringify(next));
  }

  function parseNumericStats(raw = ""){
    const out = {};
    const text = String(raw || "");
    const matcher = /([^\n:=]{2,40})\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/g;
    let hit;
    while((hit = matcher.exec(text))){
      const key = String(hit[1] || "").trim().toLowerCase().replace(/\s+/g, "_");
      const value = Number(String(hit[2] || "").replace(",", "."));
      if(!key || Number.isNaN(value)) continue;
      out[key] = value;
    }
    return out;
  }

  function parseBrainV2StatsToStatsRaw(raw = ""){
    if(!raw) return { kind: "match_stats", stats: [] };
    const text = String(raw || "").trim();
    try{
      const parsed = parseStatsPayload(text);
      if(Array.isArray(parsed) && parsed.length){
        return { kind: "match_stats", stats: parsed };
      }
    }catch(_err){
      // fallback: texto libre key: valor
    }
    const numeric = parseNumericStats(text);
    const labelize = (key="")=>String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c)=>c.toUpperCase());
    const stats = Object.entries(numeric).map(([key, value])=>({
      key: labelize(key),
      home: String(value),
      away: "0"
    }));
    return { kind: "match_stats", stats };
  }

  function summarizeTeamMemory(matches = []){
    const rows = Array.isArray(matches) ? matches : [];
    const totals = {};
    const counts = {};
    let positive = 0;
    let negative = 0;
    let fatigueNotes = 0;
    let resilienceNotes = 0;
    rows.forEach((m)=>{
      const stats = parseNumericStats(m?.statsRaw || "");
      Object.entries(stats).forEach(([k,v])=>{
        totals[k] = (totals[k] || 0) + v;
        counts[k] = (counts[k] || 0) + 1;
      });
      const text = String(m?.narrative || "").toLowerCase();
      if(/domin|creativ|presion|solido|efectiv|control/.test(text)) positive += 1;
      if(/error|roja|lesion|fall|debil|desorden|fragil/.test(text)) negative += 1;
      if(/cansad|fatig|agot|sin piernas|baj[óo] el ritmo|fundid/.test(text)) fatigueNotes += 1;
      if(/remont|resist|aguant|intens|sostuvo|compiti[oó]/.test(text)) resilienceNotes += 1;
    });
    const avg = {};
    Object.keys(totals).forEach((k)=>{
      avg[k] = totals[k] / Math.max(1, counts[k] || 1);
    });
    return { samples: rows.length, avg, positive, negative, fatigueNotes, resilienceNotes };
  }

  function toHybridFeatureSeed(summary = {}, side = "home"){
    const avg = summary?.avg || {};
    const pick = (keys = [], fallback = 0)=>{
      for(const key of keys){
        const value = Number(avg[key]);
        if(Number.isFinite(value)) return value;
      }
      return fallback;
    };
    const xg = pick(["xg", "expected_goals"], 1.2);
    const shots = pick(["shots", "total_shots"], 10);
    const against = pick(["shots_against", "shots_allowed"], 9);
    const poss = pick(["possession"], 50);
    const cards = pick(["cards", "yellow_cards"], 2.2);
    const corners = pick(["corners", "corner_kicks"], 4.5);
    const attacks = pick(["dangerous_attacks", "danger_attacks"], 26);
    const gf = pick(["goals_for", "goals"], xg);
    const ga = pick(["goals_against"], Math.max(0.2, 1.2 - (xg - 1)));
    return {
      [`elo_${side}`]: 1500 + ((summary.positive || 0) - (summary.negative || 0)) * 8,
      [`form_points_${side}`]: Math.max(0, Math.min(15, (summary.positive || 0) * 2 + 3)),
      [`goals_for_${side}`]: gf,
      [`goals_against_${side}`]: ga,
      [`xg_for_${side}`]: xg,
      [`xg_against_${side}`]: Math.max(0.2, ga),
      [`shots_for_${side}`]: shots,
      [`shots_against_${side}`]: against,
      [`possession_${side}`]: poss,
      [`dangerous_attacks_${side}`]: attacks,
      [`corners_${side}`]: corners,
      [`cards_${side}`]: cards
    };
  }

  function buildHybridPackFromBrainV2(dbState, memories = {}){
    const teamsById = new Map((dbState?.teams || []).map((t)=>[String(t.id), t]));
    const matches = [];
    Object.entries(memories || {}).forEach(([teamId, rows])=>{
      const teamName = teamsById.get(String(teamId))?.name || `Team ${teamId}`;
      (Array.isArray(rows) ? rows : []).forEach((row, idx)=>{
        const stats = parseNumericStats(row?.statsRaw || "");
        const xg = Number(stats?.xg || stats?.expected_goals || 1.2);
        const opponentXg = Math.max(0.2, 2.1 - xg);
        const finalHomeGoals = Math.max(0, Math.round(xg));
        const finalAwayGoals = Math.max(0, Math.round(opponentXg));
        matches.push({
          matchId: `b2_${teamId}_${idx}_${row?.id || row?.date || Date.now()}`,
          preMatchFeatures: {
            elo_home: 1500,
            elo_away: 1490,
            form_points_home: 8,
            form_points_away: 8,
            goals_for_home: Number(stats?.goals_for || finalHomeGoals),
            goals_for_away: Number(stats?.goals_against || finalAwayGoals),
            goals_against_home: Number(stats?.goals_against || finalAwayGoals),
            goals_against_away: Number(stats?.goals_for || finalHomeGoals),
            xg_for_home: xg,
            xg_for_away: opponentXg,
            xg_against_home: opponentXg,
            xg_against_away: xg,
            shots_for_home: Number(stats?.shots || 10),
            shots_for_away: Number(stats?.shots_against || 9),
            shots_against_home: Number(stats?.shots_against || 9),
            shots_against_away: Number(stats?.shots || 10),
            possession_home: Number(stats?.possession || 50),
            possession_away: Math.max(20, 100 - Number(stats?.possession || 50)),
            corners_home: Number(stats?.corners || 4),
            corners_away: Number(stats?.corners_against || 4),
            cards_home: Number(stats?.cards || 2),
            cards_away: Number(stats?.cards_against || 2),
            dangerous_attacks_home: Number(stats?.dangerous_attacks || 25),
            dangerous_attacks_away: Number(stats?.dangerous_attacks_against || 22),
            minute: 0,
            is_live_slice: 0
          },
          preMatchText: `${teamName} vs ${(row?.opponent || "Rival")}. ${row?.narrative || ""}`,
          finalHomeGoals,
          finalAwayGoals,
          timeline: []
        });
      });
    });
    return { matches };
  }

  function buildTeamPackFromBrainV2Memories(memories = [], teamName = "Equipo"){
    const list = Array.isArray(memories) ? memories : [];
    const matches = list.map((row, idx)=>{
      const score = String(row?.score || "0-0");
      const hit = score.match(/(\d+)\s*[-:]\s*(\d+)/);
      const teamGoals = hit ? Number(hit[1]) : 0;
      const oppGoals = hit ? Number(hit[2]) : 0;
      return {
        matchId: String(row?.id || `b2_${idx}`),
        matchDate: row?.date || new Date().toISOString().slice(0,10),
        homeAway: "home",
        opponent: { name: row?.opponent || "Rival" },
        scoreFT: { home: teamGoals, away: oppGoals },
        narrativeRaw: String(row?.narrative || ""),
        statsRaw: parseBrainV2StatsToStatsRaw(row?.statsRaw || "")
      };
    });
    return {
      team: { name: teamName || "Equipo" },
      matches
    };
  }

  const BRAIN_V2_PHASES = [
    { key: "0-15", min: 0, max: 15 },
    { key: "16-30", min: 16, max: 30 },
    { key: "31-45", min: 31, max: 45 },
    { key: "46-60", min: 46, max: 60 },
    { key: "61-75", min: 61, max: 75 },
    { key: "76-90+", min: 76, max: 140 }
  ];

  function phaseFromMinute(minute){
    const safe = clamp(Number(minute) || 0, 0, 140);
    return BRAIN_V2_PHASES.find((phase)=>safe>=phase.min && safe<=phase.max)?.key || "76-90+";
  }

  function mnePhaseOfMinute(minute){
    const safe = clamp(Number(minute) || 0, 0, 140);
    if(safe<=15) return "0-15";
    if(safe<=30) return "15-30";
    if(safe<=45) return "30-45";
    if(safe<=60) return "45-60";
    if(safe<=75) return "60-75";
    return "75-90";
  }

  function nextMnePhase(current = "0-15"){
    const phases = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90"];
    const idx = phases.indexOf(String(current));
    if(idx < 0) return "15-30";
    return phases[Math.min(phases.length - 1, idx + 1)];
  }

  function buildPhaseCountsFromMinutes(minutes = []){
    const counts = { "0-15": 0, "15-30": 0, "30-45": 0, "45-60": 0, "60-75": 0, "75-90": 0 };
    (Array.isArray(minutes) ? minutes : []).forEach((minute)=>{
      const phase = mnePhaseOfMinute(minute);
      counts[phase] = (Number(counts[phase]) || 0) + 1;
    });
    return counts;
  }

  function parseNarrativeEventType(line = ""){
    const txt = String(line || "").toLowerCase();
    const rules = [
      ["goal", /\bgol\b|anota|marca|empata|descuenta/],
      ["big_chance", /gran oportunidad|ocasion clarisima|mano a mano|a bocajarro|que oportunidad/],
      ["save", /parada|ataj|salva|tapad/],
      ["corner", /c[oó]rner|tiro de esquina/],
      ["yellow", /tarjeta amarilla|amonestad/],
      ["red", /tarjeta roja|expulsad/],
      ["injury", /lesi[oó]n|se retira|molestia|tocad/],
      ["sub", /cambio|sustitu/],
      ["offside", /fuera de juego|offside/],
      ["foul", /falta|infracci[oó]n/],
      ["shot", /disparo|remate|chut|tiro/]
    ];
    return rules.find((entry)=>entry[1].test(txt))?.[0] || "pressure";
  }

  function scoreNarrativeQuality(type, line){
    const txt = String(line || "").toLowerCase();
    const base = {
      shot: 0.34,
      big_chance: 0.72,
      goal: 0.95,
      save: 0.5,
      corner: 0.26,
      foul: 0.14,
      yellow: 0.1,
      red: 0.18,
      offside: 0.22,
      sub: 0.08,
      injury: 0.2,
      pressure: 0.2
    };
    let value = Number(base[type]) || 0.2;
    const boosts = [
      [/(dentro del area|a bocajarro|area pequena|mano a mano)/, 0.2],
      [/(gran oportunidad|clarisima|que oportunidad)/, 0.18],
      [/(poste|larguero)/, 0.14],
      [/(parada brillante|ataj[ae]da reflexiva)/, 0.16]
    ];
    const penalties = [
      [/(desde fuera del area|lejano)/, -0.12],
      [/(debil|flojo|sin problema|comodo|facil)/, -0.14]
    ];
    boosts.forEach(([regex, bonus])=>{ if(regex.test(txt)) value += bonus; });
    penalties.forEach(([regex, malus])=>{ if(regex.test(txt)) value += malus; });
    return clamp(value, 0, 1);
  }

  function parseBrainV2Events(narrativeRaw = "", teamName = "Local", opponentName = "Rival"){
    const lines = String(narrativeRaw || "").split(/\n+/).map((line)=>String(line || "").trim()).filter(Boolean);
    const minuteRegex = /(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*'?/;
    const teamToken = normalizeTeamToken(teamName);
    const oppToken = normalizeTeamToken(opponentName);
    let pendingMinute = 0;
    return lines.map((line, idx)=>{
      const minuteMatch = line.match(minuteRegex);
      if(minuteMatch){
        pendingMinute = Number(minuteMatch[1] || 0) + Number(minuteMatch[2] || 0);
      }
      const lineNorm = normalizeTeamToken(line);
      const team = lineNorm.includes(oppToken) || /visitante|rival/.test(lineNorm)
        ? "away"
        : (lineNorm.includes(teamToken) || /local/.test(lineNorm) ? "home" : "home");
      const type = parseNarrativeEventType(line);
      const minute = clamp(Number(pendingMinute) || 0, 0, 140);
      return {
        id: `evt_${idx}_${minute}`,
        minute,
        phase: phaseFromMinute(minute),
        team,
        type,
        quality: scoreNarrativeQuality(type, line),
        text: line
      };
    });
  }

  const RELATO_TAG_LABELS = {
    finishing_failure: "Definición ineficiente",
    clinical_finish: "Definición clínica",
    counter_strike: "Golpe al contraataque",
    momentum_control: "Control de ritmo",
    territorial_pressure: "Presión territorial",
    wasted_setpieces: "ABP desperdiciadas",
    setpiece_threat: "Peligro a balón parado",
    discipline_issues: "Problemas disciplinarios",
    keeper_heroics: "Portero figura",
    injury_disruption: "Corte por lesión",
    late_pressure: "Presión final",
    var_turning_point: "Punto de giro VAR"
  };

  const RELATO_CORE_TAGS = new Set([
    "finishing_failure", "clinical_finish", "counter_strike", "momentum_control", "territorial_pressure",
    "late_pressure", "defensive_errors", "setpiece_threat", "wasted_setpieces"
  ]);
  const RELATO_MODIFIER_TAGS = new Set(["keeper_heroics", "discipline_issues", "injury_disruption", "var_turning_point"]);

  const RELATO_MICRO_TYPES = [
    "shot_attempt", "shot_on_target", "big_chance", "goal", "high_quality_finish",
    "corner", "freekick", "setpiece_cross",
    "save", "miss", "block", "clear", "interception",
    "possession_control", "territorial",
    "foul", "yellow", "red", "substitution", "injury_stop",
    "var_review", "var_overturn", "penalty_awarded", "penalty_cancelled", "goal_cancelled"
  ];

  const RELATO_OFFENSIVE_TYPES = new Set(["shot_attempt", "shot_on_target", "big_chance", "corner", "setpiece_cross", "save", "miss", "block"]);

  const RELATO_PATTERNS = {
    shot_attempt: [/\bcabece[a-z]*\b/i, /\bremata\b/i, /\bdispara\b/i, /\btiro\b/i, /\bshot\b/i],
    shot_on_target: [/a puerta/i, /entre los tres palos/i, /al arco/i],
    miss: [/se va fuera/i, /por encima/i, /desviado/i, /al poste/i, /\bfuera\b/i],
    save: [/\bparada\b/i, /\bataj/i, /salva/i, /guantes/i],
    big_chance: [/gran ocasi[oó]n/i, /qu[eé] oportunidad/i, /\bcasi\b/i, /mano a mano/i],
    goal: [/\bgol\b/i],
    high_quality_finish: [/supera al portero/i, /col[aá]ndose/i],
    corner: [/c[oó]rner/i, /saque de esquina/i],
    freekick: [/tiro libre/i, /falta.*centro/i],
    setpiece_cross: [/bal[oó]n parado.*centro/i, /centro.*bal[oó]n parado/i],
    block: [/bloqueado/i, /barrera/i],
    clear: [/despeje/i, /despeja/i, /despejado/i],
    interception: [/intercept/i],
    yellow: [/tarjeta amarilla/i],
    red: [/tarjeta roja|expulsad/i],
    foul: [/\bfalta\b/i],
    substitution: [/cambio|sustituci[oó]n|entra .* por/i],
    possession_control: [/controla la posesi[oó]n/i, /intercambiando pases/i],
    territorial: [/encierra|domina campo rival|instalado en campo rival/i],
    var_review: [/\bvar\b/i],
    var_overturn: [/revierte|revisi[oó]n .* no hubo infracci[oó]n|se cancela/i],
    injury_stop: [/lesi[oó]n|asistencia m[eé]dica|pausa m[eé]dica/i],
    goal_cancelled: [/gol anulado/i]
  };

  const RELATO_MICRO_WEIGHTS = {
    big_chance: 3,
    shot_attempt: 1,
    miss: 2,
    save: 2,
    goal: 5,
    high_quality_finish: 2,
    corner: 1,
    freekick: 1,
    setpiece_cross: 1,
    block: 1,
    clear: 1,
    interception: 1,
    possession_control: 1,
    yellow: 1,
    foul: 1,
    red: 2,
    substitution: 0.6,
    injury_stop: 2,
    var_review: 0.5,
    var_overturn: 0.5,
    penalty_awarded: 1,
    penalty_cancelled: 2,
    goal_cancelled: 2
  };

  function parseRelatoEvents(narrativeRaw = "", homeTeam = "Local", awayTeam = "Rival"){
    const minuteRegex = /(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*'?/;
    const lines = String(narrativeRaw || "").split(/\n+/).map((line)=>String(line || "").trim()).filter(Boolean);
    let pendingMinute = 0;
    return lines.map((line, idx)=>{
      const minuteMatch = line.match(minuteRegex);
      const base = minuteMatch ? Number(minuteMatch[1] || 0) : pendingMinute;
      const extra = minuteMatch ? Number(minuteMatch[2] || 0) : 0;
      pendingMinute = base;
      const text = line.toLowerCase().replace(/\s+/g, " ").trim();
      const norm = normalizeTeamToken(line);
      const homeToken = normalizeTeamToken(homeTeam);
      const awayToken = normalizeTeamToken(awayTeam);
      let team = "unknown";
      if(line.includes(`(${homeTeam})`) || (homeToken && norm.includes(homeToken))) team = "home";
      else if(line.includes(`(${awayTeam})`) || (awayToken && norm.includes(awayToken))) team = "away";
      return { id: `rel_${idx}_${base}_${extra}`, idx, min: clamp(base, 0, 140), extra, raw: line, text, team, microEvents: [] };
    });
  }

  function classifyRelatoMicroEvents(events = []){
    return (Array.isArray(events) ? events : []).map((event)=>{
      const detected = [];
      Object.entries(RELATO_PATTERNS).forEach(([type, regexes])=>{
        if(!RELATO_MICRO_TYPES.includes(type) && type !== "high_quality_finish") return;
        if(regexes.some((rx)=>rx.test(event.text))){
          detected.push({ type, weight: Number(RELATO_MICRO_WEIGHTS[type]) || 1 });
        }
      });
      if(detected.some((item)=>item.type === "shot_attempt") && !detected.some((item)=>item.type === "shot_on_target") && /a puerta|al arco|entre los tres palos/.test(event.text)){
        detected.push({ type: "shot_on_target", weight: Number(RELATO_MICRO_WEIGHTS.shot_on_target) || 1 });
      }
      if(/penalti!?|\bpenalty\b|\bpenal\b/.test(event.text)){
        const cancelled = /no es penalti|revierte|no hubo infracci[oó]n|se cancela/.test(event.text);
        detected.push({ type: cancelled ? "penalty_cancelled" : "penalty_awarded", weight: Number(RELATO_MICRO_WEIGHTS[cancelled ? "penalty_cancelled" : "penalty_awarded"]) || 1 });
      }
      return { ...event, microEvents: detected };
    });
  }

  function getRelatoWindow(events = [], idx = 0, backN = 5){
    const start = Math.max(0, idx - Math.max(1, backN));
    return events.slice(start, idx);
  }

  function pushRelatoTagHit(store, tagId, addScore, minute, reason, evidenceLine){
    const bucket = store[tagId] || { tagId, label: RELATO_TAG_LABELS[tagId] || tagId, score: 0, mins: [], minuteScore: {}, evidence: [], reason };
    bucket.score += Number(addScore) || 0;
    if(Number.isFinite(minute)){
      const safeMin = clamp(Math.round(Number(minute) || 0), 0, 140);
      bucket.mins.push(safeMin);
      bucket.minuteScore[safeMin] = (Number(bucket.minuteScore[safeMin]) || 0) + (Number(addScore) || 0);
    }
    if(evidenceLine && !bucket.evidence.includes(evidenceLine) && bucket.evidence.length < 8) bucket.evidence.push(evidenceLine);
    if(reason && !bucket.reason) bucket.reason = reason;
    store[tagId] = bucket;
  }

  function buildRelatoTags(narrativeRaw = "", homeTeam = "Local", awayTeam = "Rival"){
    const events = classifyRelatoMicroEvents(parseRelatoEvents(narrativeRaw, homeTeam, awayTeam));
    const tags = {};
    const attackCountBeforeMinute = (team, minute)=>events.filter((row)=>row.team===team && row.min < minute).reduce((acc, row)=>{
      const rowTypes = new Set((row.microEvents || []).map((m)=>m.type));
      return acc + (Array.from(RELATO_OFFENSIVE_TYPES).some((type)=>rowTypes.has(type)) ? 1 : 0);
    }, 0);

    events.forEach((event, idx)=>{
      const types = new Set((event.microEvents || []).map((m)=>m.type));
      const has = (type)=>types.has(type);
      if(has("big_chance") && (has("miss") || has("save"))){
        pushRelatoTagHit(tags, "finishing_failure", 4, event.min, "Genera chances claras pero no define", event.raw);
      }else if(has("shot_attempt") && (has("miss") || has("save"))){
        pushRelatoTagHit(tags, "finishing_failure", 2, event.min, "Remates sin premio en secuencia", event.raw);
      }else if(has("shot_attempt")){
        pushRelatoTagHit(tags, "territorial_pressure", 1, event.min, "Volumen ofensivo sostenido", event.raw);
      }

      if(has("goal") && (has("high_quality_finish") || has("big_chance"))){
        pushRelatoTagHit(tags, "clinical_finish", 3, event.min, "Concreta con alta calidad", event.raw);
      }
      if(has("save")) pushRelatoTagHit(tags, "keeper_heroics", 2, event.min, "El arquero evita goles esperados", event.raw);
      if(has("yellow") || has("foul")) pushRelatoTagHit(tags, "discipline_issues", 1, event.min, "Faltas y tarjetas cortan el plan", event.raw);
      if(has("injury_stop")) pushRelatoTagHit(tags, "injury_disruption", 2, event.min, "Parones por lesión alteran el ritmo", event.raw);
      if(has("possession_control") || has("territorial")) pushRelatoTagHit(tags, "momentum_control", 1.5, event.min, "Secuencias largas de posesión", event.raw);

      if(event.min >= 80){
        let lateScore = 0;
        if(has("big_chance")) lateScore += 4;
        if(has("shot_attempt") || has("corner")) lateScore += 2;
        if(has("save")) lateScore += 2;
        if(lateScore>0) pushRelatoTagHit(tags, "late_pressure", lateScore, event.min, "Empuje final con eventos ofensivos reales", event.raw);
      }

      if(has("corner") || has("freekick") || has("setpiece_cross")){
        const window = events.slice(idx + 1, idx + 4);
        const threatHit = window.some((row)=>{
          const wTypes = new Set((row.microEvents || []).map((m)=>m.type));
          return ["shot_attempt", "big_chance", "save", "miss"].some((t)=>wTypes.has(t));
        });
        const wasteHit = window.some((row)=>{
          const wTypes = new Set((row.microEvents || []).map((m)=>m.type));
          return ["clear", "interception", "block"].some((t)=>wTypes.has(t));
        });
        if(threatHit) pushRelatoTagHit(tags, "setpiece_threat", 2.5, event.min, "Balón parado termina en remate peligroso", event.raw);
        else if(wasteHit) pushRelatoTagHit(tags, "wasted_setpieces", 2, event.min, "ABP neutralizada sin remate", event.raw);
      }

      if(has("goal")){
        const window = getRelatoWindow(events, idx, 5);
        const rival = event.team === "home" ? "away" : event.team === "away" ? "home" : "unknown";
        const rivalControl = window.some((row)=>{
          if(rival !== "unknown" && row.team !== rival && row.team !== "unknown") return false;
          const prevTypes = new Set((row.microEvents || []).map((m)=>m.type));
          return prevTypes.has("possession_control") || prevTypes.has("corner") || prevTypes.has("big_chance");
        });
        const rivalMiss = window.some((row)=>{
          if(rival !== "unknown" && row.team !== rival && row.team !== "unknown") return false;
          const prevTypes = new Set((row.microEvents || []).map((m)=>m.type));
          return prevTypes.has("miss") || prevTypes.has("save");
        });
        if(rivalControl) pushRelatoTagHit(tags, "counter_strike", 4, event.min, "Marca tras absorber presión rival", event.raw);
        else if(rivalMiss) pushRelatoTagHit(tags, "counter_strike", 2, event.min, "Golpea tras ocasión desperdiciada rival", event.raw);
      }

      if(has("var_review")){
        const outcome = events.slice(idx + 1, idx + 4).find((row)=>{
          const wTypes = new Set((row.microEvents || []).map((m)=>m.type));
          return wTypes.has("var_overturn") || wTypes.has("penalty_cancelled") || wTypes.has("goal_cancelled");
        });
        if(outcome){
          const oTypes = new Set((outcome.microEvents || []).map((m)=>m.type));
          let impact = oTypes.has("goal_cancelled") ? 6 : (oTypes.has("penalty_cancelled") ? 5 : 3);
          const affectedTeam = event.team !== "unknown" ? event.team : outcome.team;
          const rivalTeam = affectedTeam === "home" ? "away" : "home";
          const impactWindow = events.filter((row)=>row.min > outcome.min && row.min <= outcome.min + 8);
          const rivalGoal = impactWindow.some((row)=>row.team===rivalTeam && (row.microEvents || []).some((m)=>m.type === "goal"));
          if(rivalGoal) impact *= 1.3;
          const prevAttacks = attackCountBeforeMinute(affectedTeam, outcome.min);
          const nextAttacks = impactWindow.reduce((acc, row)=>{
            if(row.team !== affectedTeam) return acc;
            const wTypes = new Set((row.microEvents || []).map((m)=>m.type));
            return acc + (Array.from(RELATO_OFFENSIVE_TYPES).some((type)=>wTypes.has(type)) ? 1 : 0);
          }, 0);
          if(prevAttacks > 0 && nextAttacks < Math.max(1, prevAttacks * 0.25)) impact *= 1.2;
          pushRelatoTagHit(tags, "var_turning_point", impact, outcome.min, "La revisión VAR cambió el rumbo del partido", `${event.raw} → ${outcome.raw}`);
        }
      }
    });

    if(tags.setpiece_threat && tags.wasted_setpieces){
      const threatMins = new Set((tags.setpiece_threat.mins || []).map((m)=>Number(m)));
      tags.wasted_setpieces.mins = (tags.wasted_setpieces.mins || []).filter((m)=>!threatMins.has(Number(m)));
      Object.keys(tags.wasted_setpieces.minuteScore || {}).forEach((m)=>{ if(threatMins.has(Number(m))) delete tags.wasted_setpieces.minuteScore[m]; });
      if(!tags.wasted_setpieces.mins.length) delete tags.wasted_setpieces;
    }
    if(tags.finishing_failure && tags.keeper_heroics){
      tags.keeper_heroics.score *= 0.8;
      Object.keys(tags.keeper_heroics.minuteScore || {}).forEach((m)=>{ tags.keeper_heroics.minuteScore[m] *= 0.8; });
    }

    return Object.values(tags)
      .map((tag)=>{
        const score = Number(tag.score) || 0;
        const raw = score / (score + 8);
        const strength = Math.sqrt(clamp(raw, 0, 1));
        const mins = Object.entries(tag.minuteScore || {})
          .map(([min, contribution])=>({ min: clamp(Number(min) || 0, 0, 140), contribution: Number(contribution) || 0 }))
          .sort((a,b)=>b.contribution-a.contribution)
          .slice(0, 12)
          .map((row)=>row.min)
          .filter((v, idx, arr)=>arr.indexOf(v)===idx)
          .sort((a,b)=>a-b);
        return {
          tagId: tag.tagId,
          label: tag.label,
          strength: Number(strength.toFixed(2)),
          group: RELATO_MODIFIER_TAGS.has(tag.tagId) ? "modifier" : (RELATO_CORE_TAGS.has(tag.tagId) ? "core" : "core"),
          mins,
          reason: tag.reason || "Patrón detectado en el relato",
          evidence: tag.evidence.slice(0, 5)
        };
      })
      .sort((a,b)=>b.strength-a.strength)
      .slice(0, 6);
  }

  function buildBrainV2MatchSummary({ row, teamName, opponentName }){
    const events = parseBrainV2Events(row?.narrative || "", teamName, opponentName);
    const home = { danger: 0, big_chance: 0, shot: 0, save: 0, corner: 0, yellow: 0, red: 0, goal: 0 };
    const away = { danger: 0, big_chance: 0, shot: 0, save: 0, corner: 0, yellow: 0, red: 0, goal: 0 };
    const momentumByPhase = Object.fromEntries(BRAIN_V2_PHASES.map((phase)=>[phase.key, 0]));
    const dangerWeight = { shot: 1.2, big_chance: 2.1, goal: 2.6, corner: 0.8, pressure: 1, save: 1.2 };
    events.forEach((event)=>{
      const box = event.team === "away" ? away : home;
      if(event.type in box) box[event.type] += 1;
      box.danger += (event.quality * (dangerWeight[event.type] || 0.7));
      const phaseSwing = event.quality * (event.team === "home" ? 1 : -1) * (event.type === "goal" ? 2 : 1);
      momentumByPhase[event.phase] = (momentumByPhase[event.phase] || 0) + phaseSwing;
    });
    const finalScore = String(row?.score || "0-0");
    const scoreHit = finalScore.match(/(\d+)\s*[-:]\s*(\d+)/);
    const homeGoals = scoreHit ? Number(scoreHit[1]) : home.goal;
    const awayGoals = scoreHit ? Number(scoreHit[2]) : away.goal;
    home.goal = homeGoals;
    away.goal = awayGoals;
    const outcome = homeGoals>awayGoals ? "homeWin" : homeGoals<awayGoals ? "awayWin" : "draw";
    const reasons = buildBrainV2ReasonTags({ events, home, away, momentumByPhase, narrativeRaw: row?.narrative || "", teamName, opponentName });
    return {
      matchId: row?.id || uid("b2sum"),
      homeTeam: teamName || "Local",
      awayTeam: opponentName || "Rival",
      finalScore,
      outcome,
      features: {
        danger: { home: Math.round(home.danger * 10), away: Math.round(away.danger * 10) },
        bigChances: { home: home.big_chance, away: away.big_chance },
        shots: { home: home.shot, away: away.shot },
        saves: { home: home.save, away: away.save },
        corners: { home: home.corner, away: away.corner },
        discipline: { homeY: home.yellow, awayY: away.yellow, homeR: home.red, awayR: away.red },
        pressureLate: {
          home: Math.round(events.filter((e)=>e.team==="home" && e.minute>=80).reduce((acc, e)=>acc + e.quality * 4, 0)),
          away: Math.round(events.filter((e)=>e.team==="away" && e.minute>=80).reduce((acc, e)=>acc + e.quality * 4, 0))
        },
        momentumByPhase: Object.fromEntries(Object.entries(momentumByPhase).map(([k,v])=>[k, Math.round(v)])),
        efficiency: {
          homeGoalsPerBigChance: home.big_chance ? Number((homeGoals / home.big_chance).toFixed(2)) : 0,
          awayGoalsPerBigChance: away.big_chance ? Number((awayGoals / away.big_chance).toFixed(2)) : 0
        }
      },
      reasons,
      story: buildBrainV2Story({ teamName, opponentName, outcome, finalScore, reasons })
    };
  }

  function ensureBrainV2RowSummary(row, teamName = "Local"){
    if(!row || typeof row !== "object") return buildBrainV2MatchSummary({ row: {}, teamName, opponentName: "Rival" });
    if(!row.summary || typeof row.summary !== "object"){
      row.summary = buildBrainV2MatchSummary({
        row,
        teamName: row?.teamName || teamName || "Local",
        opponentName: row?.opponent || "Rival"
      });
      return row.summary;
    }
    row.summary.reasons = Array.isArray(row.summary.reasons) ? row.summary.reasons : [];
    row.summary.story = String(row.summary.story || "");
    if(!row.summary.reasons.length || !row.summary.story){
      const rebuilt = buildBrainV2MatchSummary({
        row,
        teamName: row?.teamName || teamName || "Local",
        opponentName: row?.opponent || "Rival"
      });
      row.summary = { ...rebuilt, ...row.summary, reasons: row.summary.reasons.length ? row.summary.reasons : rebuilt.reasons, story: row.summary.story || rebuilt.story };
    }
    return row.summary;
  }

  function buildBrainV2ReasonTags({ events = [], home = {}, away = {}, momentumByPhase = {}, narrativeRaw = "", teamName = "Local", opponentName = "Rival" }){
    const autoTags = buildRelatoTags(narrativeRaw, teamName, opponentName);
    const reasons = autoTags.map((tag)=>({ tag: tag.tagId, tagId: tag.tagId, label: tag.label, strength: tag.strength, mins: tag.mins, evidence: tag.evidence, note: tag.reason, group: tag.group || (RELATO_MODIFIER_TAGS.has(tag.tagId) ? "modifier" : (RELATO_CORE_TAGS.has(tag.tagId) ? "core" : "core")), auto: true }));
    const pushReason = (tag, metric, threshold, scale, note, evidence=[] )=>{
      const score = clamp((metric - threshold) / Math.max(scale, 0.01), 0, 1) * 8;
      const strength = Math.sqrt(score / (score + 8));
      if(strength>0){
        reasons.push({ tag, tagId: tag, label: RELATO_TAG_LABELS[tag] || tag, strength: Number(strength.toFixed(2)), mins: evidence.slice(0, 5), evidence: evidence.slice(0, 4), note, group: RELATO_MODIFIER_TAGS.has(tag) ? "modifier" : (RELATO_CORE_TAGS.has(tag) ? "core" : "core") });
      }
    };
    const lateOffensive = events.filter((e)=>e.team==="home" && e.minute>=80 && RELATO_OFFENSIVE_TYPES.has(e.type));
    const homeSaves = events.filter((e)=>e.team==="away" && e.type==="save" && e.quality>=0.55);
    pushReason("keeper_heroics", homeSaves.length, 1, 2, "Paradas clave cambiaron el marcador", homeSaves.map((e)=>e.minute));
    pushReason("late_pressure", lateOffensive.length, 2, 4, "Cierre fuerte con ocasiones al final", lateOffensive.map((e)=>e.minute));
    pushReason("big_chances_advantage", home.big_chance - away.big_chance, 0.5, 3, "Ventaja en chances claras", events.filter((e)=>e.type==="big_chance").map((e)=>e.minute));
    pushReason("finishing_edge", (home.goal / Math.max(1, home.big_chance)) - (away.goal / Math.max(1, away.big_chance)), 0.05, 0.6, "Mejor definición de cara al gol", events.filter((e)=>e.type==="goal").map((e)=>e.minute));
    pushReason("momentum_control", Object.values(momentumByPhase).reduce((acc, v)=>acc + Number(v), 0), 1, 8, "Dominio territorial por fases", Object.entries(momentumByPhase).filter(([,v])=>v>0).map(([phase])=>BRAIN_V2_PHASES.find((p)=>p.key===phase)?.max || 0));
    return reasons
      .sort((a,b)=>b.strength-a.strength)
      .slice(0, 6)
      .map((reason)=>({
        ...reason,
        phaseCounts: reason.phaseCounts || buildPhaseCountsFromMinutes(reason.mins || [])
      }));
  }

  function buildBrainV2Story({ teamName, opponentName, outcome, finalScore, reasons = [] }){
    const resultText = outcome === "homeWin" ? `${teamName} ganó ${finalScore}` : outcome === "awayWin" ? `${teamName} perdió ${finalScore}` : `${teamName} empató ${finalScore}`;
    const top = reasons.slice(0, 2).map((item)=>item.note.toLowerCase());
    if(!top.length) return `${resultText} en un partido con señales equilibradas.`;
    return `${resultText} porque ${top.join(" y ")}.`;
  }

  function buildTeamNarrativeProfileFromMemories(rows = []){
    const list = (Array.isArray(rows) ? rows : []).slice(-20);
    const phaseKeys = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90"];
    const emptyPhaseDNA = {
      finishing_failure: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      territorial_pressure: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      momentum_control: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      counter_strike: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      setpiece_threat: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      wasted_setpieces: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      late_pressure: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      keeper_heroics: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      discipline_issues: Object.fromEntries(phaseKeys.map((key)=>[key, 0])),
      var_turning_point: Object.fromEntries(phaseKeys.map((key)=>[key, 0]))
    };
    if(!list.length){
      return {
        lastN: 0,
        tendencies: { latePressureAvg: 0, setPieceDependence: 0, keeperImpactRate: 0, disciplineCostRate: 0, finishingEfficiency: 0, momentumVolatility: 0 },
        reasonTagRates: {},
        phaseDNA: emptyPhaseDNA
      };
    }
    const reasonHits = {};
    const phaseDNA = JSON.parse(JSON.stringify(emptyPhaseDNA));
    const agg = list.reduce((acc, row)=>{
      const sum = row?.summary || buildBrainV2MatchSummary({ row, teamName: row?.teamName || "Local", opponentName: row?.opponent || "Rival" });
      const f = sum?.features || {};
      acc.latePressure += Number(f?.pressureLate?.home) || 0;
      acc.setPiece += Number(f?.corners?.home) || 0;
      acc.keeper += (sum?.reasons || []).some((r)=>r.tag === "keeper_heroics" || r.tag === "keeper_impact") ? 1 : 0;
      acc.discipline += ((Number(f?.discipline?.homeY) || 0) + ((Number(f?.discipline?.homeR) || 0) * 2));
      acc.finishing += Number(f?.efficiency?.homeGoalsPerBigChance) || 0;
      const momentVals = Object.values(f?.momentumByPhase || {}).map(Number).filter(Number.isFinite);
      const vol = momentVals.length ? stdDev(momentVals) : 0;
      acc.volatility += vol;
      (sum?.reasons || []).forEach((r)=>{
        reasonHits[r.tag] = (reasonHits[r.tag] || 0) + 1;
        const targetTag = r.tag in phaseDNA ? r.tag : null;
        if(!targetTag) return;
        const counts = r.phaseCounts && typeof r.phaseCounts === "object"
          ? r.phaseCounts
          : buildPhaseCountsFromMinutes(r.mins || []);
        phaseKeys.forEach((phase)=>{
          phaseDNA[targetTag][phase] = (Number(phaseDNA[targetTag][phase]) || 0) + (Number(counts[phase]) || 0);
        });
      });
      return acc;
    }, { latePressure: 0, setPiece: 0, keeper: 0, discipline: 0, finishing: 0, volatility: 0 });
    const n = list.length;
    const reasonTagRates = Object.fromEntries(Object.entries(reasonHits).map(([k,v])=>[k, Number((v/n).toFixed(2))]));
    Object.keys(phaseDNA).forEach((tag)=>{
      const total = phaseKeys.reduce((acc, phase)=>acc + (Number(phaseDNA[tag][phase]) || 0), 0);
      phaseKeys.forEach((phase)=>{
        const value = Number(phaseDNA[tag][phase]) || 0;
        phaseDNA[tag][phase] = Number((total > 0 ? value / total : 0).toFixed(3));
      });
    });
    return {
      lastN: n,
      tendencies: {
        latePressureAvg: Number((agg.latePressure / n).toFixed(2)),
        setPieceDependence: Number((agg.setPiece / Math.max(1, n*10)).toFixed(2)),
        keeperImpactRate: Number((agg.keeper / n).toFixed(2)),
        disciplineCostRate: Number((agg.discipline / Math.max(1, n*5)).toFixed(2)),
        finishingEfficiency: Number((agg.finishing / n).toFixed(2)),
        momentumVolatility: Number((agg.volatility / n).toFixed(2))
      },
      reasonTagRates,
      phaseDNA
    };
  }


  const MNE_PHASE_PRIORS = {
    "0-15": { title: "Arranque y tanteo", bullets: ["Inicio de presión y control territorial", "Primeras señales de ABP y ritmo"] },
    "15-30": { title: "Primer ajuste de plan", bullets: ["El partido entra en patrón táctico", "Aparece la primera oleada real de peligro"] },
    "30-45": { title: "Empuje antes del descanso", bullets: ["Fatiga leve y valor de pelota parada", "Últimos ataques antes del descanso"] },
    "45-60": { title: "Reinicio intenso", bullets: ["Ajustes tras descanso", "Ritmo más agresivo durante 15 minutos"] },
    "60-75": { title: "Ventana de cambios", bullets: ["Ingresos alteran la estructura", "Sube la probabilidad de gol por espacios"] },
    "75-90": { title: "Cierre emocional", bullets: ["Presión final y nervios", "Faltas y ABP toman protagonismo"] }
  };

  const MNE_SCENE_LIBRARY = [
    { id: "balanced_start", phaseAffinity: ["0-15", "15-30"], side: "neutral", title: "Inicio equilibrado", producesTags: ["momentum_control"], requiredSignals: [({ home, away })=>Math.abs((home.danger_index||0) - (away.danger_index||0)) < 1.2], liveTriggers: [{ if: "early danger diff < 1.2", then: "use balanced_start over away/home accelerate", weight: 0.2 }] },
    { id: "home_early_push", phaseAffinity: ["0-15", "15-30"], side: "home", title: "Arranque de control local", producesTags: ["territorial_pressure", "setpiece_threat"], requiredSignals: [({ home })=>home.control > 58, ({ home })=>home.dna.territorial_pressure > 0.2], liveTriggers: [{ if: "home corners >= 3 by 20'", then: "boost setpiece_threat narrative", weight: 0.12 }] },
    { id: "away_early_push", phaseAffinity: ["0-15", "15-30"], side: "away", title: "Visitante acelera de inicio", producesTags: ["territorial_pressure"], requiredSignals: [({ away })=>away.control > 55, ({ away })=>away.attack_production > 50], liveTriggers: [{ if: "away possession >= 53% by 15'", then: "territorial_pressure away gains confidence", weight: 0.1 }] },
    { id: "away_counter_threat", phaseAffinity: ["15-30", "45-60", "60-75"], side: "away", title: "Riesgo de contra visitante", producesTags: ["counter_strike"], requiredSignals: [({ away })=>away.dna.counter_strike > 0.18, ({ home })=>home.control > 55], liveTriggers: [{ if: "away shotsOT >= 2 by 30'", then: "counter_strike becomes primary", weight: 0.15 }] },
    { id: "home_counter_threat", phaseAffinity: ["15-30", "45-60", "60-75"], side: "home", title: "Golpe local en transición", producesTags: ["counter_strike"], requiredSignals: [({ home })=>home.dna.counter_strike > 0.16, ({ away })=>away.control > 55], liveTriggers: [{ if: "home recoveries high + 1 shotOT by 35'", then: "home counter_strike rises", weight: 0.11 }] },
    { id: "finishing_crisis_home", phaseAffinity: ["30-45", "45-60", "60-75", "75-90"], side: "home", title: "Crisis de definición local", producesTags: ["finishing_failure"], requiredSignals: [({ home })=>home.dna.finishing_failure > 0.22, ({ home })=>home.attack_production > 52], liveTriggers: [{ if: "home bigChances >= 2 and goals == 0 by 60'", then: "boost finishing_failure", weight: 0.12 }] },
    { id: "finishing_crisis_away", phaseAffinity: ["30-45", "45-60", "60-75", "75-90"], side: "away", title: "Crisis de definición visitante", producesTags: ["finishing_failure"], requiredSignals: [({ away })=>away.dna.finishing_failure > 0.22, ({ away })=>away.attack_production > 48], liveTriggers: [{ if: "away bigChances >= 2 and goals == 0 by 60'", then: "boost finishing_failure away", weight: 0.12 }] },
    { id: "late_siege_home", phaseAffinity: ["75-90"], side: "home", title: "Asedio final local", producesTags: ["late_pressure", "setpiece_threat"], requiredSignals: [({ home })=>home.dna.late_pressure > 0.2], liveTriggers: [{ if: "home corners >= 5 by 80'", then: "late_siege confidence +0.10", weight: 0.1 }] },
    { id: "setpiece_battle", phaseAffinity: ["30-45", "60-75", "75-90"], side: "neutral", title: "Batalla de balón parado", producesTags: ["setpiece_threat", "wasted_setpieces"], requiredSignals: [({ home, away })=>(home.setpiece_strength + away.setpiece_strength) > 105], liveTriggers: [{ if: "combined corners >= 8 by 70'", then: "setpiece_battle takes over", weight: 0.1 }] }
  ];

  function buildMneMetrics(summary = {}, profile = {}){
    const avg = summary?.avg || {};
    const rate = profile?.reasonTagRates || {};
    const tendencies = profile?.tendencies || {};
    const get = (keys = [], fallback = 0)=>{
      for(const key of keys){
        const value = Number(avg[key]);
        if(Number.isFinite(value) && value !== 0) return value;
      }
      return fallback;
    };
    return {
      attack_production: clamp((get(["xg"], 1.1) * 28) + (get(["shots"], 10) * 2.2), 0, 100),
      attack_conversion: clamp((tendencies.finishingEfficiency || 0.3) * 100, 0, 100),
      defense_stability: clamp(100 - (get(["xga", "xg_against"], 1.2) * 24) - (Number(tendencies.momentumVolatility) || 0) * 14, 0, 100),
      control: clamp(get(["possession"], 50), 0, 100),
      setpiece_strength: clamp((get(["corners"], 4.5) * 10) + ((tendencies.setPieceDependence || 0) * 28), 0, 100),
      discipline: clamp(100 - ((tendencies.disciplineCostRate || 0) * 95), 0, 100),
      danger_index: Number((
        1.2 * get(["shots_on_target", "shotsOnTarget"], get(["shots"], 10) * 0.34) +
        0.7 * get(["big_chances", "bigChances"], get(["xg"], 1.1) * 1.15) +
        0.35 * get(["shots"], 10) +
        0.25 * get(["corners"], 4.5) -
        0.6 * ((tendencies.disciplineCostRate || 0) * 3)
      ).toFixed(2)),
      dna: {
        finishing_failure: clamp01(rate.finishing_failure || 0),
        territorial_pressure: clamp01(rate.territorial_pressure || 0),
        momentum_control: clamp01(rate.momentum_control || 0),
        counter_strike: clamp01(rate.counter_strike || 0),
        setpiece_threat: clamp01(rate.setpiece_threat || 0),
        wasted_setpieces: clamp01(rate.wasted_setpieces || 0),
        late_pressure: clamp01(rate.late_pressure || 0),
        keeper_heroics: clamp01(rate.keeper_heroics || 0),
        discipline_issues: clamp01(rate.discipline_issues || 0),
        var_turning_point: clamp01(rate.var_turning_point || 0)
      },
      phaseDNA: profile?.phaseDNA || {}
    };
  }

  function buildMatchNarrativeEngine({ homeMetrics, awayMetrics, styleClashes = [], sampleSize = 0, homeTeamId = "", awayTeamId = "", mneLearning = null }){
    const sceneWeights = mneLearning?.sceneWeights || {};
    const triggerWeights = mneLearning?.triggerWeights || {};
    const phases = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90"];
    const sceneBoosts = {};
    styleClashes.forEach((clash)=>{
      if(clash === "away_transition_window") sceneBoosts.away_counter_threat = (sceneBoosts.away_counter_threat || 0) + 0.8;
      if(clash === "home_transition_window") sceneBoosts.home_counter_threat = (sceneBoosts.home_counter_threat || 0) + 0.8;
      if(clash === "home_sterile_risk") sceneBoosts.finishing_crisis_home = (sceneBoosts.finishing_crisis_home || 0) + 0.7;
      if(clash === "away_sterile_risk") sceneBoosts.finishing_crisis_away = (sceneBoosts.finishing_crisis_away || 0) + 0.7;
    });
    const evalCtx = { home: homeMetrics, away: awayMetrics };
    const narrative = phases.map((phase)=>{
      const ranked = MNE_SCENE_LIBRARY
        .filter((scene)=>scene.phaseAffinity.includes(phase))
        .map((scene)=>{
          const conditionsMet = (scene.requiredSignals || []).reduce((acc, fn)=>acc + (fn(evalCtx) ? 1 : 0), 0);
          const affinity = (scene.producesTags || []).reduce((acc, tag)=>{
            const homeW = Number(homeMetrics.phaseDNA?.[tag]?.[phase]) || 0;
            const awayW = Number(awayMetrics.phaseDNA?.[tag]?.[phase]) || 0;
            return acc + Math.max(homeW, awayW) * 2;
          }, 0);
          const sideBonus = scene.side === "home" ? 0.25 : scene.side === "away" ? 0.2 : 0.18;
          const earlyBalanceBoost = scene.id === "balanced_start" && (phase === "0-15" || phase === "15-30")
            ? (Math.abs((homeMetrics.danger_index||0) - (awayMetrics.danger_index||0)) < 1.2 ? 0.55 : -0.35)
            : 0;
          const teamSceneWeights = scene.side === "away"
            ? (sceneWeights[awayTeamId] || {})
            : scene.side === "home"
              ? (sceneWeights[homeTeamId] || {})
              : {};
          const learnedWeight = Number(teamSceneWeights[scene.id]) || 0;
          const base = conditionsMet + affinity + sideBonus + earlyBalanceBoost + (sceneBoosts[scene.id] || 0) + learnedWeight;
          return { scene, score: base };
        })
        .sort((a,b)=>b.score-a.score);
      const top = ranked.slice(0, 2);
      const score = top.reduce((acc, item)=>acc + item.score, 0);
      const raw = score / (score + 4);
      const confidenceScale = Number(mneLearning?.confidenceScale) || 1;
      const confidence = clamp(Math.sqrt(raw) * confidenceScale, 0.08, 0.95);
      const tags = [...new Set(top.flatMap((item)=>item.scene.producesTags || []))];
      const notes = [...(MNE_PHASE_PRIORS[phase]?.bullets || []), ...top.map((item)=>item.scene.title)].slice(0, 2);
      return {
        phase,
        title: top[0]?.scene?.title || MNE_PHASE_PRIORS[phase]?.title || "Fase en observación",
        confidence: Number(confidence.toFixed(2)),
        tags,
        notes,
        confidenceMeta: {
          N: sampleSize,
          completeness: Number(clamp(sampleSize / 20, 0.2, 1).toFixed(2)),
          lowConfidence: sampleSize < 10,
          signalsUsed: ["control", "counter_strike", "late_pressure", "setpiece_threat"],
          scenes: top.map((item)=>item.scene.id)
        }
      };
    });

    const keyRisks = [
      { tag: "finishing_failure", side: homeMetrics.dna.finishing_failure >= awayMetrics.dna.finishing_failure ? "home" : "away", impact: "reduce goles", confidence: Number(Math.max(homeMetrics.dna.finishing_failure, awayMetrics.dna.finishing_failure).toFixed(2)) },
      { tag: "discipline_issues", side: homeMetrics.dna.discipline_issues >= awayMetrics.dna.discipline_issues ? "home" : "away", impact: "ABP peligrosas", confidence: Number(Math.max(homeMetrics.dna.discipline_issues, awayMetrics.dna.discipline_issues).toFixed(2)) },
      { tag: "counter_strike", side: homeMetrics.dna.counter_strike >= awayMetrics.dna.counter_strike ? "home" : "away", impact: "transiciones que cambian el guion", confidence: Number(Math.max(homeMetrics.dna.counter_strike, awayMetrics.dna.counter_strike).toFixed(2)) }
    ].sort((a,b)=>b.confidence-a.confidence).slice(0, 3);

    const liveTriggers = MNE_SCENE_LIBRARY
      .flatMap((scene)=>(scene.liveTriggers || []).map((trigger)=>{
        const triggerId = `${scene.id}:${trigger.if}`;
        const learnedDelta = Number(triggerWeights[triggerId]) || 0;
        return { ...trigger, sceneId: scene.id, weight: Number((Number(trigger.weight || 0) + learnedDelta).toFixed(3)) };
      }))
      .sort((a,b)=>(Number(b.weight)||0)-(Number(a.weight)||0))
      .slice(0, 3);

    return { narrative, keyRisks, liveTriggers };
  }

  function buildMnePhasePrediction({ matchId = "", phaseData = {} } = {}){
    const phase = String(phaseData?.phase || "0-15");
    const tags = Array.isArray(phaseData?.tags) ? phaseData.tags.slice(0, 3) : [];
    const confidence = clamp(Number(phaseData?.confidence) || 0, 0, 1);
    const weightedTags = {};
    tags.forEach((tag, idx)=>{
      const rankWeight = idx === 0 ? 1 : idx === 1 ? 0.82 : 0.66;
      weightedTags[tag] = Number(clamp(confidence * rankWeight, 0, 1).toFixed(2));
    });
    return {
      matchId,
      phase,
      predicted: {
        tags: weightedTags,
        sceneId: phaseData?.confidenceMeta?.scenes?.[0] || null,
        confidence: Number(confidence.toFixed(2))
      }
    };
  }

  function buildObservedPhaseFromNarrative({ matchId = "", phase = "0-15", narrativeRaw = "", homeTeam = "Local", awayTeam = "Rival", baseTerritorialDiff = 0 } = {}){
    const [start, end] = String(phase || "0-15").split("-").map((v)=>Number(v) || 0);
    const events = classifyRelatoMicroEvents(parseRelatoEvents(narrativeRaw, homeTeam, awayTeam))
      .filter((evt)=>Number(evt.min) >= start && Number(evt.min) <= Math.max(start, end));
    const counts = {
      shot: 0,
      shot_on_target: 0,
      miss: 0,
      big_chance: 0,
      goal: 0,
      corner: 0,
      freekick: 0,
      foul: 0,
      yellow: 0,
      red: 0,
      var_review: 0,
      var_overturn: 0,
      penalty_awarded: 0,
      penalty_cancelled: 0,
      possession_control: 0
    };
    const teamTags = {
      home: { shot: 0, shot_on_target: 0, goal: 0, corner: 0 },
      away: { shot: 0, shot_on_target: 0, goal: 0, corner: 0 }
    };
    events.forEach((evt)=>{
      (evt.microEvents || []).forEach((item)=>{
        const type = String(item?.type || "");
        if(type === "shot_attempt"){
          counts.shot += 1;
          if(evt.team === "home" || evt.team === "away") teamTags[evt.team].shot += 1;
        }
        if(type in counts) counts[type] += 1;
        if((type === "corner" || type === "shot_on_target" || type === "goal") && (evt.team === "home" || evt.team === "away")){
          teamTags[evt.team][type] += 1;
        }
      });
    });
    const territorialPressure = clamp(0.20*counts.possession_control + 0.25*counts.corner + 0.25*counts.shot + 0.30*counts.shot_on_target, 0, 1);
    const setpieceThreat = clamp((0.60*counts.corner + 0.40*counts.freekick) / 3, 0, 1);
    const finishingFailure = clamp((counts.shot + counts.big_chance) - counts.goal, 0, 6) / 6;
    const hintCounter = /contraataque|transici[oó]n/.test(String(narrativeRaw || "").toLowerCase()) ? 1 : 0;
    let counterStrike = 0;
    if(counts.goal > 0 && Number(baseTerritorialDiff) < -0.05) counterStrike = 1;
    else counterStrike = clamp(hintCounter * 0.35, 0, 0.4);
    return {
      matchId,
      phase,
      observed: {
        tags: {
          shot: counts.shot,
          shot_on_target: counts.shot_on_target,
          miss: counts.miss,
          big_chance: counts.big_chance,
          goal: counts.goal,
          corner: counts.corner,
          freekick: counts.freekick,
          foul: counts.foul,
          yellow: counts.yellow,
          red: counts.red,
          var_review: counts.var_review,
          var_overturn: counts.var_overturn,
          penalty_awarded: counts.penalty_awarded,
          penalty_cancelled: counts.penalty_cancelled,
          possession_control: counts.possession_control
        },
        derivedTags: {
          territorial_pressure: Number(territorialPressure.toFixed(2)),
          setpiece_threat: Number(setpieceThreat.toFixed(2)),
          finishing_failure: Number(finishingFailure.toFixed(2)),
          counter_strike: Number(counterStrike.toFixed(2)),
          discipline_issues: Number(clamp((counts.foul + counts.yellow + counts.red*2) / 6, 0, 1).toFixed(2)),
          var_turning_point: Number(clamp((counts.var_review + counts.penalty_cancelled + counts.var_overturn) / 3, 0, 1).toFixed(2))
        },
        teamTags,
        evidence: {
          events: events.length,
          dangerIndexHome: Number(clamp((teamTags.home.shot_on_target||0)*0.45 + (teamTags.home.goal||0)*0.8 + (teamTags.home.corner||0)*0.2 + counts.big_chance*0.25, 0, 3).toFixed(2)),
          dangerIndexAway: Number(clamp((teamTags.away.shot_on_target||0)*0.45 + (teamTags.away.goal||0)*0.8 + (teamTags.away.corner||0)*0.2 + counts.var_review*0.15, 0, 3).toFixed(2))
        }
      },
      narrativeRaw: String(narrativeRaw || "")
    };
  }

  function compareMnePredictionVsReality(prediction = {}, observation = {}){
    const predictedTags = Object.entries(prediction?.predicted?.tags || {}).sort((a,b)=>(Number(b[1])||0)-(Number(a[1])||0)).slice(0, 3);
    const observedDerived = observation?.observed?.derivedTags || {};
    const observedTop = Object.entries(observedDerived).sort((a,b)=>(Number(b[1])||0)-(Number(a[1])||0)).slice(0, 3);
    const observedSet = new Set(observedTop.filter(([,v])=>Number(v)>=0.25).map(([k])=>k));
    const hits = predictedTags.filter(([tag])=>Number(observedDerived[tag]) >= 0.25);
    const top3ObservedCount = Math.max(1, observedSet.size);
    const precision = hits.length / 3;
    const recall = hits.length / top3ObservedCount;
    const phaseTruthScore = predictedTags.length
      ? predictedTags.reduce((acc, [tag])=>acc + (Number(observedDerived[tag]) || 0), 0) / predictedTags.length
      : 0;
    const calError = (Number(prediction?.predicted?.confidence) || 0) - phaseTruthScore;
    const surprise = observedTop.reduce((acc, [tag, val])=>acc + Math.max(0, (Number(val) || 0) - (Number(prediction?.predicted?.tags?.[tag]) || 0)), 0);
    return {
      hits: hits.map(([tag])=>tag),
      misses: predictedTags.map(([tag])=>tag).filter((tag)=>!hits.some(([hit])=>hit===tag)),
      surprises: observedTop.filter(([tag, val])=>(Number(val) || 0) > (Number(prediction?.predicted?.tags?.[tag]) || 0)).map(([tag])=>tag),
      metrics: {
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        phaseTruthScore: Number(phaseTruthScore.toFixed(3)),
        calibrationError: Number(calError.toFixed(3)),
        surprise: Number(clamp(surprise, 0, 3).toFixed(3))
      }
    };
  }

  function lsfSoftmax(scores = [], temp = 1){
    const t = Math.max(0.0001, Number(temp) || 1);
    const maxV = Math.max(...scores);
    const exps = scores.map((v)=>Math.exp((Number(v) - maxV) / t));
    const sum = Math.max(0.0001, exps.reduce((acc, val)=>acc + val, 0));
    return exps.map((v)=>v / sum);
  }

  const ORCHESTRATOR_ENGINES = ["MNE", "MCE", "MRE", "GPE", "LSF", "Emotional", "PostGoal"];

  function normalizeOrchestratorWeights(raw = {}){
    const seed = { MNE: 0.2, MCE: 0.18, MRE: 0.16, GPE: 0.14, LSF: 0.2, Emotional: 0.08, PostGoal: 0.04 };
    const out = {};
    ORCHESTRATOR_ENGINES.forEach((engine)=>{ out[engine] = Math.max(0, Number(raw?.[engine] ?? seed[engine])); });
    const sum = ORCHESTRATOR_ENGINES.reduce((acc, engine)=>acc + out[engine], 0) || 1;
    ORCHESTRATOR_ENGINES.forEach((engine)=>{ out[engine] = Number((out[engine] / sum).toFixed(4)); });
    return out;
  }

  function applyDynamicWeights(baseWeights = {}, modifiers = {}){
    const next = {};
    ORCHESTRATOR_ENGINES.forEach((engine)=>{
      next[engine] = Math.max(0.001, (Number(baseWeights?.[engine]) || 0) + (Number(modifiers?.[engine]) || 0));
    });
    return normalizeOrchestratorWeights(next);
  }

  function applyEngineLearningBias(weights = {}, learnedBias = {}){
    const adjusted = {};
    ORCHESTRATOR_ENGINES.forEach((engine)=>{
      const w = Number(weights?.[engine]) || 0;
      const bias = clamp(Number(learnedBias?.[engine]) || 0, -0.10, 0.10);
      adjusted[engine] = Math.max(0.001, w * (1 + bias));
    });
    return normalizeOrchestratorWeights(adjusted);
  }

  function computeOrchestratorStateModifiers(matchState = {}){
    const out = { MNE: 0, MCE: 0, MRE: 0, GPE: 0, LSF: 0, Emotional: 0, PostGoal: 0 };
    const goalDiff = (Number(matchState.homeGoals) || 0) - (Number(matchState.awayGoals) || 0);
    if(Math.abs(goalDiff) >= 2){ out.LSF += 0.12; out.MNE -= 0.06; out.MCE -= 0.03; }
    if(String(matchState.tempo || "").toLowerCase() === "high"){ out.LSF += 0.08; out.MNE += 0.03; }
    if(Boolean(matchState.chaosDetected)){ out.Emotional += 0.08; out.GPE += 0.05; out.LSF += 0.05; }
    if((Number(matchState.dominanceHome) || 0) > 0.65 || (Number(matchState.dominanceAway) || 0) > 0.65){ out.MNE += 0.06; out.MCE += 0.04; }
    const balanced = Math.abs((Number(matchState.dominanceHome) || 0) - (Number(matchState.dominanceAway) || 0)) < 0.08;
    const lowEvents = (Number(matchState.liveEventsCount) || 0) < 4;
    if(balanced && lowEvents){ out.MCE += 0.05; out.MRE += 0.04; out.LSF -= 0.05; }
    return out;
  }

  function computeLiveEvidenceStrength(liveState = {}){
    const raw =
      0.15 * Math.min((Number(liveState.liveEventsCount) || 0) / 10, 1) +
      0.20 * Math.min(((Number(liveState.shots) || 0) + (Number(liveState.corners) || 0)) / 12, 1) +
      0.20 * Math.min((Number(liveState.shotsOT) || 0) / 4, 1) +
      0.20 * (liveState.hasGoal ? 1 : 0) +
      0.15 * ((liveState.hasRed || liveState.hasVar) ? 1 : 0) +
      0.10 * clamp(Number(liveState.completeness) || 0, 0, 1);
    const score = clamp(raw, 0, 1);
    return { score: Number(score.toFixed(3)), label: score < 0.35 ? "weak" : score < 0.65 ? "moderate" : "strong" };
  }

  function computeEmotionalImpactScore(events = [], windowMinutes = 5){
    const list = Array.isArray(events) ? events : [];
    const maxMinute = Math.max(0, ...list.map((e)=>Number(e?.minute) || 0));
    const windowStart = maxMinute - Math.max(1, Number(windowMinutes) || 5);
    const recent = list.filter((e)=>{
      const minute = Number(e?.minute);
      return Number.isFinite(minute) && minute >= windowStart;
    });
    const count = (matcher)=>recent.filter(matcher).length;
    const goal = count((e)=>String(e?.type || "").includes("goal"));
    const bigChance = count((e)=>String(e?.type || "") === "big_chance");
    const redCard = count((e)=>String(e?.type || "") === "red");
    const yellows = count((e)=>String(e?.type || "") === "yellow");
    const fouls = count((e)=>String(e?.type || "") === "foul");
    const criticalSave = count((e)=>String(e?.type || "") === "save" && (Number(e?.quality) || 0) >= 0.75);
    const penaltyAwarded = count((e)=>String(e?.type || "") === "penalty_awarded");
    const varOverturn = count((e)=>["penalty_cancelled", "var_overturn"].includes(String(e?.type || "")));
    const missedBigChance = count((e)=>String(e?.type || "") === "missed_big_chance");
    const yellowCluster = yellows >= 2 ? 1 : 0;
    const foulCluster = fouls >= 3 ? 1 : 0;
    const score =
      1.0 * goal +
      0.7 * bigChance +
      1.2 * redCard +
      0.4 * yellowCluster +
      0.6 * criticalSave +
      0.85 * penaltyAwarded +
      0.95 * varOverturn +
      0.5 * missedBigChance +
      0.45 * foulCluster;
    const triggeredBy = [];
    if(goal) triggeredBy.push("goal");
    if(bigChance) triggeredBy.push("big_chance");
    if(redCard) triggeredBy.push("red_card");
    if(yellowCluster) triggeredBy.push("yellow_card_cluster");
    if(criticalSave) triggeredBy.push("critical_save");
    if(penaltyAwarded) triggeredBy.push("penalty_awarded");
    if(varOverturn) triggeredBy.push("penalty_cancelled_or_var_overturn");
    if(missedBigChance) triggeredBy.push("missed_big_chance");
    if(foulCluster) triggeredBy.push("foul_cluster");
    const level = score < 0.8 ? "low" : score < 1.4 ? "medium" : score < 2.2 ? "high" : "extreme";
    return { score: Number(score.toFixed(3)), level, triggeredBy, thresholdPassed: score >= 1.4 };
  }

  function computeMomentumScore(recentWindow = {}){
    const read = (side, key)=>Number(recentWindow?.[side]?.[key]) || 0;
    const calc = (side)=>
      0.30 * read(side, "corners") +
      0.40 * read(side, "shots") +
      0.60 * read(side, "bigChances") +
      0.50 * read(side, "shotsOT") +
      0.20 * read(side, "pressureEvents");
    const homeMomentum = calc("home");
    const awayMomentum = calc("away");
    const swing = Math.abs(homeMomentum - awayMomentum);
    const dominantSide = homeMomentum > awayMomentum * 1.25 ? "home" : awayMomentum > homeMomentum * 1.25 ? "away" : "none";
    const label = swing < 0.8 ? "flat" : swing < 1.8 ? "building" : "strong";
    return {
      homeMomentum: Number(homeMomentum.toFixed(3)),
      awayMomentum: Number(awayMomentum.toFixed(3)),
      dominantSide,
      swing: Number(swing.toFixed(3)),
      label
    };
  }

  function orchestrateBrainV2Decision(context = {}){
    const phase = String(context.phase || "60-90");
    const phaseBase = {
      "0-30": { MNE: 0.23, MCE: 0.2, MRE: 0.17, GPE: 0.16, LSF: 0.14, Emotional: 0.06, PostGoal: 0.04 },
      "30-60": { MNE: 0.21, MCE: 0.18, MRE: 0.16, GPE: 0.14, LSF: 0.2, Emotional: 0.07, PostGoal: 0.04 },
      "60-90": { MNE: 0.18, MCE: 0.16, MRE: 0.16, GPE: 0.13, LSF: 0.25, Emotional: 0.08, PostGoal: 0.04 }
    };
    const baseWeights = normalizeOrchestratorWeights(phaseBase[phase] || phaseBase["60-90"]);
    const momentum = computeMomentumScore(context.recentWindow);
    const emotional = computeEmotionalImpactScore(context.recentEvents, context.emotionalWindowMinutes || 5);
    const evidence = computeLiveEvidenceStrength(context.liveState);
    const matchState = { ...(context.matchState || {}), momentumHome: momentum.homeMomentum, momentumAway: momentum.awayMomentum, chaosDetected: context.matchState?.chaosDetected || emotional.thresholdPassed };
    const modifiers = computeOrchestratorStateModifiers(matchState);
    let weights = applyDynamicWeights(baseWeights, modifiers);
    weights = applyEngineLearningBias(weights, context.learnedBias || {});
    if(evidence.label === "weak"){
      weights.LSF = Math.min(weights.LSF, 0.18);
      if(weights.LSF >= Math.max(...Object.values(weights))) weights.MNE += 0.03;
      weights = normalizeOrchestratorWeights(weights);
    }
    const lsf = context.lsfForecast?.probs || { base: 1/3, trigger: 1/3, chaos: 1/3 };
    const momentumEdge = clamp((momentum.homeMomentum - momentum.awayMomentum) / 8, -0.18, 0.18);
    const chaosBoost = emotional.thresholdPassed ? 0.06 : 0;
    const probs = {
      home: clamp(0.33 + momentumEdge + (lsf.base - lsf.chaos) * 0.05, 0.05, 0.9),
      draw: clamp(0.34 - Math.abs(momentumEdge) * 0.45 - chaosBoost * 0.25, 0.05, 0.7),
      away: clamp(0.33 - momentumEdge + (lsf.chaos - lsf.base) * 0.05, 0.05, 0.9)
    };
    const norm = probs.home + probs.draw + probs.away || 1;
    probs.home /= norm; probs.draw /= norm; probs.away /= norm;
    const scenario = lsf.chaos >= lsf.trigger && lsf.chaos >= lsf.base ? "chaos" : lsf.trigger >= lsf.base ? "trigger" : "base";
    const confidence = clamp(0.34 + evidence.score * 0.25 + Math.max(lsf.base, lsf.trigger, lsf.chaos) * 0.25 + (emotional.thresholdPassed ? 0.05 : 0), 0.2, 0.92);
    const explanation = [];
    explanation.push(evidence.label === "weak" ? "LSF limitado por evidencia live débil" : evidence.label === "moderate" ? "LSF moderado: evidencia live suficiente pero no dominante" : "LSF con evidencia live fuerte, puede liderar");
    if(momentum.dominantSide !== "none") explanation.push(`Momentum ${momentum.dominantSide==='home'?'local':'visitante'} en ${momentum.label}`);
    if(emotional.triggeredBy.length) explanation.push(`Impacto emocional ${emotional.level} por ${emotional.triggeredBy.join(', ')}`);
    return {
      finalWeights: weights,
      finalDecision: { scenario, probs: { home: Number(probs.home.toFixed(3)), draw: Number(probs.draw.toFixed(3)), away: Number(probs.away.toFixed(3)) }, confidence: Number(confidence.toFixed(3)) },
      contextFlags: { emotionalLevel: emotional.level, liveEvidence: evidence.label, momentumLabel: momentum.label },
      advancedSignals: { modifiers, emotional, evidence, momentum },
      explanation
    };
  }

  function updateOrchestratorLearning({ state = null, result = {} } = {}){
    const next = normalizeOrchestratorLearningState(state);
    const contributors = (Array.isArray(result.topEngines) ? result.topEngines : []).filter((row)=>Number(row?.contribution) >= 0.2).map((row)=>String(row.engine || ""));
    const correct = result.actualOutcome && result.predictedOutcome ? result.actualOutcome === result.predictedOutcome : false;
    contributors.forEach((engine)=>{
      if(!next.enginePerformance[engine] || !next.learnedBias.hasOwnProperty(engine)) return;
      const perf = next.enginePerformance[engine];
      perf.n += 1;
      const accObs = correct ? 1 : 0;
      perf.accuracy = Number((((perf.accuracy * (perf.n - 1)) + accObs) / perf.n).toFixed(4));
      const conf = clamp(Number(result.confidence) || 0.5, 0, 1);
      const brierLikeObs = (conf - accObs) ** 2;
      perf.brierLike = Number((((perf.brierLike * (perf.n - 1)) + brierLikeObs) / perf.n).toFixed(4));
      const delta = correct ? 0.01 : -0.01;
      next.learnedBias[engine] = Number(clamp((Number(next.learnedBias[engine]) || 0) + delta, -0.10, 0.10).toFixed(3));
    });
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function extractLSFFeatures(phaseObserved = {}, prediction = {}, phase = "0-15"){
    const obsTags = phaseObserved?.observed?.tags || {};
    const derived = phaseObserved?.observed?.derivedTags || {};
    const evidence = phaseObserved?.observed?.evidence || {};
    const byTeam = phaseObserved?.observed?.teamTags || { home: {}, away: {} };
    const dangerHome = Number(evidence?.dangerIndexHome) || 0;
    const dangerAway = Number(evidence?.dangerIndexAway) || 0;
    const phaseLen = (()=>{
      const [a, b] = String(phase || "0-15").split("-").map((v)=>Number(v) || 0);
      return Math.max(10, Math.abs(b - a));
    })();
    const cornerCut = phaseLen >= 15 ? 3 : 2;
    return {
      tempoLow: (Number(evidence?.events) || 0) < 4 ? 1 : 0,
      balanced: Math.abs(dangerHome - dangerAway) < 0.25 ? 1 : 0,
      controlHome: clamp(Number(derived?.territorial_pressure) || 0, 0, 1),
      controlAway: clamp((Number(obsTags?.foul) || 0) * 0.12 + (Number(obsTags?.yellow) || 0) * 0.2, 0, 1),
      cornersSurgeHome: (Number(byTeam?.home?.corner) || 0) >= cornerCut ? 1 : 0,
      cornersSurgeAway: (Number(byTeam?.away?.corner) || 0) >= cornerCut ? 1 : 0,
      shotsOTSurgeHome: (Number(byTeam?.home?.shot_on_target) || 0) >= 2 ? 1 : 0,
      shotsOTSurgeAway: (Number(byTeam?.away?.shot_on_target) || 0) >= 2 ? 1 : 0,
      finishingFailureHome: clamp(((Number(byTeam?.home?.shot) || 0) - (Number(byTeam?.home?.goal) || 0)) / 4, 0, 1),
      finishingFailureAway: clamp(((Number(byTeam?.away?.shot) || 0) - (Number(byTeam?.away?.goal) || 0)) / 4, 0, 1),
      varShock: (Number(obsTags?.penalty_awarded) > 0 && Number(obsTags?.penalty_cancelled) > 0) || Number(obsTags?.var_overturn) > 0 ? 1 : 0,
      redCard: Number(obsTags?.red) > 0 ? 1 : 0,
      surprise: clamp(Number(prediction?.comparison?.metrics?.surprise) || 0, 0, 1),
      calError: clamp(Number(prediction?.comparison?.metrics?.calibrationError) || 0, -1, 1)
    };
  }

  function computeLsfForecast({ lsfState = null, features = {}, forecastForPhase = "" } = {}){
    const state = normalizeLsfState(lsfState);
    const baseScore = LSF_FEATURE_KEYS.reduce((acc, key)=>acc + (Number(state.weights.base[key]) || 0) * (Number(features[key]) || 0), 0);
    const triggerScore = LSF_FEATURE_KEYS.reduce((acc, key)=>acc + (Number(state.weights.trigger[key]) || 0) * (Number(features[key]) || 0), 0);
    const chaosScore = LSF_FEATURE_KEYS.reduce((acc, key)=>acc + (Number(state.weights.chaos[key]) || 0) * (Number(features[key]) || 0), 0);
    const entropyRef = lsfSoftmax([baseScore, triggerScore, chaosScore], 1);
    const entropy = -entropyRef.reduce((acc, p)=>acc + p * Math.log(Math.max(0.0001, p)), 0) / Math.log(3);
    const temp = entropy > 0.92 ? 1.2 : entropy < 0.55 ? 0.9 : Number(state.calibrator.temp) || 1;
    const probsArr = lsfSoftmax([baseScore, triggerScore, chaosScore], temp);
    const probs = { base: probsArr[0], trigger: probsArr[1], chaos: probsArr[2] };
    const nextScenario = Object.entries(probs).sort((a,b)=>b[1]-a[1])[0]?.[0] || "base";
    const contributions = ["base", "trigger", "chaos"].flatMap((scenario)=>LSF_FEATURE_KEYS.map((key)=>({ scenario, key, val: (Number(state.weights?.[scenario]?.[key]) || 0) * (Number(features[key]) || 0) })));
    const drivers = contributions.filter((row)=>Math.abs(row.val) > 0.0001).sort((a,b)=>Math.abs(b.val)-Math.abs(a.val)).slice(0, 3);
    const thresholdTable = [
      { key: "cornersSurgeHome", label: "Si home corners >= 2 en 10 min", scenario: "trigger", delta: 0.15 },
      { key: "cornersSurgeAway", label: "Si away corners >= 2 en 10 min", scenario: "trigger", delta: 0.15 },
      { key: "shotsOTSurgeHome", label: "Si shotsOT home >= 2", scenario: "trigger", delta: 0.12 },
      { key: "shotsOTSurgeAway", label: "Si shotsOT away >= 2", scenario: "trigger", delta: 0.12 },
      { key: "varShock", label: "Si aparece VAR/penal revertido", scenario: "chaos", delta: 0.25 },
      { key: "tempoLow", label: "Si el tempo sigue bajo", scenario: "base", delta: 0.10 }
    ];
    const ifThen = thresholdTable.filter((row)=>(Number(features[row.key]) || 0) < 1).slice(0, 3);
    const maxProb = Math.max(probs.base, probs.trigger, probs.chaos);
    const topTwo = Object.values(probs).sort((a,b)=>b-a).slice(0,2);
    const leaderGap = (topTwo[0] || 0) - (topTwo[1] || 0);
    const confidence = clamp(maxProb * (Number(state.calibrator.confScale) || 0.92) * (1 - Math.abs(Number(features.calError) || 0) * 0.25), 0, 1);
    const switchRisk = entropy > 0.95 || Number(features.surprise) >= 0.7 ? "HIGH" : entropy > 0.7 ? "MED" : "LOW";
    return {
      forecastForPhase,
      nextScenario,
      probs: {
        base: Number(probs.base.toFixed(3)),
        trigger: Number(probs.trigger.toFixed(3)),
        chaos: Number(probs.chaos.toFixed(3))
      },
      confidence: Number(confidence.toFixed(3)),
      switchRisk,
      entropy: Number(entropy.toFixed(3)),
      leaderGap: Number(leaderGap.toFixed(3)),
      drivers: drivers.map((row)=>({ ...row, val: Number(row.val.toFixed(3)) })),
      ifThen,
      calibrator: { temp: Number(temp.toFixed(2)), confScale: Number((state.calibrator.confScale || 0.92).toFixed(2)) }
    };
  }

  function toHuman(driverKey = ""){
    const map = {
      balanced: "Partido parejo",
      calError: "Sistema inseguro (falló antes)",
      surprise: "Evento inesperado reciente",
      controlHome: "Local tiene más control",
      controlAway: "Visita sube fricción del partido",
      cornersSurgeHome: "Racha de córners del local",
      cornersSurgeAway: "Racha de córners de la visita",
      shotsOTSurgeHome: "Tiros a puerta en racha (local)",
      shotsOTSurgeAway: "Tiros a puerta en racha (visita)",
      tempoLow: "Ritmo bajo",
      varShock: "VAR/penal cambió el guion",
      redCard: "Tarjeta roja condiciona todo"
    };
    return map[driverKey] || driverKey;
  }

  function scenarioLabel(scenario = ""){
    const map = {
      base: "Base (control/ritmo)",
      trigger: "Trigger (asedio/ABP)",
      chaos: "Chaos (partido roto)"
    };
    return map[scenario] || scenario;
  }

  function deriveTrueScenario(features = {}){
    if(Number(features.varShock) >= 1 || Number(features.redCard) >= 1 || Number(features.surprise) >= 0.75) return "chaos";
    if(Number(features.cornersSurgeHome) >= 1 || Number(features.cornersSurgeAway) >= 1 || Number(features.shotsOTSurgeHome) >= 1 || Number(features.shotsOTSurgeAway) >= 1) return "trigger";
    return "base";
  }

  function applyLsfLearning({ brainV2, matchId, madeAtPhase, forecastRecord = null, observedFeatures = {}, evidenceCount = 0 } = {}){
    brainV2.mne ||= normalizeMneLearningState({});
    const lsfState = brainV2.mne.lsfState = normalizeLsfState(brainV2.mne.lsfState);
    if(!forecastRecord) return { skipped: "missing_forecast", updates: [] };
    if(evidenceCount < 3) return { skipped: "low_evidence", updates: [] };
    const truth = deriveTrueScenario(observedFeatures);
    const y = { base: truth === "base" ? 1 : 0, trigger: truth === "trigger" ? 1 : 0, chaos: truth === "chaos" ? 1 : 0 };
    const p = forecastRecord.probs || { base: 1/3, trigger: 1/3, chaos: 1/3 };
    const brier = (p.base-y.base)**2 + (p.trigger-y.trigger)**2 + (p.chaos-y.chaos)**2;
    const lr = 0.04;
    const updates = [];
    ["base", "trigger", "chaos"].forEach((scenario)=>{
      LSF_FEATURE_KEYS.forEach((key)=>{
        const f = Number(observedFeatures[key]) || 0;
        if(f === 0) return;
        const rawDelta = lr * ((y[scenario] || 0) - (Number(p[scenario]) || 0)) * f;
        const delta = clamp(rawDelta, -0.03, 0.03);
        if(delta === 0) return;
        const prev = Number(lsfState.weights[scenario][key]) || 0;
        lsfState.weights[scenario][key] = Number(clamp(prev + delta, -1.5, 1.5).toFixed(3));
        updates.push({ scenario, key, delta: Number(delta.toFixed(3)) });
      });
    });
    lsfState.stats.forecastsMade += 1;
    if(forecastRecord.nextScenario === truth) lsfState.stats.correct += 1;
    lsfState.stats.brierSum = Number((Number(lsfState.stats.brierSum || 0) + brier).toFixed(4));
    if(brier > 0.62 && Math.abs(Number(observedFeatures.calError) || 0) > 0.2){
      lsfState.calibrator.confScale = Number(clamp((Number(lsfState.calibrator.confScale) || 0.92) * 0.98, 0.75, 1).toFixed(3));
      brainV2.mne.confidenceScale = Number(clamp((Number(brainV2.mne.confidenceScale) || 1) * 0.99, 0.75, 1.15).toFixed(3));
    }
    brainV2.mne.lsfEvalHistory = [...(brainV2.mne.lsfEvalHistory || []), {
      matchId,
      phase: madeAtPhase,
      ts: new Date().toISOString(),
      truth,
      predicted: forecastRecord.nextScenario,
      brier: Number(brier.toFixed(3)),
      updatesCount: updates.length
    }].slice(-250);
    return { skipped: null, truth, brier: Number(brier.toFixed(3)), updates };
  }

  function applyMneLearning({ brainV2, matchId, phase, homeTeamId, awayTeamId, prediction, comparison, evidenceCount = 0 }){
    brainV2.mne ||= normalizeMneLearningState({});
    if(evidenceCount < 3) return { updates: [], skipped: "low_evidence" };
    const lr = 0.05;
    const log = Array.isArray(brainV2.mne.learningLog) ? brainV2.mne.learningLog : [];
    const usedBudget = log.filter((row)=>row.matchId===matchId).reduce((acc, row)=>acc + (row.updates || []).reduce((inAcc, up)=>inAcc + Math.abs(Number(up.delta) || 0), 0), 0);
    let budget = clamp(0.15 - usedBudget, 0, 0.15);
    if(budget <= 0) return { updates: [], skipped: "match_cap" };
    const updates = [];
    const sceneId = prediction?.predicted?.sceneId;
    const teamId = sceneId && /away/.test(String(sceneId)) ? awayTeamId : homeTeamId;
    if(sceneId && teamId){
      brainV2.mne.sceneWeights[teamId] ||= {};
      const rawDelta = lr * ((Number(comparison?.metrics?.precision) || 0) - 0.5);
      const delta = clamp(rawDelta, -budget, budget);
      if(delta !== 0){
        const prev = Number(brainV2.mne.sceneWeights[teamId][sceneId]) || 0;
        brainV2.mne.sceneWeights[teamId][sceneId] = Number(clamp(prev + delta, -2, 2).toFixed(3));
        updates.push({ type: "scene", id: `${teamId}:${sceneId}`, delta: Number(delta.toFixed(3)) });
        budget = clamp(budget - Math.abs(delta), 0, 0.15);
      }
    }
    const trigger = MNE_SCENE_LIBRARY.find((scene)=>scene.id === sceneId)?.liveTriggers?.[0];
    if(trigger && budget > 0){
      const triggerId = `${sceneId}:${trigger.if}`;
      const raw = lr * (((Number(comparison?.metrics?.precision) || 0) - 0.45) - (Number(comparison?.metrics?.surprise) || 0) * 0.12);
      const delta = clamp(raw, -budget, budget);
      const prev = Number(brainV2.mne.triggerWeights[triggerId]) || 0;
      brainV2.mne.triggerWeights[triggerId] = Number(clamp(prev + delta, -2, 2).toFixed(3));
      updates.push({ type: "trigger", id: triggerId, delta: Number(delta.toFixed(3)) });
      budget = clamp(budget - Math.abs(delta), 0, 0.15);
    }
    const calError = Number(comparison?.metrics?.calibrationError) || 0;
    if(Math.abs(calError) >= 0.03 && budget > 0){
      const scaleDelta = clamp(-0.08 * calError, -0.02, 0.02);
      const prev = Number(brainV2.mne.confidenceScale) || 1;
      brainV2.mne.confidenceScale = Number(clamp(prev + scaleDelta, 0.75, 1.15).toFixed(3));
      updates.push({ type: "calibration", id: "confidenceScale", delta: Number(scaleDelta.toFixed(3)), from: prev, to: brainV2.mne.confidenceScale });
    }
    brainV2.mne.learningLog.push({ matchId, phase, ts: new Date().toISOString(), updates });
    brainV2.mne.learningLog = brainV2.mne.learningLog.slice(-500);
    return { updates, skipped: null };
  }

  function buildBrainV2Vision({ homeSummary, awaySummary, odds, homeProfile = null, awayProfile = null, gpe = null, homeTeamId = "", awayTeamId = "", mneLearning = null }){
    const get = (s, key, fallback)=>Number(s?.avg?.[key] ?? fallback);
    const getAny = (s, keys = [], fallback = 0)=>{
      for(const key of keys){
        const value = Number(s?.avg?.[key]);
        if(Number.isFinite(value) && value !== 0) return value;
      }
      return fallback;
    };
    const xgInputHome = {
      xg_for: get(homeSummary, "xg", 1.2),
      goals_for: getAny(homeSummary, ["goals_for", "goals", "gf"], get(homeSummary, "goals", 1.3)),
      xg_against: getAny(homeSummary, ["xga", "xg_against"], 1.2),
      goals_against: getAny(homeSummary, ["goals_against", "ga"], 1.1)
    };
    const xgInputAway = {
      xg_for: get(awaySummary, "xg", 1.1),
      goals_for: getAny(awaySummary, ["goals_for", "goals", "gf"], get(awaySummary, "goals", 1.1)),
      xg_against: getAny(awaySummary, ["xga", "xg_against"], 1.2),
      goals_against: getAny(awaySummary, ["goals_against", "ga"], 1.2)
    };

    const xg = computeExpectedGoals(xgInputHome, xgInputAway);
    const hp = homeProfile?.tendencies || {};
    const ap = awayProfile?.tendencies || {};
    const narrativeDeltas = {
      setPiece: (Number(hp.setPieceDependence) || 0) - (Number(ap.setPieceDependence) || 0),
      latePressure: (Number(hp.latePressureAvg) || 0) - (Number(ap.latePressureAvg) || 0),
      finishing: (Number(hp.finishingEfficiency) || 0) - (Number(ap.finishingEfficiency) || 0),
      discipline: (Number(ap.disciplineCostRate) || 0) - (Number(hp.disciplineCostRate) || 0)
    };
    const homeMne = buildMneMetrics(homeSummary, homeProfile);
    const awayMne = buildMneMetrics(awaySummary, awayProfile);
    const styleClashes = [];
    if(homeMne.control > 60 && awayMne.dna.counter_strike > 0.2 && awayMne.attack_production > 52) styleClashes.push("away_transition_window");
    if(awayMne.control > 58 && homeMne.dna.counter_strike > 0.2 && homeMne.attack_production > 52) styleClashes.push("home_transition_window");
    if(homeMne.control > 60 && homeMne.dna.finishing_failure > 0.22) styleClashes.push("home_sterile_risk");
    if(awayMne.control > 58 && awayMne.dna.finishing_failure > 0.22) styleClashes.push("away_sterile_risk");
    const mne = buildMatchNarrativeEngine({
      homeMetrics: homeMne,
      awayMetrics: awayMne,
      styleClashes,
      sampleSize: Math.min(Number(homeProfile?.lastN) || 0, Number(awayProfile?.lastN) || 0),
      homeTeamId,
      awayTeamId,
      mneLearning
    });
    const xgNarrative = {
      xg_home: clamp(
        xg.xg_home
        * (1 + 0.08 * narrativeDeltas.setPiece)
        * (1 + 0.015 * narrativeDeltas.latePressure)
        * (1 + 0.08 * narrativeDeltas.finishing)
        * (1 + 0.06 * narrativeDeltas.discipline),
        0.2,
        4.2
      ),
      xg_away: clamp(
        xg.xg_away
        * (1 - 0.08 * narrativeDeltas.setPiece)
        * (1 - 0.015 * narrativeDeltas.latePressure)
        * (1 - 0.08 * narrativeDeltas.finishing)
        * (1 - 0.06 * narrativeDeltas.discipline),
        0.2,
        4.2
      )
    };
    const matrix = scoreMatrix(xgNarrative.xg_home, xgNarrative.xg_away);
    const modelOutcome = matrixToOutcome(matrix);
    const likelyScore = mostLikelyScore(matrix);

    const cleanOdds = {
      home: Number(odds?.home),
      draw: Number(odds?.draw),
      away: Number(odds?.away)
    };
    let blended = modelOutcome;
    const hasOdds = cleanOdds.home > 1 && cleanOdds.draw > 1 && cleanOdds.away > 1;
    if(hasOdds){
      const market = oddsToMarketProbabilities(cleanOdds);
      blended = blendOutcomes(blended, market, 0.65);
    }

    const baseline = computeBaseline(gpe?.meta || {});
    const tagImpactMap = gpe?.tagImpact || {};
    const gpeTagStats = gpe?.tagStats || {};
    const homeTopTags = (homeProfile?.reasonTagRates
      ? Object.entries(homeProfile.reasonTagRates)
      : [])
      .filter(([, strength])=>Number(strength) >= GPE_TAG_ON)
      .sort((a,b)=>(Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, GPE_TOP_TAGS);
    const awayTopTags = (awayProfile?.reasonTagRates
      ? Object.entries(awayProfile.reasonTagRates)
      : [])
      .filter(([, strength])=>Number(strength) >= GPE_TAG_ON)
      .sort((a,b)=>(Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, GPE_TOP_TAGS);
    const buildTagVotes = (entries = [], side = "home")=>entries.map(([tagId])=>{
      const impact = tagImpactMap[tagId] || (gpeTagStats[tagId] ? computeImpactForTag(gpeTagStats[tagId], baseline) : null);
      if(!impact) return null;
      return {
        tagId,
        side,
        n: impact.n,
        reliability: impact.rel,
        pW: impact.pW,
        pD: impact.pD,
        pL: impact.pL,
        liftW: impact.liftW,
        liftD: impact.liftD,
        liftL: impact.liftL
      };
    }).filter(Boolean);
    const homeVotes = buildTagVotes(homeTopTags, "home");
    const awayVotes = buildTagVotes(awayTopTags, "away");
    const combinedVotes = [...homeVotes, ...awayVotes];
    const reliableVotes = combinedVotes.filter((vote)=>Number(vote.reliability) >= 0.6);
    const avgRelEligible = reliableVotes.length
      ? (reliableVotes.reduce((acc, item)=>acc + item.reliability, 0) / reliableVotes.length)
      : 0;
    const evidenceOk = avgRelEligible >= 0.6 && Number(gpe?.meta?.totalMatches || 0) >= 60;
    const votesForBlend = evidenceOk ? reliableVotes : [];
    const relSum = votesForBlend.reduce((acc, item)=>acc + item.reliability, 0) || 1;
    let gW = baseline.pW;
    let gD = baseline.pD;
    let gL = baseline.pL;
    votesForBlend.forEach((item)=>{
      const wi = item.reliability / relSum;
      if(item.side === "home"){
        gW += wi * item.liftW;
        gD += wi * item.liftD;
        gL += wi * item.liftL;
      }else{
        gW += wi * item.liftL;
        gD += wi * item.liftD;
        gL += wi * item.liftW;
      }
    });
    const gRawSum = Math.max(0.0001, gW + gD + gL);
    const gpeProbs = {
      home: clamp(gW / gRawSum, 0.02, 0.94),
      draw: clamp(gD / gRawSum, 0.02, 0.94),
      away: clamp(gL / gRawSum, 0.02, 0.94)
    };
    const alpha = evidenceOk ? clamp(avgRelEligible * 0.25, 0, 0.25) : 0;
    const mixed = {
      home: (blended.home * (1 - alpha)) + (gpeProbs.home * alpha),
      draw: (blended.draw * (1 - alpha)) + (gpeProbs.draw * alpha),
      away: (blended.away * (1 - alpha)) + (gpeProbs.away * alpha)
    };
    const mixedSum = Math.max(0.0001, mixed.home + mixed.draw + mixed.away);
    blended = {
      home: mixed.home / mixedSum,
      draw: mixed.draw / mixedSum,
      away: mixed.away / mixedSum
    };

    const contributionPreview = votesForBlend
      .map((item)=>{
        const shift = {
          home: item.side === "home" ? item.liftW : item.liftL,
          draw: item.liftD,
          away: item.side === "home" ? item.liftL : item.liftW
        };
        const strongest = Object.entries(shift).sort((a,b)=>Math.abs(b[1]) - Math.abs(a[1]))[0] || ["draw", 0];
        return {
          tagId: item.tagId,
          side: item.side,
          n: item.n,
          reliability: item.reliability,
          impactTarget: strongest[0],
          impactDelta: Number((strongest[1] * alpha * 100).toFixed(2)),
          pW: item.pW,
          pD: item.pD,
          pL: item.pL
        };
      })
      .sort((a,b)=>Math.abs(b.impactDelta)-Math.abs(a.impactDelta))
      .slice(0, 3);

    const comboStats = gpe?.comboStats || {};
    const comboImpact = gpe?.comboImpact || {};
    const trapWarnings = [];
    const checkCombos = (tags = [], side = "home")=>{
      for(let i=0; i<tags.length; i += 1){
        for(let j=i+1; j<tags.length; j += 1){
          const comboKey = [tags[i][0], tags[j][0]].sort().join("|");
          const combo = comboStats[comboKey];
          if(!combo) continue;
          const impact = comboImpact[comboKey] || computeImpactForCombo(combo, baseline);
          if(impact.rel >= 0.6 && (impact.isTrap || impact.isChaos)){
            trapWarnings.push({
              type: impact.isChaos ? "CHAOS_MATCH" : "TRAP_MATCH",
              reason: `Combo ${comboKey} ${impact.isChaos ? "aporta caos (sube W y L)" : "tiende a empates trampa"}.`,
              confidence: Number(impact.rel.toFixed(2)),
              side
            });
          }
        }
      }
    };
    checkCombos(homeTopTags, "home");
    checkCombos(awayTopTags, "away");

    const missing = [];
    if(homeSummary.samples < 3) missing.push("Pocos partidos del local (ideal 5+).");
    if(awaySummary.samples < 3) missing.push("Pocos partidos del visitante (ideal 5+).");
    if(!get(homeSummary, "xg", 0) || !get(awaySummary, "xg", 0)) missing.push("Faltan métricas xG en uno de los equipos.");

    const bars = {
      homeAttack: clamp(Math.round((get(homeSummary, "xg", 1.2) / 2.6) * 100), 15, 98),
      awayAttack: clamp(Math.round((get(awaySummary, "xg", 1.1) / 2.6) * 100), 15, 98),
      homeControl: clamp(Math.round(get(homeSummary, "possession", 50)), 15, 95),
      awayControl: clamp(Math.round(get(awaySummary, "possession", 50)), 15, 95)
    };

    const homeSot = getAny(homeSummary, ["shots_on_target", "shots_target", "on_target"], get(homeSummary, "shots", 10) * 0.36);
    const awaySot = getAny(awaySummary, ["shots_on_target", "shots_target", "on_target"], get(awaySummary, "shots", 9) * 0.34);
    const homeCorners = getAny(homeSummary, ["corners", "corner_kicks"], 4.8);
    const awayCorners = getAny(awaySummary, ["corners", "corner_kicks"], 4.2);
    const homeCards = getAny(homeSummary, ["yellow_cards", "cards", "tarjetas"], 2.1) + (getAny(homeSummary, ["red_cards", "rojas"], 0.12) * 2.1);
    const awayCards = getAny(awaySummary, ["yellow_cards", "cards", "tarjetas"], 2.2) + (getAny(awaySummary, ["red_cards", "rojas"], 0.13) * 2.1);

    const homeResistance = clamp(
      ((get(homeSummary, "possession", 50) * 0.42) + (getAny(homeSummary, ["passes", "accurate_passes"], 380) * 0.04) + (homeSummary.resilienceNotes * 3.5) - (homeSummary.fatigueNotes * 2.8)),
      20,
      98
    );
    const awayResistance = clamp(
      ((get(awaySummary, "possession", 50) * 0.42) + (getAny(awaySummary, ["passes", "accurate_passes"], 350) * 0.04) + (awaySummary.resilienceNotes * 3.5) - (awaySummary.fatigueNotes * 2.8)),
      20,
      98
    );
    const homeFatigue = clamp(
      (32 + homeCards * 9 + getAny(homeSummary, ["fouls", "faltas"], 11) * 1.3 + homeSummary.fatigueNotes * 8 - homeSummary.resilienceNotes * 4),
      8,
      96
    );
    const awayFatigue = clamp(
      (32 + awayCards * 9 + getAny(awaySummary, ["fouls", "faltas"], 12) * 1.3 + awaySummary.fatigueNotes * 8 - awaySummary.resilienceNotes * 4),
      8,
      96
    );

    const expected = {
      goalsHome: clamp(xgNarrative.xg_home, 0.2, 3.9),
      goalsAway: clamp(xgNarrative.xg_away, 0.2, 3.9),
      cornersHome: clamp(homeCorners + (bars.homeAttack - bars.awayAttack) * 0.03, 1.5, 11.5),
      cornersAway: clamp(awayCorners + (bars.awayAttack - bars.homeAttack) * 0.03, 1.5, 11.5),
      cardsHome: clamp(homeCards + homeFatigue * 0.015, 0.6, 6.2),
      cardsAway: clamp(awayCards + awayFatigue * 0.015, 0.6, 6.2)
    };

    const insights = [
      `${bars.homeAttack >= bars.awayAttack ? "⚽ Local llega con mayor pegada" : "⚽ Visita llega con mayor pegada"} (${bars.homeAttack}% vs ${bars.awayAttack}%).`,
      `${homeResistance >= awayResistance ? "🫀 Local muestra más resistencia" : "🫀 Visita muestra más resistencia"} (${Math.round(homeResistance)} vs ${Math.round(awayResistance)}).`,
      `${homeFatigue >= awayFatigue ? "🥵 Local aparece más cargado físicamente" : "🥵 Visita aparece más cargado físicamente"} (${Math.round(homeFatigue)} vs ${Math.round(awayFatigue)}).`
    ];
    if(alpha > 0.02) insights.push(`🌍 GIE ajustó el pronóstico con α=${alpha.toFixed(2)} (reliability media ${(avgRelEligible*100).toFixed(0)}%).`);
    else insights.push("🌍 Sin evidencia global fuerte: se mantiene el modelo local.");
    trapWarnings.forEach((warning)=>insights.push(`⚠️ ${warning.reason}`));

    const reasonPreview = [
      { tag: "set_piece_pressure", strength: clamp(Math.abs(narrativeDeltas.setPiece) * 2.4, 0, 1), note: "Diferencia en dependencia de balón parado" },
      { tag: "late_pressure", strength: clamp(Math.abs(narrativeDeltas.latePressure) * 0.18, 0, 1), note: "Ritmo de presión en tramo final" },
      { tag: "finishing_edge", strength: clamp(Math.abs(narrativeDeltas.finishing) * 2.1, 0, 1), note: "Eficiencia de definición reciente" },
      { tag: "discipline_cost", strength: clamp(Math.abs(narrativeDeltas.discipline) * 2.1, 0, 1), note: "Riesgo disciplinario comparado" }
    ].filter((r)=>r.strength>=0.12).sort((a,b)=>b.strength-a.strength).slice(0, 3);

    const latePressureStat = gpeTagStats.late_pressure;
    const latePressureGoalRate = latePressureStat ? smoothedProbs(latePressureStat).pW : null;
    const mneNarrative = (mne?.narrative || []).map((phase)=>{
      if(!(phase?.tags || []).includes("late_pressure") || latePressureGoalRate === null) return phase;
      if(latePressureGoalRate < 0.3){
        return {
          ...phase,
          notes: [...(phase.notes || []), "Asedio final, pero no siempre se traduce en gol según evidencia global."].slice(0, 3)
        };
      }
      return phase;
    });

    return {
      probs: blended,
      confidence: clamp(0.45 + Math.abs(blended.home - blended.away) * 0.7 + ((homeSummary.samples + awaySummary.samples) / 50) + (avgRelEligible * 0.1), 0.2, 0.96),
      missing,
      bars,
      expected,
      score: likelyScore,
      physical: {
        homeResistance,
        awayResistance,
        homeFatigue,
        awayFatigue
      },
      insights,
      reasonPreview,
      globalEvidence: {
        alpha: Number(alpha.toFixed(3)),
        avgReliability: Number(avgRelEligible.toFixed(3)),
        tags: votesForBlend,
        evidenceOk,
        eligibleCount: reliableVotes.length,
        topContributors: contributionPreview,
        trapWarnings
      },
      narrativeDeltas,
      styleClashes,
      mne: { ...mne, narrative: mneNarrative },
      updateNarrativeWithLiveSignals(liveStats = {}){
        const rules = [
          { check: ()=>Number(liveStats?.home?.corners) >= 3 && Number(liveStats?.minute) <= 20, tag: "setpiece_threat", side: "home", boost: 0.12 },
          { check: ()=>Number(liveStats?.away?.shotsOT) >= 2 && Number(liveStats?.minute) <= 30, tag: "counter_strike", side: "away", boost: 0.15 }
        ];
        const nextNarrative = (mne.narrative || []).map((phase)=>{
          let confidence = Number(phase.confidence) || 0;
          rules.forEach((rule)=>{
            if(!rule.check()) return;
            if((phase.tags || []).includes(rule.tag)) confidence += rule.boost;
          });
          return { ...phase, confidence: Number(clamp(confidence, 0, 0.99).toFixed(2)) };
        });
        return { ...mne, narrative: nextNarrative };
      }
    };
  }

  function computeBrainV2Health(memories = {}){
    const perTeam = Object.entries(memories || {}).map(([teamId, rows])=>{
      const list = Array.isArray(rows) ? rows : [];
      const withStats = list.filter((m)=>Object.keys(parseNumericStats(m?.statsRaw || "")).length > 0).length;
      const withNarrative = list.filter((m)=>String(m?.narrative || "").trim().length >= 24).length;
      return {
        teamId,
        matches: list.length,
        withStats,
        withNarrative,
        completion: list.length ? ((withStats + withNarrative) / (list.length * 2)) : 0
      };
    });
    const teamsLearned = perTeam.filter((item)=>item.matches > 0).length;
    const matchesLearned = perTeam.reduce((acc, item)=>acc + item.matches, 0);
    const statsCoverage = matchesLearned ? (perTeam.reduce((acc, item)=>acc + item.withStats, 0) / matchesLearned) : 0;
    const narrativeCoverage = matchesLearned ? (perTeam.reduce((acc, item)=>acc + item.withNarrative, 0) / matchesLearned) : 0;
    const avgMatchesPerTeam = teamsLearned ? (matchesLearned / teamsLearned) : 0;
    const confidence = clamp((statsCoverage * 0.4) + (narrativeCoverage * 0.25) + Math.min(avgMatchesPerTeam / 8, 1) * 0.35, 0, 0.99);
    return {
      perTeam,
      teamsLearned,
      matchesLearned,
      statsCoverage,
      narrativeCoverage,
      avgMatchesPerTeam,
      confidence
    };
  }

  function loadDb(){
    const raw = localStorage.getItem(KEY);
    if(!raw){
      localStorage.setItem(KEY, JSON.stringify(defaultDb));
      return structuredClone(defaultDb);
    }
    try{
      const db = JSON.parse(raw);
      db.settings ||= structuredClone(defaultDb.settings);
      db.leagues ||= [];
      db.teams ||= [];
      db.teamCompetitions ||= [];
      db.players ||= [];
      db.tracker ||= [];
      db.diagProfiles ||= {};
      db.versus ||= { homeAdvantage: 1.1 };
      db.versus.paceFactor = clamp(Number(db.versus.paceFactor) || 1, 0.82, 1.35);
      db.versus.sampleSize = clamp(Number(db.versus.sampleSize) || 20, 5, 40);
      db.versus.marketBlend = clamp(Number(db.versus.marketBlend) || defaultDb.versus.marketBlend, 0, 0.8);
      db.versus.matchday = clamp(Number(db.versus.matchday) || defaultDb.versus.matchday, 1, 50);
      db.versus.tableContextTrust = clamp(Number(db.versus.tableContextTrust) || defaultDb.versus.tableContextTrust, 0, 1);
      db.versus.tableContext ||= {};
      db.versus.simV2 ||= structuredClone(defaultDb.versus.simV2);
      db.versus.simV2.baseGoalRatePerBlock = clamp(Number(db.versus.simV2.baseGoalRatePerBlock) || defaultDb.versus.simV2.baseGoalRatePerBlock, 0.08, 0.6);
      db.versus.simV2.globalVolatility = clamp(Number(db.versus.simV2.globalVolatility) || defaultDb.versus.simV2.globalVolatility, 0.1, 0.8);
      db.versus.simV2.leagueGoalsAvg = clamp(Number(db.versus.simV2.leagueGoalsAvg) || defaultDb.versus.simV2.leagueGoalsAvg, 1.6, 4.2);
      db.predictions ||= [];
      db.marketTracker = Array.isArray(db.marketTracker) ? db.marketTracker.map(ensureMarketMatchState) : [];
      db.teamRatings = db.teamRatings && typeof db.teamRatings === "object" ? db.teamRatings : {};
      db.leagueTableSnapshots = Array.isArray(db.leagueTableSnapshots) ? db.leagueTableSnapshots : [];
      db.marketOddsSnapshots = Array.isArray(db.marketOddsSnapshots) ? db.marketOddsSnapshots : [];
      db.bitacora = ensureBitacoraState(db.bitacora);
      db.learning ||= structuredClone(defaultDb.learning);
      db.learning.schemaVersion = Number(db.learning.schemaVersion) || 2;
      db.learning.leagueScale ||= {};
      db.learning.teamBias ||= {};
      db.learning.temperatureByLeague ||= {};
      db.learning.trainingSet ||= [];
      db.learning.matchSnapshots ||= [];
      db.learning.metrics ||= { global: null, byLeague: {} };
      db.learning.metrics.byLeague ||= {};
      db.learning.marketTrust = clamp(Number(db.learning.marketTrust) || defaultDb.learning.marketTrust, 0, 0.85);
      db.leagues = db.leagues.map((league)=>({ ...league, type: normalizeCompetitionType(league?.type) }));
      db.teams.forEach((team)=>{
        ensureTeamIntState(team);
        team.futureMatches = (team.futureMatches || []).map((match)=>{
          const competition = getCompetitionById(db, match?.competitionId || match?.leagueId || "");
          return {
            ...match,
            competitionId: competition?.id || match?.competitionId || match?.leagueId || "",
            competition: competition?.name || match?.competition || "Liga"
          };
        });
      });

      // V9 migration: teams are global entities, league participation lives in teamCompetitions.
      if(!Array.isArray(db.teamCompetitions)) db.teamCompetitions = [];
      const linked = new Set(db.teamCompetitions.map(tc=>`${tc.teamId}::${tc.leagueId}`));
      const ensureLink = (teamId, leagueId)=>{
        if(!teamId || !leagueId) return;
        const key = `${teamId}::${leagueId}`;
        if(linked.has(key)) return;
        linked.add(key);
        db.teamCompetitions.push({ teamId, leagueId, joinedAt: Date.now() });
      };
      db.teams.forEach((team)=>{
        if(team?.leagueId) ensureLink(team.id, team.leagueId);
      });
      db.tracker.forEach((m)=>{
        ensureTrackerMatchState(m);
        if(m?.leagueId){
          ensureLink(m.homeId, m.leagueId);
          ensureLink(m.awayId, m.leagueId);
        }
      });
      rebuildTeamRatings(db);
      refreshOpponentStrengthSnapshots(db);
      return db;
    }catch(_e){
      localStorage.setItem(KEY, JSON.stringify(defaultDb));
      return structuredClone(defaultDb);
    }
  }

  function saveDb(db){
    rebuildTeamRatings(db);
    refreshOpponentStrengthSnapshots(db);
    const payload = JSON.stringify(db);
    try{
      localStorage.setItem(KEY, payload);
      return true;
    }catch(err){
      if(!isQuotaExceededError(err)) throw err;
    }

    try{
      pruneFootballLabCacheKeys();
      localStorage.setItem(KEY, payload);
      return true;
    }catch(err){
      if(!isQuotaExceededError(err)) throw err;
    }

    try{
      compactDbForStorage(db);
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    }catch(err){
      if(!isQuotaExceededError(err)) throw err;
      console.warn("[FootballLab] No se pudo guardar footballDB: almacenamiento lleno.", err);
      return false;
    }
  }

  function isQuotaExceededError(err){
    if(!err) return false;
    return err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014;
  }

  function pruneFootballLabCacheKeys(){
    const keysToDelete = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(!k) continue;
      if(
        k === COMP_CACHE_KEY ||
        k.startsWith(TEAMS_CACHE_PREFIX) ||
        k.startsWith("team_profile_") ||
        k.startsWith("match_events_") ||
        k.startsWith("match_momentum_") ||
        k.startsWith("lpe_")
      ){
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k)=>localStorage.removeItem(k));
  }

  function compactDbForStorage(db){
    if(!db || !Array.isArray(db.tracker)) return;
    db.tracker.forEach((match)=>{
      if(!match || typeof match !== "object") return;
      delete match.featureSnapshots;
      delete match.featureSnapshotStatus;
      delete match.opponentStrengthByTeam;
      if(match.narrativeModule && typeof match.narrativeModule === "object"){
        const rawText = String(match.narrativeModule.rawText || "");
        match.narrativeModule = rawText ? { rawText } : null;
      }
    });
  }

  function ensureTrackerMatchState(match){
    if(!match || typeof match !== "object") return match;
    match.stats ||= [];
    if(typeof match.statsRaw === "undefined") match.statsRaw = null;
    match.featureSnapshots ||= {};
    match.featureSnapshotStatus ||= {};
    match.opponentStrengthByTeam ||= {};
    match.homeLineup ||= [];
    match.awayLineup ||= [];
    match.homeFormation = String(match.homeFormation || "").trim();
    match.awayFormation = String(match.awayFormation || "").trim();
    match.homeEarlySubs = Math.max(0, Number(match.homeEarlySubs) || 0);
    match.awayEarlySubs = Math.max(0, Number(match.awayEarlySubs) || 0);
    match.homeSystemChanges = Math.max(0, Number(match.homeSystemChanges) || 0);
    match.awaySystemChanges = Math.max(0, Number(match.awaySystemChanges) || 0);
    match.homeErrorsLeadingConcede = Math.max(0, Number(match.homeErrorsLeadingConcede) || 0);
    match.awayErrorsLeadingConcede = Math.max(0, Number(match.awayErrorsLeadingConcede) || 0);
    match.homeCardsAfterMistake = Math.max(0, Number(match.homeCardsAfterMistake) || 0);
    match.awayCardsAfterMistake = Math.max(0, Number(match.awayCardsAfterMistake) || 0);
    match.homeConcededAfterMiss = Math.max(0, Number(match.homeConcededAfterMiss) || 0);
    match.awayConcededAfterMiss = Math.max(0, Number(match.awayConcededAfterMiss) || 0);
    match.homeYellowRateEarly = clamp(Number(match.homeYellowRateEarly) || 0, 0, 1);
    match.awayYellowRateEarly = clamp(Number(match.awayYellowRateEarly) || 0, 0, 1);
    match.homeFoulsRateEarly = clamp(Number(match.homeFoulsRateEarly) || 0, 0, 1);
    match.awayFoulsRateEarly = clamp(Number(match.awayFoulsRateEarly) || 0, 0, 1);
    match.homeComplaintsRate = clamp(Number(match.homeComplaintsRate) || 0, 0, 1);
    match.awayComplaintsRate = clamp(Number(match.awayComplaintsRate) || 0, 0, 1);
    match.homeBigChanceMissReaction = clamp(Number(match.homeBigChanceMissReaction) || 0, 0, 1);
    match.awayBigChanceMissReaction = clamp(Number(match.awayBigChanceMissReaction) || 0, 0, 1);
    match.homeLateGoalsConceded = Math.max(0, Number(match.homeLateGoalsConceded) || 0);
    match.awayLateGoalsConceded = Math.max(0, Number(match.awayLateGoalsConceded) || 0);
    match.homeErrorsAfterGoal = Math.max(0, Number(match.homeErrorsAfterGoal) || 0);
    match.awayErrorsAfterGoal = Math.max(0, Number(match.awayErrorsAfterGoal) || 0);
    match.homeDisciplineAfterGoal = clamp(Number(match.homeDisciplineAfterGoal) || 0, 0, 1);
    match.awayDisciplineAfterGoal = clamp(Number(match.awayDisciplineAfterGoal) || 0, 0, 1);
    if(match.oddsHome>1 && match.oddsDraw>1 && match.oddsAway>1){
      match.marketOddsSnapshot ||= {
        matchId: match.id,
        homeOdds: Number(match.oddsHome),
        drawOdds: Number(match.oddsDraw),
        awayOdds: Number(match.oddsAway),
        capturedAt: String(match.date || ""),
        bookmaker: "manual"
      };
    }
    return match;
  }

  function parseLineupList(raw){
    if(Array.isArray(raw)) return raw.map((n)=>String(n || "").trim()).filter(Boolean);
    return String(raw || "")
      .split(/[\n,;|]+/)
      .map((n)=>n.trim())
      .filter(Boolean);
  }

  function parseLineupShape(raw){
    if(!raw) return null;
    if(typeof raw === "object") return raw;
    try{ return JSON.parse(String(raw)); }catch(_err){ return null; }
  }

  function normalizeTeamName(value = ""){
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseFootballLabMatchpack(raw = ""){
    const parsed = typeof raw === "string" ? safeParseJSON(raw, null) : raw;
    if(!parsed || typeof parsed !== "object") throw new Error("JSON inválido o vacío.");
    if(parsed.schemaVersion !== "footballlab_matchpack_v1") throw new Error("schemaVersion no soportado. Se esperaba footballlab_matchpack_v1.");
    if(!parsed.match || typeof parsed.match !== "object") throw new Error("Falta bloque match en el JSON.");
    if(!String(parsed.match.home || "").trim() || !String(parsed.match.away || "").trim()) throw new Error("Faltan match.home o match.away.");
    return parsed;
  }

  function matchpackDateToInput(value = ""){
    const raw = String(value || "").trim();
    if(!raw) return "";
    const full = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if(full) return `${full[3]}-${full[2]}-${full[1]}`;
    const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
    const parsedTs = Date.parse(raw);
    if(!Number.isFinite(parsedTs)) return "";
    return new Date(parsedTs).toISOString().slice(0, 10);
  }

  function inferFocusTeamFromMatchpack(matchpack, currentTeamName = ""){
    const home = String(matchpack?.match?.home || "").trim();
    const away = String(matchpack?.match?.away || "").trim();
    const currentNorm = normalizeTeamName(currentTeamName);
    if(currentNorm && currentNorm===normalizeTeamName(home)) return { teamName: home, side: "home", inferred: false };
    if(currentNorm && currentNorm===normalizeTeamName(away)) return { teamName: away, side: "away", inferred: false };
    const selectedSide = String(matchpack?.lineup?.selectedSide || "").toLowerCase();
    if(selectedSide === "home") return { teamName: home, side: "home", inferred: true };
    if(selectedSide === "away") return { teamName: away, side: "away", inferred: true };
    return { teamName: home, side: "home", inferred: true };
  }

  function buildScoreForForm(matchpack, focusSide = "home"){
    const homeGoals = Number(matchpack?.match?.score?.home);
    const awayGoals = Number(matchpack?.match?.score?.away);
    if(!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return "";
    if(focusSide === "away") return `${awayGoals}-${homeGoals}`;
    return `${homeGoals}-${awayGoals}`;
  }

  function getFocusedStatsFromMatchpack(matchpack, focusSide = "home"){
    const normalized = matchpack?.stats?.normalized;
    if(!normalized || typeof normalized !== "object") return {};
    const side = focusSide === "away" ? "away" : "home";
    const sideStats = normalized[side];
    if(sideStats && typeof sideStats === "object") return sideStats;
    const out = {};
    Object.entries(normalized).forEach(([key, value])=>{
      if(!value || typeof value !== "object") return;
      if(Object.prototype.hasOwnProperty.call(value, side)) out[key] = value[side];
    });
    return out;
  }

  function buildStatsTextareaFromMatchpack(matchpack, focusSide = "home"){
    const stats = getFocusedStatsFromMatchpack(matchpack, focusSide);
    const metricDefs = [
      ["xg", ["xg", "expectedGoals"]],
      ["shots", ["shots", "totalShots"]],
      ["shotsOnTarget", ["shotsOnTarget", "shots_on_target"]],
      ["possession", ["possession", "ballPossession"]],
      ["corners", ["corners", "cornerKicks"]],
      ["bigChances", ["bigChances", "big_chances"]],
      ["passes", ["passes", "totalPasses"]],
      ["yellowCards", ["yellowCards", "yellow_cards"]],
      ["fouls", ["fouls", "foulsCommitted"]],
      ["dangerousAttacks", ["dangerousAttacks", "danger_attacks"]]
    ];
    const lines = [];
    metricDefs.forEach(([label, keys])=>{
      for(const key of keys){
        if(!Object.prototype.hasOwnProperty.call(stats, key)) continue;
        const value = stats[key];
        if(value===null || value===undefined || value==="") continue;
        lines.push(`${label}: ${value}`);
        break;
      }
    });
    return lines.slice(0, 12).join("\n");
  }

  function extractEventMinute(item = {}, idx = 0){
    const minuteCandidates = [item.minute, item.min, item.time, item.minuteLabel, item.clock];
    for(const candidate of minuteCandidates){
      const raw = String(candidate || "").trim();
      if(!raw) continue;
      const hit = raw.match(/\d{1,3}(?:\+\d{1,2})?/);
      if(hit) return hit[0];
    }
    return idx===0 ? "" : `${Math.max(1, idx)}'`;
  }

  function buildNarrativeTextareaFromMatchpack(matchpack){
    const items = Array.isArray(matchpack?.commentary?.items) ? matchpack.commentary.items : [];
    if(!items.length) return "";
    const relevant = items
      .map((item, idx)=>{
        const text = String(item?.text || item?.label || item?.description || item?.event || "").trim();
        const type = String(item?.type || item?.kind || item?.eventType || "").toLowerCase();
        return { minute: extractEventMinute(item, idx), text, type, idx };
      })
      .filter((row)=>row.text)
      .filter((row)=>/gol|goal|var|penal|penalty|tarjet|card|ocasi[oó]n|chance|cambio|substitut|inicio|descanso|final|anulad/i.test(`${row.type} ${row.text}`))
      .slice(0, 16)
      .map((row)=>`${row.minute ? `${row.minute}' ` : ""}${row.text.replace(/\s+/g, " ")}`.trim());
    return relevant.join("\n");
  }

  function buildXiStringFromMatchpack(matchpack){
    const players = Array.isArray(matchpack?.lineup?.players) ? [...matchpack.lineup.players] : [];
    if(!players.length) return "";
    players.sort((a,b)=>{
      const lineDiff = (Number(a?.line) || 0) - (Number(b?.line) || 0);
      if(lineDiff) return lineDiff;
      const slotDiff = (Number(a?.slot) || 0) - (Number(b?.slot) || 0);
      if(slotDiff) return slotDiff;
      return String(a?.gridKey || "").localeCompare(String(b?.gridKey || ""));
    });
    return players.map((p)=>String(p?.name || p?.player || "").trim()).filter(Boolean).slice(0, 11).join(", ");
  }

  function buildLineupShapeFromMatchpack(matchpack){
    const formation = String(matchpack?.lineup?.formation || "").trim() || "4-3-3";
    const players = Array.isArray(matchpack?.lineup?.players) ? [...matchpack.lineup.players] : [];
    if(!players.length) return null;
    players.sort((a,b)=>{
      const lineDiff = (Number(a?.line) || 0) - (Number(b?.line) || 0);
      if(lineDiff) return lineDiff;
      return (Number(a?.slot) || 0) - (Number(b?.slot) || 0);
    });
    const layout = buildFormationLayout(formation);
    const assignments = {};
    layout.slots.forEach((slot, idx)=>{
      const player = players[idx];
      if(!player) return;
      const name = String(player?.name || player?.player || "").trim();
      if(name) assignments[slot.key] = name;
    });
    return { formation: layout.formation, slots: layout.slots, assignments };
  }

  function listTeamProfilePlayers(db, teamId = ""){
    if(!teamId) return [];
    return (db.players || [])
      .filter((p)=>p && p.teamId===teamId)
      .map((p)=>({ id: p.id, name: String(p.name || "").trim(), pos: normalizePlayerPos(p.pos) }))
      .filter((p)=>p.name)
      .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity: "base" }));
  }

  function buildFormationLayout(formation = "4-3-3"){
    const token = String(formation || "4-3-3").trim();
    const lines = token.split(/[-\s]+/).map((n)=>Math.max(0, Number(n) || 0)).filter((n)=>n>0);
    const normalized = lines.length ? lines : [4, 3, 3];
    const slots = [{ key: "GK", label: "POR", line: 0, x: 50, y: 92 }];
    const rowCount = normalized.length;
    normalized.forEach((count, rowIdx)=>{
      const y = 18 + (rowIdx * (65 / Math.max(1, rowCount - 1)));
      for(let i = 0; i < count; i += 1){
        const x = ((i + 1) * 100) / (count + 1);
        slots.push({ key: `L${rowIdx+1}P${i+1}`, label: `${rowIdx+1}.${i+1}`, line: rowIdx + 1, x, y });
      }
    });
    return { formation: normalized.join("-"), slots };
  }

  function buildLineupFromShape(shape = null){
    if(!shape || !Array.isArray(shape.slots)) return [];
    const assignments = shape.assignments || {};
    return shape.slots
      .map((slot)=>String(assignments[slot.key] || "").trim())
      .filter(Boolean)
      .slice(0, 11)
      .reduce((acc, name)=>acc.includes(name) ? acc : [...acc, name], []);
  }

  function getTeamMatchSide(match, teamId){
    if(!match || !teamId) return null;
    if(match.homeId===teamId) return "home";
    if(match.awayId===teamId) return "away";
    return null;
  }

  function getRecentTeamMatches(db, teamId, limit = 5){
    return (db.tracker || [])
      .filter((m)=>m.homeId===teamId || m.awayId===teamId)
      .sort(compareByDateAsc)
      .slice(-limit);
  }

  function parseScorePair(score = ""){
    const hit = String(score || "").match(/(\d+)\s*[-:]\s*(\d+)/);
    if(!hit) return null;
    return { gf: Number(hit[1]) || 0, ga: Number(hit[2]) || 0 };
  }

  function mapBrainMemoryRowToReadinessMatch(row = {}, teamId = ""){
    const parsed = parseScorePair(row.score);
    const lineup = parseLineupList(row.lineup || row.startingXI || []);
    const formation = String(row?.lineupShape?.formation || row?.formation || "").trim();
    return ensureTrackerMatchState({
      id: row.id || uid("b2mread"),
      date: row.date || "",
      leagueId: row.leagueId || "",
      homeId: teamId,
      awayId: `${teamId}_opponent`,
      homeGoals: parsed?.gf || 0,
      awayGoals: parsed?.ga || 0,
      homeLineup: lineup,
      awayLineup: [],
      homeFormation: formation,
      awayFormation: "",
      source: "brainV2.memories"
    });
  }

  function getReadinessEvidenceSummary(evidence = {}, teamName = ""){
    const aliases = resolveTeamAliases(teamName).slice(0, 3).join(", ");
    return {
      source: evidence.source || "brainV2.memories",
      samplesLabel: `${teamName || "Equipo"}: ${Number(evidence.totalMatches) || 0} juegos en memoria`,
      selectedLabel: `Muestras usadas: ${Number(evidence.usedMatches) || 0}${Number(evidence.selectedMatches) > Number(evidence.usedMatches) ? ` de ${Number(evidence.selectedMatches)}` : ""}`,
      filterLabel: evidence.filterLabel || "all competitions",
      fallbackLabel: evidence.leagueFallback ? "sí (liga→all competitions)" : "no",
      aliasLabel: aliases || "n/a",
      raw: evidence
    };
  }

  function computeMatchReadinessEngine(db, teamId, options = {}){
    const brainV2 = options.brainV2 || loadBrainV2();
    const teamName = options.teamName || db?.teams?.find((t)=>t.id===teamId)?.name || "";
    const memoryDataset = collectMatchesForTeam({
      memories: brainV2?.memories || {},
      teamId,
      teamName,
      leagueId: options.leagueId || "",
      limit: Number(options.limit) || 5
    });
    const matches = memoryDataset.rows.length
      ? memoryDataset.rows.map((row)=>mapBrainMemoryRowToReadinessMatch(row, teamId))
      : getRecentTeamMatches(db, teamId, 5).map((row)=>ensureTrackerMatchState({ ...row, source: "db.tracker" }));
    const evidence = memoryDataset.rows.length
      ? getReadinessEvidenceSummary(memoryDataset.evidence, teamName)
      : getReadinessEvidenceSummary({
        source: "db.tracker",
        totalMatches: matches.length,
        usedMatches: matches.length,
        selectedMatches: matches.length,
        filterLabel: "tracker fallback",
        leagueFallback: false
      }, teamName);
    if(!matches.length){
      return {
        readinessScore: 50,
        mentalState: "sin_datos",
        tacticalCohesion: 50,
        lineupStability: 50,
        chemistry: 50,
        coachClarity: 50,
        confidence: 50,
        volatility: 50,
        collapseRate: 0.5,
        systemStability: 50,
        verdict: "Sin datos suficientes",
        evidence: {
          ...evidence,
          reason: "No se encontraron partidos válidos en memoria ni tracker",
          fallback: true
        }
      };
    }

    const lineupKeys = [];
    const formations = [];
    const chemistryPairs = {};
    let collapseSum = 0;
    let confidenceSum = 0;
    let coachChaosSum = 0;
    let rotationNoiseAcc = 0;
    let emotionalRiskSum = 0;
    let collapseIndexSum = 0;
    let redCardRiskAcc = 0;
    let collapseRiskAcc = 0;
    let chaosAcc = 0;
    let lateChaosAcc = 0;
    let switchRiskAcc = 0;

    matches.forEach((m, idx)=>{
      ensureTrackerMatchState(m);
      const side = getTeamMatchSide(m, teamId);
      if(!side) return;
      const isHome = side === "home";
      const gf = Number(isHome ? m.homeGoals : m.awayGoals) || 0;
      const ga = Number(isHome ? m.awayGoals : m.homeGoals) || 0;
      const xg = Number(isHome ? m.homeXg : m.awayXg) || 0;
      const shotsOT = Number(isHome ? m.homeShotsOnTarget : m.awayShotsOnTarget) || 0;
      const yellows = Number(isHome ? m.homeYellow : m.awayYellow) || 0;
      const errorsConcede = Number(isHome ? m.homeErrorsLeadingConcede : m.awayErrorsLeadingConcede) || 0;
      const cardsAfterMistake = Number(isHome ? m.homeCardsAfterMistake : m.awayCardsAfterMistake) || 0;
      const concededAfterMiss = Number(isHome ? m.homeConcededAfterMiss : m.awayConcededAfterMiss) || 0;
      const earlySubs = Number(isHome ? m.homeEarlySubs : m.awayEarlySubs) || 0;
      const systemChanges = Number(isHome ? m.homeSystemChanges : m.awaySystemChanges) || 0;
      const yellowRateEarly = clamp(Number(isHome ? m.homeYellowRateEarly : m.awayYellowRateEarly) || (yellows / 4), 0, 1);
      const foulsRateEarly = clamp(Number(isHome ? m.homeFoulsRateEarly : m.awayFoulsRateEarly) || ((Number(isHome ? m.homeFouls : m.awayFouls) || 9) / 16), 0, 1);
      const complaintsRate = clamp(Number(isHome ? m.homeComplaintsRate : m.awayComplaintsRate) || (cardsAfterMistake / 3), 0, 1);
      const bigChanceMissReaction = clamp(Number(isHome ? m.homeBigChanceMissReaction : m.awayBigChanceMissReaction) || (concededAfterMiss / 2), 0, 1);
      const lateGoalsConceded = Math.max(0, Number(isHome ? m.homeLateGoalsConceded : m.awayLateGoalsConceded) || 0);
      const errorsAfterGoal = Math.max(0, Number(isHome ? m.homeErrorsAfterGoal : m.awayErrorsAfterGoal) || errorsConcede);
      const disciplineAfterGoal = clamp(Number(isHome ? m.homeDisciplineAfterGoal : m.awayDisciplineAfterGoal) || ((cardsAfterMistake + yellows * 0.3) / 3), 0, 1);
      const formation = String(isHome ? m.homeFormation : m.awayFormation || "").trim();
      const lineup = parseLineupList(isHome ? m.homeLineup : m.awayLineup);

      if(formation) formations.push(formation);
      if(lineup.length) lineupKeys.push(lineup.map((name)=>name.toLowerCase()).sort().join("|"));
      lineup.forEach((a, i)=>{
        for(let j=i+1; j<lineup.length; j++){
          const b = lineup[j];
          const key = [a,b].map((n)=>n.toLowerCase()).sort().join("~");
          chemistryPairs[key] = (chemistryPairs[key] || 0) + 1;
        }
      });

      const collapse = errorsConcede + cardsAfterMistake + concededAfterMiss;
      collapseSum += collapse;
      const emotionalRisk = clamp(
        0.35*yellowRateEarly +
        0.25*foulsRateEarly +
        0.20*bigChanceMissReaction +
        0.20*complaintsRate,
        0,
        1
      );
      emotionalRiskSum += emotionalRisk;
      if(emotionalRisk > 0.6){
        redCardRiskAcc += 0.12;
        collapseRiskAcc += 0.15;
        chaosAcc += 0.10;
      }

      const lateConceded = clamp(lateGoalsConceded / 2, 0, 1);
      const structureLoss = clamp(errorsAfterGoal / 3, 0, 1);
      const collapseIndex = clamp(
        0.4*lateConceded +
        0.3*disciplineAfterGoal +
        0.3*structureLoss,
        0,
        1
      );
      collapseIndexSum += collapseIndex;
      if(collapseIndex > 0.6){
        lateChaosAcc += 0.15;
        switchRiskAcc += 0.12;
      }

      const reaction = gf - ga;
      const finishingFailure = Math.max(0, xg - gf);
      const confidenceRaw = clamp((shotsOT * 8) + (reaction * 12) - (finishingFailure * 10) - (yellows * 4), 0, 100);
      confidenceSum += confidenceRaw;
      coachChaosSum += clamp((earlySubs * 20) + (systemChanges * 25), 0, 100);

      if(idx>0){
        const prev = matches[idx-1];
        const prevSide = getTeamMatchSide(prev, teamId);
        const prevLineup = parseLineupList(prevSide==="home" ? prev.homeLineup : prev.awayLineup);
        const changes = Math.max(0, lineup.length + prevLineup.length - (2 * prevLineup.filter((p)=>lineup.includes(p)).length));
        rotationNoiseAcc += changes;
      }
    });

    const avgCollapse = collapseSum / matches.length;
    const collapseRate = clamp(avgCollapse / 5, 0, 1);
    const confidenceTrend = clamp((confidenceSum / matches.length) / 100, 0, 1);
    const emotionalRisk = clamp(emotionalRiskSum / matches.length, 0, 1);
    const collapseIndex = clamp(collapseIndexSum / matches.length, 0, 1);
    const redCardRisk = clamp(redCardRiskAcc / matches.length, 0, 1);
    const collapseRisk = clamp((collapseRiskAcc / matches.length) + collapseRate*0.45 + collapseIndex*0.25, 0, 1);
    const chaos = clamp((chaosAcc / matches.length) + collapseIndex*0.2 + collapseRate*0.15, 0, 1);
    const lateChaos = clamp((lateChaosAcc / matches.length), 0, 1);
    const switchRisk = clamp((switchRiskAcc / matches.length), 0, 1);
    const lineupStability = lineupKeys.length > 1
      ? clamp((new Set(lineupKeys).size === 1 ? 1 : 1 - ((new Set(lineupKeys).size - 1) / lineupKeys.length)), 0, 1)
      : 0.5;
    const rotationNoise = matches.length > 1 ? rotationNoiseAcc / (matches.length - 1) : 0;
    const systemStability = formations.length > 1
      ? clamp(1 - ((new Set(formations).size - 1) / formations.length), 0, 1)
      : 0.6;
    const chemistryIndex = clamp(Object.values(chemistryPairs).filter((v)=>v>=2).length / Math.max(1, Object.keys(chemistryPairs).length), 0, 1);
    const coachClarity = clamp(1 - ((coachChaosSum / matches.length) / 100), 0, 1);
    const tacticalCohesion = clamp((lineupStability*0.45) + (systemStability*0.35) + (Math.max(0, 1 - (rotationNoise/6))*0.2), 0, 1);

    const readiness = (
      0.30*confidenceTrend +
      0.20*(1-collapseRate) +
      0.18*lineupStability +
      0.12*chemistryIndex +
      0.10*coachClarity +
      0.10*systemStability
    );
    const readinessScore = Math.round(clamp(readiness * 100, 0, 100));
    const volatility = Math.round(clamp((collapseRate*0.45 + (1-lineupStability)*0.25 + (1-coachClarity)*0.3) * 100, 0, 100));
    const mentalState = readinessScore < 30 ? "roto" : readinessScore < 45 ? "fragil" : readinessScore < 60 ? "inestable" : readinessScore < 75 ? "solido" : "enchufado";
    const verdict = readinessScore > 75 ? "Llega enchufado" : readinessScore >= 60 ? "Llega sólido" : readinessScore >= 45 ? "Llega inestable" : readinessScore >= 30 ? "No llega bien" : "Llega roto";

    return {
      readinessScore,
      mentalState,
      tacticalCohesion: Math.round(tacticalCohesion * 100),
      lineupStability: Math.round(lineupStability * 100),
      chemistry: Math.round(chemistryIndex * 100),
      coachClarity: Math.round(coachClarity * 100),
      confidence: Math.round(confidenceTrend * 100),
      volatility,
      collapseRate,
      emotionalRisk,
      redCardRisk,
      collapseRisk,
      chaos,
      collapseIndex,
      lateChaos,
      switchRisk,
      systemStability: Math.round(systemStability * 100),
      verdict,
      rotationNoise: Number(rotationNoise.toFixed(2)),
      evidence: {
        ...evidence,
        fallback: false
      }
    };
  }

  const MRE_TABLE_SCHEMA = [
    { key: "state", label: "Estado", fmt: "state" },
    { key: "score", label: "Score", fmt: "pct" },
    { key: "conf", label: "Confianza", fmt: "pct", path: ["factors", "conf"] },
    { key: "coh", label: "Cohesión", fmt: "pct", path: ["factors", "coh"] },
    { key: "xi", label: "Estabilidad XI", fmt: "pct", path: ["factors", "xi"] },
    { key: "chemistry", label: "Química", fmt: "pct", path: ["factors", "chemistry"] },
    { key: "coach", label: "DT claridad", fmt: "pct", path: ["factors", "coach"] },
    { key: "vol", label: "Volatilidad", fmt: "pct", path: ["factors", "vol"] },
    { key: "delta", label: "Ajuste MRE", fmt: "delta", path: ["adjustments", "deltaReadiness"] },
    { key: "chaos", label: "Chaos", fmt: "delta", path: ["adjustments", "chaosBoost"] }
  ];

  function toMreTeamModel(team = {}, readiness = {}, adjustments = {}){
    return {
      teamId: team.id || "",
      teamName: team.name || "",
      label: String(readiness.mentalState || "sin_datos").toUpperCase(),
      score: Number(readiness.readinessScore) || 0,
      factors: {
        conf: Number(readiness.confidence) || 0,
        coh: Number(readiness.tacticalCohesion) || 0,
        xi: Number(readiness.lineupStability) || 0,
        chemistry: Number(readiness.chemistry) || 0,
        coach: Number(readiness.coachClarity) || 0,
        vol: Number(readiness.volatility) || 0
      },
      adjustments: {
        deltaReadiness: Number(adjustments.deltaReadiness) || 0,
        chaosBoost: Number(adjustments.chaosBoost) || 0
      }
    };
  }

  function getPath(obj, path, fallback = null){
    if(!path) return fallback;
    let cur = obj;
    for(const key of path){
      if(cur == null || !(key in cur)) return fallback;
      cur = cur[key];
    }
    return cur;
  }

  function formatMreValue(fmt, value, team){
    if(fmt === "state") return `${team.label} · ${team.score}`;
    if(value == null) return "—";
    if(fmt === "pct") return `${Math.round(Number(value) || 0)}%`;
    if(fmt === "delta"){
      const n = Number(value) || 0;
      const sign = n > 0 ? "+" : "";
      return `${sign}${n.toFixed(1)}%`;
    }
    return String(value);
  }

  function compareMreValue(homeValue, awayValue, key){
    if(homeValue == null || awayValue == null) return "none";
    const lowerBetterKeys = new Set(["vol"]);
    if(lowerBetterKeys.has(key)){
      if(homeValue < awayValue) return "home";
      if(awayValue < homeValue) return "away";
      return "tie";
    }
    if(homeValue > awayValue) return "home";
    if(awayValue > homeValue) return "away";
    return "tie";
  }

  function interpretMreRow(winner){
    if(winner === "tie") return "igualados";
    if(winner === "none") return "sin datos";
    return winner === "home" ? "ventaja local" : "ventaja visita";
  }

  function buildMreComparisonRows(homeMre, awayMre){
    return MRE_TABLE_SCHEMA.map((schemaRow)=>{
      const homeRaw = schemaRow.key === "score"
        ? homeMre.score
        : schemaRow.key === "state"
          ? null
          : getPath(homeMre, schemaRow.path);
      const awayRaw = schemaRow.key === "score"
        ? awayMre.score
        : schemaRow.key === "state"
          ? null
          : getPath(awayMre, schemaRow.path);
      const winner = compareMreValue(homeRaw, awayRaw, schemaRow.key);
      return {
        label: schemaRow.label,
        homeText: formatMreValue(schemaRow.fmt, schemaRow.key === "state" ? 0 : homeRaw, homeMre),
        awayText: formatMreValue(schemaRow.fmt, schemaRow.key === "state" ? 0 : awayRaw, awayMre),
        winner,
        interpretation: interpretMreRow(winner)
      };
    });
  }

  function refreshOpponentStrengthSnapshots(db){
    const tableByLeague = new Map();
    const marketRows = [];
    (db?.tracker || []).forEach((match)=>{
      ensureTrackerMatchState(match);
      const market = clean1x2Probs(match.oddsHome, match.oddsDraw, match.oddsAway);
      match.opponentStrengthByTeam[match.homeId] = buildOpponentStrengthSnapshot({
        db,
        match,
        teamId: match.homeId,
        venue: "H",
        marketOdds: market,
        matchDate: match.date
      });
      match.opponentStrengthByTeam[match.awayId] = buildOpponentStrengthSnapshot({
        db,
        match,
        teamId: match.awayId,
        venue: "A",
        marketOdds: market,
        matchDate: match.date
      });
      if(match.leagueId){
        tableByLeague.set(match.leagueId, buildLeagueTableSnapshot(db, match.leagueId, match.date));
      }
      if(match.marketOddsSnapshot){
        marketRows.push(match.marketOddsSnapshot);
      }
    });
    db.leagueTableSnapshots = [...tableByLeague.values()].slice(-40);
    db.marketOddsSnapshots = marketRows.slice(-500);
  }

  function normName(value){
    return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  function ensureTeamInLeague(db, teamId, leagueId){
    if(!teamId || !leagueId) return;
    db.teamCompetitions ||= [];
    const exists = db.teamCompetitions.some(tc=>tc.teamId===teamId && tc.leagueId===leagueId);
    if(!exists) db.teamCompetitions.push({ teamId, leagueId, joinedAt: Date.now() });
  }

  function normalizeCompetitionType(type){
    const clean = String(type || "").trim().toLowerCase();
    if(["league","cup","continental","friendly"].includes(clean)) return clean;
    return "league";
  }

  function getCompetitionById(db, competitionId){
    return db.leagues.find((league)=>league.id===competitionId) || null;
  }

  function competitionTypeFromMatch(db, match){
    const byId = getCompetitionById(db, match?.competitionId || match?.leagueId || "");
    if(byId) return normalizeCompetitionType(byId.type);
    const competition = String(match?.competition || "").toLowerCase();
    if(/ucl|champions|europa|libertadores|continental/.test(competition)) return "continental";
    if(/copa|cup/.test(competition)) return "cup";
    if(/amistoso|friendly/.test(competition)) return "friendly";
    return "league";
  }

  function stakesModeFromMatch(db, match){
    return competitionTypeFromMatch(db, match)==="league" ? "table" : "knockout";
  }

  function getOrCreateTeamByName(db, name, defaults={}){
    const normalized = normName(name);
    if(!normalized) return null;
    let team = db.teams.find((t)=>{
      const aliases = Array.isArray(t.aliases) ? t.aliases : [];
      return normName(t.name)===normalized || aliases.some(a=>normName(a)===normalized);
    });
    if(team) return team;
    team = {
      id: uid("tm"),
      name: String(name).trim(),
      country: defaults.country || "",
      aliases: Array.isArray(defaults.aliases) ? defaults.aliases : [],
      apiTeamId: defaults.apiTeamId || "",
      createdAt: Date.now(),
      meta: defaults.meta || { stadium:"", city:"", capacity:"" }
    };
    db.teams.push(team);
    return team;
  }

  function getTeamIdsForLeague(db, leagueId){
    if(!leagueId) return [];
    const bridgeIds = (db.teamCompetitions || []).filter(tc=>tc.leagueId===leagueId).map(tc=>tc.teamId);
    const legacyIds = db.teams.filter(t=>t.leagueId===leagueId).map(t=>t.id);
    return [...new Set([...bridgeIds, ...legacyIds])];
  }

  function getTeamsForLeague(db, leagueId){
    const ids = new Set(getTeamIdsForLeague(db, leagueId));
    return db.teams.filter(t=>ids.has(t.id));
  }

  function getTeamCompetitions(db, teamId){
    const links = (db.teamCompetitions || []).filter(tc=>tc.teamId===teamId && tc.leagueId);
    const byId = new Set(links.map(tc=>tc.leagueId));
    return db.leagues
      .filter(l=>byId.has(l.id))
      .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
  }

  function upsertMirrorFutureMatch({ db, team, rival, match }){
    if(!team || !rival || !match) return;
    ensureTeamIntState(rival);
    const mirrorId = `mirror::${match.id}`;
    const payload = {
      ...match,
      id: mirrorId,
      mirrorOf: match.id,
      rivalryBoost: false,
      isHome: !Boolean(match.isHome),
      rivalTeamId: team.id
    };
    const idx = rival.futureMatches.findIndex(row=>row.id===mirrorId || row.mirrorOf===match.id);
    if(idx>=0) rival.futureMatches[idx] = { ...rival.futureMatches[idx], ...payload };
    else rival.futureMatches.push(payload);
  }

  function removeMirrorFutureMatch({ db, team, matchId }){
    if(!team || !matchId) return;
    db.teams.forEach((candidate)=>{
      if(candidate.id===team.id) return;
      ensureTeamIntState(candidate);
      candidate.futureMatches = (candidate.futureMatches || []).filter(row=>row.mirrorOf!==matchId && row.id!==`mirror::${matchId}`);
    });
  }

  async function apiFetch(path, token){
    const res = await fetch(`${FOOTBALL_DATA_BASE_URL}${path}`, {
      headers: { "X-Auth-Token": token }
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function ensureStyles(){
    if(document.getElementById("fl-clean-styles")) return;
    const style = document.createElement("style");
    style.id = "fl-clean-styles";
    style.textContent = `
      .fl-wrap{max-width:1100px;margin:18px auto;padding:0 12px;color:#e8edf3;font-family:Inter,system-ui,sans-serif}
      .fl-card{background:#161b22;border:1px solid #2d333b;border-radius:14px;padding:14px;margin-bottom:12px}
      .fl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .fl-grid{display:grid;gap:10px}
      .fl-grid.two{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
      .fl-btn,.fl-input,.fl-select,.fl-text{border-radius:10px;border:1px solid #2d333b;background:#0d1117;color:#e8edf3;padding:8px 10px}
      .fl-btn{cursor:pointer;font-weight:700}
      .fl-btn.active{background:#1f6feb}
      .fl-text{min-height:140px;width:100%;resize:vertical}
      .fl-title{font-size:22px;font-weight:900;margin-bottom:8px}
      .fl-muted{color:#9ca3af;font-size:13px}
      .fl-table{width:100%;border-collapse:collapse}
      .fl-table td,.fl-table th{border-bottom:1px solid #2d333b;padding:6px;text-align:left;font-size:13px}
      .fl-squad-section-title{font-size:30px;font-weight:900;margin-bottom:10px;color:#f6f8fa}
      .fl-squad-table{display:grid;gap:8px}
      .fl-squad-head,.fl-squad-row{display:grid;grid-template-columns:52px minmax(220px,1.6fr) 102px minmax(120px,.9fr) 54px 54px 74px 52px 52px 42px 42px;align-items:center;column-gap:8px}
      .fl-squad-head{background:#21262d;border:1px solid #30363d;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;letter-spacing:.07em;color:#9ca3af;text-transform:uppercase}
      .fl-squad-row{background:#1b222c;border:1px solid #30363d;border-radius:10px;padding:12px 10px;font-size:15px}
      .fl-squad-row:hover{background:#242d3a}
      .fl-squad-cell-center{text-align:center}
      .fl-squad-name{display:flex;align-items:center;gap:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fl-squad-heat{display:grid;gap:4px}
      .fl-squad-pos-select{width:100%;padding:6px 8px;border-radius:8px;border:1px solid #30363d;background:#0f141b;color:#f6f8fa;font-size:12px;font-weight:700}
      .fl-squad-heat-track{height:9px;border-radius:999px;background:#0d1117;border:1px solid #30363d;overflow:hidden}
      .fl-squad-heat-fill{height:100%;border-radius:999px;transition:width .25s ease}
      .fl-flag{font-size:16px;line-height:1}
      .fl-card-yellow{display:inline-block;width:10px;height:16px;border-radius:3px;background:#f5c400}
      .fl-card-red{display:inline-block;width:10px;height:16px;border-radius:3px;background:#e10600}
      .fl-vs-layout{display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1.25fr);gap:12px}
      .fl-vs-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
      .fl-vs-cell{border:1px solid #30363d;border-radius:8px;padding:6px;text-align:center;font-size:12px;background:#111722}
      .fl-vs-cell.head{background:#202a37;font-weight:800}
      .fl-vs-cell.hot{border-color:#2ea043;box-shadow:0 0 0 1px rgba(46,160,67,.25) inset}
      .fl-vs-cell.zone-home{background:rgba(46,160,67,.16)}
      .fl-vs-cell.zone-draw{background:rgba(242,201,76,.16)}
      .fl-vs-cell.zone-away{background:rgba(248,81,73,.14)}
      .fl-vs-bars{display:grid;gap:6px;margin-top:10px}
      .fl-vs-bar{display:grid;grid-template-columns:80px 1fr auto;gap:8px;align-items:center}
      .fl-vs-bar-track{height:10px;border-radius:999px;background:#0d1117;border:1px solid #30363d;overflow:hidden}
      .fl-vs-bar-fill{height:100%;background:linear-gradient(90deg,#1f6feb,#58a6ff)}
      .fl-kpi{display:grid;grid-template-columns:repeat(3,minmax(88px,1fr));gap:8px}
      .fl-kpi > div{background:#111722;border:1px solid #2d333b;border-radius:10px;padding:8px;text-align:center}
      .fl-kpi b{display:block;font-size:18px;color:#f6f8fa}
      .fl-mini{font-size:12px;color:#9ca3af}
      .fl-mre-table-wrap{margin-top:8px;border:1px solid #2d333b;border-radius:12px;overflow:hidden}
      .fl-mre-table{width:100%;border-collapse:collapse;font-size:12px}
      .fl-mre-table th,.fl-mre-table td{border-bottom:1px solid #2d333b;padding:8px 10px;text-align:left}
      .fl-mre-table th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;background:#111722}
      .fl-mre-table tr:last-child td{border-bottom:none}
      .fl-mre-table td.mre-label{font-weight:700;color:#c9d1d9}
      .fl-mre-table td.mre-reading{color:#9ca3af}
      .fl-mre-table td.mre-win-home,.fl-mre-table td.mre-win-away{font-weight:800;color:#3fb950;background:rgba(46,160,67,.12)}
      .fl-mre-table td.mre-tie{font-weight:700;color:#c9d1d9;background:rgba(139,148,158,.12)}
      .fl-chip{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #2d333b;background:#111722;font-size:12px}
      .fl-chip.ok{border-color:#238636;color:#3fb950}
      .fl-chip.warn{border-color:#d29922;color:#f2cc60}
      .fl-chip.bad{border-color:#da3633;color:#ff7b72}
      .fl-modal-backdrop{position:fixed;inset:0;background:rgba(1,4,9,.78);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(3px)}
      .fl-modal{width:min(760px,100%);max-height:92vh;overflow:auto;background:linear-gradient(180deg,#1a2330,#121922);border:1px solid #2f3d4f;border-radius:16px;box-shadow:0 20px 80px rgba(0,0,0,.45);padding:16px}
      .fl-modal-title{font-size:20px;font-weight:900}
      .fl-modal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
      .fl-field{display:grid;gap:6px}
      .fl-field label{font-size:12px;color:#9ca3af}
      .fl-lineup-board{position:relative;width:100%;height:420px;border:1px solid #2f3d4f;border-radius:14px;background:linear-gradient(180deg,#1b2633,#141d27);overflow:hidden}
      .fl-lineup-board::before{content:"";position:absolute;inset:16px;border:2px solid rgba(240,246,252,.2);border-radius:10px}
      .fl-lineup-board::after{content:"";position:absolute;left:50%;top:16px;bottom:16px;border-left:1px solid rgba(240,246,252,.15)}
      .fl-lineup-slot{position:absolute;transform:translate(-50%,-50%);display:grid;gap:4px;min-width:130px}
      .fl-lineup-slot-tag{font-size:10px;font-weight:800;letter-spacing:.05em;color:#9ca3af;text-align:center}
      .fl-lineup-slot-select{font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid #3a4a5f;background:#0d1117;color:#e8edf3}
      .context-box{border-left:4px solid #1f6feb}
      .b2-layout{display:grid;grid-template-columns:340px 1fr 400px;grid-template-rows:auto 1fr auto;min-height:100vh;gap:14px;background:#0d0f14;padding:14px;border-radius:14px}
      .b2-topbar{grid-column:1/-1;position:sticky;top:0;z-index:5;background:#0d0f14;border:1px solid #1e2330;border-radius:12px;padding:12px;display:grid;gap:10px}
      .b2-topbar-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center}
      .b2-brand{font-size:20px;font-weight:900;letter-spacing:.02em}
      .b2-kpi-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}
      .b2-stat-pill{background:#151820;border:1px solid #1e2330;border-radius:10px;padding:8px 10px;display:grid;gap:2px}
      .b2-stat-pill b{font-size:24px;line-height:1;color:#f0f0f0}
      .b2-health{border-radius:10px;padding:8px 10px;font-size:12px;font-weight:800;letter-spacing:.08em;display:flex;align-items:center;justify-content:center}
      .b2-health.active{background:rgba(34,211,163,.16);border:1px solid rgba(34,211,163,.4);color:#22d3a3;animation:b2Pulse 2s ease-in-out infinite}
      .b2-health.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#f59e0b}
      .b2-col-a{grid-column:1}.b2-col-b{grid-column:2}.b2-col-c{grid-column:3}.b2-bottom{grid-column:1/-1}
      .b2-card{background:#151820;border:1px solid #1e2330;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.3)}
      .b2-card-header{padding:10px 12px;border-bottom:1px solid #1e2330;font-size:12px;font-weight:800;letter-spacing:.08em;color:#8892a0}
      .b2-card-body{padding:12px}
      .b2-label{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#6b7280}
      .b2-sticky-panel{position:sticky;top:94px}
      .b2-col-c-sticky{position:sticky;top:94px}
      .b2-btn-primary{width:100%;background:#22d3a3;color:#0d0f14;border-color:#1cc99b}
      .b2-btn-sim{background:#60a5fa;border-color:#528fdd}
      .b2-btn-sim:hover,.b2-btn-primary:hover{transform:translateY(-1px)}
      .b2-memory-list{display:grid;gap:8px;margin-top:10px}
      .b2-memory-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;background:#151820;border:1px solid #1e2330;border-radius:10px;padding:10px;transition:all .15s ease}
      .b2-memory-row:hover{background:#1a1f2e;border-left:2px solid #22d3a3}
      .b2-memory-meta{display:flex;gap:8px;align-items:center;font-size:12px;color:#8892a0}
      .b2-memory-title{font-weight:700;margin:2px 0}
      .b2-memory-actions{display:flex;gap:6px;opacity:0;transform:translateX(6px);transition:all .15s ease}
      .b2-memory-row:hover .b2-memory-actions{opacity:1;transform:translateX(0)}
      .b2-score-chip{padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid #1e2330}
      .b2-score-chip.win{color:#22d3a3;border-color:rgba(34,211,163,.5);background:rgba(34,211,163,.12)}
      .b2-score-chip.loss{color:#ef4444;border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.12)}
      .b2-score-chip.draw{color:#9ca3af;border-color:#3b4252;background:rgba(148,163,184,.08)}
      .b2-vision-card{background:#151820;border:1px solid #1e2330;border-radius:12px;padding:12px}
      .b2-vision-card.b2-hero-show{border:2px solid #22d3a3}
      .b2-hero-enter{opacity:0;transform:translateY(8px) scale(.98);transition:all .4s ease}
      .b2-hero-show{opacity:1;transform:translateY(0) scale(1)}
      .b2-status-show{animation:b2Fade .25s ease}
      .b2-collapse{max-height:0;overflow:hidden;opacity:0;transition:max-height .25s ease,opacity .2s ease}
      .b2-collapse.is-open{max-height:1000px;opacity:1}
      .b2-btn-loading{position:relative;color:transparent!important;pointer-events:none}
      .b2-btn-loading::after{content:'';position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid rgba(255,255,255,.55);border-top-color:#fff;border-radius:50%;animation:b2Spin .8s linear infinite}
      .b2-btn-success{box-shadow:0 0 0 2px rgba(34,211,163,.35) inset;background:#22d3a3!important;color:#09120f!important}
      .b2-advanced-tools summary{cursor:pointer;list-style:none;font-weight:800;display:flex;justify-content:space-between;align-items:center}
      .b2-advanced-tools summary::-webkit-details-marker{display:none}
      .b2-col-b #b2GlobalLearningPanel details{margin-top:8px}
      .b2-col-b #b2GlobalLearningPanel summary{cursor:pointer;font-weight:800;padding:8px;border:1px solid #1e2330;border-radius:8px;background:#111722}
      @keyframes b2Spin{to{transform:rotate(360deg)}}
      @keyframes b2Fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
      @keyframes b2Pulse{0%,100%{box-shadow:0 0 0 0 rgba(34,211,163,.18)}50%{box-shadow:0 0 0 6px rgba(34,211,163,0)}}
      @media (max-width:1279px){.b2-layout{grid-template-columns:minmax(320px,1fr) minmax(320px,1fr)}.b2-col-a{grid-column:1}.b2-col-b{grid-column:2}.b2-col-c{grid-column:1}.b2-col-c-sticky,.b2-sticky-panel{position:static}}
      @media (max-width:767px){.b2-layout{grid-template-columns:1fr;padding:10px}.b2-col-a,.b2-col-b,.b2-col-c,.b2-bottom,.b2-topbar{grid-column:1}.b2-kpi-strip{grid-template-columns:repeat(2,minmax(120px,1fr))}}
      
    `;
    document.head.appendChild(style);
  }

  function ensureBitacoraState(raw){
    const base = {
      bank: 15,
      kellyFraction: 0.25,
      minUnit: 1,
      maxStakePct: 0.2,
      dailyGoalPct: 0.05,
      dailyRiskPct: 0.15,
      stopLoss: 2,
      stopWin: 1,
      maxBetsPerDay: 3,
      maxConsecutiveLosses: 2,
      targetDays: 7,
      targetMode: "amount",
      targetValue: 22,
      riskLevel: "balanceado",
      stopLossStreak: 2,
      autoMode: true,
      planStartBank: null,
      planStartDate: "",
      planTargetBank: null,
      pickCandidates: [],
      entries: []
    };
    const st = { ...base, ...(raw || {}) };
    st.bank = Math.max(1, Number(st.bank) || base.bank);
    st.kellyFraction = clamp(Number(st.kellyFraction) || base.kellyFraction, 0.05, 1);
    st.minUnit = Math.max(0.5, Number(st.minUnit) || base.minUnit);
    st.maxStakePct = clamp(Number(st.maxStakePct) || base.maxStakePct, 0.05, 0.5);
    st.dailyGoalPct = clamp(Number(st.dailyGoalPct) || base.dailyGoalPct, 0.01, 0.2);
    st.dailyRiskPct = clamp(Number(st.dailyRiskPct) || base.dailyRiskPct, 0.05, 0.4);
    st.stopLoss = Math.max(0.5, Number(st.stopLoss) || base.stopLoss);
    st.stopWin = Math.max(0.5, Number(st.stopWin) || base.stopWin);
    st.maxBetsPerDay = clamp(Number(st.maxBetsPerDay) || base.maxBetsPerDay, 2, 3);
    st.maxConsecutiveLosses = clamp(Number(st.maxConsecutiveLosses) || base.maxConsecutiveLosses, 1, 5);
    st.targetDays = clamp(Number(st.targetDays) || base.targetDays, 1, 30);
    st.targetMode = st.targetMode === "percent" ? "percent" : "amount";
    st.targetValue = Math.max(1, Number(st.targetValue) || base.targetValue);
    st.riskLevel = ["conservador","balanceado","agresivo"].includes(st.riskLevel) ? st.riskLevel : base.riskLevel;
    st.stopLossStreak = clamp(Number(st.stopLossStreak) || base.stopLossStreak, 1, 4);
    st.autoMode = st.autoMode !== false;
    st.planStartBank = Number.isFinite(Number(st.planStartBank)) ? Math.max(1, Number(st.planStartBank)) : null;
    st.planStartDate = String(st.planStartDate || "");
    st.planTargetBank = Number.isFinite(Number(st.planTargetBank)) ? Math.max(1, Number(st.planTargetBank)) : null;
    st.pickCandidates = Array.isArray(st.pickCandidates) ? st.pickCandidates : [];
    st.entries = Array.isArray(st.entries) ? st.entries : [];
    return st;
  }

  function ensureMarketMatchState(raw){
    const base = {
      matchId: "",
      label: "",
      fecha: "",
      liga: "",
      lambda: { home: null, away: null },
      probModel: { home: null, draw: null, away: null },
      cuotas: [],
      closingOdds: null,
      apuestaTomada: null,
      settlement: null
    };
    const row = { ...base, ...(raw || {}) };
    row.label = String(row.label || "").trim();
    row.lambda = {
      home: pickFirstNumber(row.lambda?.home),
      away: pickFirstNumber(row.lambda?.away)
    };
    row.probModel = {
      home: clamp(pickFirstNumber(row.probModel?.home) ?? 0, 0, 1),
      draw: clamp(pickFirstNumber(row.probModel?.draw) ?? 0, 0, 1),
      away: clamp(pickFirstNumber(row.probModel?.away) ?? 0, 0, 1)
    };
    const probSum = row.probModel.home + row.probModel.draw + row.probModel.away;
    if(probSum > 0){
      row.probModel.home /= probSum;
      row.probModel.draw /= probSum;
      row.probModel.away /= probSum;
    }
    row.cuotas = Array.isArray(row.cuotas) ? row.cuotas
      .map(q=>({
        timestamp: String(q?.timestamp || ""),
        home: pickFirstNumber(q?.home),
        draw: pickFirstNumber(q?.draw),
        away: pickFirstNumber(q?.away)
      }))
      .filter(q=>q.home>1 && q.draw>1 && q.away>1)
      .sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))) : [];
    row.closingOdds = row.closingOdds && row.closingOdds.home>1 && row.closingOdds.draw>1 && row.closingOdds.away>1
      ? {
        home: pickFirstNumber(row.closingOdds.home),
        draw: pickFirstNumber(row.closingOdds.draw),
        away: pickFirstNumber(row.closingOdds.away)
      }
      : null;
    if(row.apuestaTomada){
      row.apuestaTomada = {
        side: ["home","draw","away"].includes(row.apuestaTomada.side) ? row.apuestaTomada.side : "home",
        cuota: Math.max(1.01, pickFirstNumber(row.apuestaTomada.cuota) || 1.01),
        probModelo: clamp(pickFirstNumber(row.apuestaTomada.probModelo) ?? 0.01, 0.01, 0.99),
        stake: Math.max(0, pickFirstNumber(row.apuestaTomada.stake) || 0),
        timestamp: String(row.apuestaTomada.timestamp || "")
      };
    }
    row.settlement = row.settlement && typeof row.settlement === "object" ? row.settlement : null;
    return row;
  }

  function marketProbsFromOdds(odds){
    if(!odds) return null;
    return clean1x2Probs(odds.home, odds.draw, odds.away);
  }

  function marketRecordMetrics(record){
    const latestOdds = record.cuotas[record.cuotas.length - 1] || null;
    const initialOdds = record.cuotas[0] || null;
    const marketLatest = marketProbsFromOdds(latestOdds);
    const marketInitial = marketProbsFromOdds(initialOdds);
    const side = record.apuestaTomada?.side || "home";
    const modelP = Number(record.probModel?.[side]) || 0;
    const marketP = Number(marketLatest?.[`p${side[0].toUpperCase()}${side.slice(1)}`] || (side === "draw" ? marketLatest?.pD : null) || (side === "away" ? marketLatest?.pA : marketLatest?.pH)) || 0;
    const currentOdd = Number(latestOdds?.[side]) || 0;
    const initialOdd = Number(initialOdds?.[side]) || currentOdd;
    const evCurrent = currentOdd > 1 ? (modelP * currentOdd) - 1 : null;
    const evInitial = initialOdd > 1 ? (modelP * initialOdd) - 1 : null;
    const edge = modelP - marketP;
    const drift = initialOdd > 0 ? (currentOdd - initialOdd) / initialOdd : 0;
    const signedMoves = record.cuotas.length > 1
      ? record.cuotas.slice(1).map((q, idx)=>{
        const prev = Number(record.cuotas[idx]?.[side]) || 0;
        const next = Number(q?.[side]) || prev;
        return prev > 1 ? (next - prev) / prev : 0;
      })
      : [];
    const volatility = signedMoves.length
      ? signedMoves.reduce((acc, mv)=>acc + Math.abs(mv), 0) / signedMoves.length
      : 0;
    const acceleration = signedMoves.length > 1
      ? signedMoves.slice(1).reduce((peak, mv, idx)=>Math.max(peak, Math.abs(mv - signedMoves[idx])), 0)
      : 0;
    const persistence = signedMoves.reduce((state, mv)=>{
      const dir = mv > 0 ? 1 : (mv < 0 ? -1 : 0);
      if(!dir) return { streak: 0, maxStreak: state.maxStreak, lastDir: state.lastDir, reversals: state.reversals };
      const streak = dir === state.lastDir ? state.streak + 1 : 1;
      const reversals = state.lastDir && dir !== state.lastDir ? state.reversals + 1 : state.reversals;
      return { streak, maxStreak: Math.max(state.maxStreak, streak), lastDir: dir, reversals };
    }, { streak: 0, maxStreak: 0, lastDir: 0, reversals: 0 });
    const firstTsRaw = Date.parse(initialOdds?.timestamp || "");
    const lastTsRaw = Date.parse(latestOdds?.timestamp || "");
    const elapsedHours = Number.isFinite(firstTsRaw) && Number.isFinite(lastTsRaw) && lastTsRaw > firstTsRaw
      ? (lastTsRaw - firstTsRaw) / 36e5
      : 0;
    const velocity = elapsedHours > 0 ? drift / elapsedHours : 0;
    const directionSingle = persistence.maxStreak >= 2 && persistence.reversals === 0;
    const isEarlyMoney = Math.abs(drift) > 0.05 && elapsedHours > 0 && elapsedHours <= 12 && directionSingle && persistence.maxStreak >= 2;
    const isStable = Math.abs(drift) < 0.03 && Math.abs(velocity) < 0.004 && persistence.reversals > 0;
    const isVolatile = !isEarlyMoney && (Math.abs(drift) >= 0.04 && persistence.reversals >= 1 && volatility > 0.025);
    const marketState = isEarlyMoney
      ? "early_money"
      : (isStable ? "stable" : (isVolatile ? "volatile" : "neutral"));
    const marketStateLabel = marketState === "early_money"
      ? "🔴 Dinero temprano detectado"
      : (marketState === "stable"
        ? "🟢 Mercado estable"
        : (marketState === "volatile" ? "🟠 Mercado volátil / especulativo" : "🟡 Mercado mixto"));
    const stabilityScore = clamp(100 - (Math.abs(drift) * 50) - (volatility * 30), 0, 100);
    const stabilityBand = stabilityScore >= 70 ? "estable" : (stabilityScore >= 40 ? "moderado" : "agresivo");
    const closing = record.closingOdds?.[side] || null;
    const clv = record.apuestaTomada && closing ? record.apuestaTomada.cuota - closing : null;
    const initialMarketP = side === "home" ? marketInitial?.pH : side === "draw" ? marketInitial?.pD : marketInitial?.pA;
    const convergence = marketInitial
      ? Math.abs(modelP - marketP) < Math.abs(modelP - initialMarketP)
      : null;
    const convergenceDelta = Number.isFinite(initialMarketP) ? Math.abs(modelP - initialMarketP) - Math.abs(modelP - marketP) : null;
    const earlyMoneyAgainst = isEarlyMoney && drift > 0;
    const earlyMoneyWith = isEarlyMoney && drift < 0;
    const strategySignal = (edge > 0.04 && (evCurrent || 0) > 0 && earlyMoneyWith)
      ? "Regla A: Modelo + dinero temprano a favor → confirmación fuerte"
      : ((edge > 0.04 && (evCurrent || 0) > 0 && earlyMoneyAgainst)
        ? "Regla B: Modelo vs dinero temprano contrario → no apostar"
        : ((edge > 0.06 && marketState === "stable")
          ? "Regla C: Mercado estable + edge alto → entrada anticipada ideal"
          : "Sin confirmación estratégica fuerte"));
    return {
      side,
      modelP,
      marketP,
      currentOdd,
      evCurrent,
      evInitial,
      edge,
      drift,
      volatility,
      acceleration,
      persistence: persistence.maxStreak,
      reversals: persistence.reversals,
      elapsedHours,
      velocity,
      marketState,
      marketStateLabel,
      stabilityScore,
      stabilityBand,
      clv,
      convergence,
      convergenceDelta,
      earlyMoneyAgainst,
      earlyMoneyWith,
      strategySignal
    };
  }

  function marketRowLabel(db, row){
    const customLabel = String(row?.label || "").trim();
    if(customLabel) return customLabel;
    const linked = db.tracker.find((m)=>m.id===row.matchId);
    if(linked){
      const home = db.teams.find(t=>t.id===linked.homeId)?.name || "Local";
      const away = db.teams.find(t=>t.id===linked.awayId)?.name || "Visitante";
      return `${home} vs ${away}`;
    }
    return String(row.matchId || "Partido manual");
  }

  function calcBitacoraSuggestion({ bank, odds, probability, kellyFraction, minUnit, maxStakePct }){
    const b = Math.max(0, Number(odds) - 1);
    const p = clamp(Number(probability) || 0, 0, 1);
    const q = 1 - p;
    const ev = p * b - q;
    const kellyStar = b > 0 ? (p * b - q) / b : -1;
    const frac = Math.max(0, kellyStar * (Number(kellyFraction) || 0.25));
    const rawStake = Math.max(0, frac * Number(bank || 0));
    const maxStake = Math.max(Number(minUnit) || 1, (Number(bank) || 0) * (Number(maxStakePct) || 0.2));
    const rounded = Math.round(rawStake / minUnit) * minUnit;
    const suggestedStake = ev > 0
      ? clamp(Math.max(minUnit, rounded || minUnit), minUnit, maxStake)
      : 0;
    return { ev, b, kellyStar, frac, rawStake, suggestedStake, noBet: ev <= 0 };
  }

  function projectBankroll({ bank, p, odds, stake, steps=12, paths=1000 }){
    const safeStake = Math.max(0.01, Number(stake) || 0);
    const safeOdds = Math.max(1.01, Number(odds) || 1.01);
    const safeP = clamp(Number(p) || 0.5, 0.01, 0.99);
    const walk = Array.from({ length: paths }, ()=>{
      let b = Number(bank) || 0;
      const line = [b];
      for(let i=0;i<steps;i++){
        const win = Math.random() < safeP;
        b += win ? safeStake * (safeOdds - 1) : -safeStake;
        line.push(b);
      }
      return line;
    });
    const quant = (arr, q)=>{
      const sorted = [...arr].sort((a,b)=>a-b);
      const idx = Math.floor((sorted.length - 1) * q);
      return sorted[idx] ?? 0;
    };
    return Array.from({ length: steps + 1 }, (_v, idx)=>{
      const bucket = walk.map(pth=>pth[idx]);
      const mean = bucket.reduce((s,v)=>s+v,0) / (bucket.length || 1);
      return { step: idx, mean, p10: quant(bucket, 0.1), p90: quant(bucket, 0.9) };
    });
  }

  function getRiskProfile(level){
    const map = {
      conservador: {
        label: "Conservador",
        oddsMin: 1.3,
        oddsMax: 1.55,
        baseEv: 0.01,
        kellyFactor: 0.2,
        maxStakePct: 0.12
      },
      balanceado: {
        label: "Balanceado",
        oddsMin: 1.4,
        oddsMax: 1.75,
        baseEv: 0.02,
        kellyFactor: 0.25,
        maxStakePct: 0.18
      },
      agresivo: {
        label: "Agresivo",
        oddsMin: 1.6,
        oddsMax: 2.2,
        baseEv: 0.03,
        kellyFactor: 0.3,
        maxStakePct: 0.25
      }
    };
    return map[level] || map.balanceado;
  }

  function unitForBank(bank){
    const b = Number(bank) || 0;
    if(b < 20) return 1;
    if(b < 50) return 2;
    if(b < 100) return 3;
    if(b < 180) return 4;
    if(b < 300) return 5;
    return Math.max(6, Math.round(b/50));
  }

  function computeBitacoraPlan(st, todayEntries){
    const profile = getRiskProfile(st.riskLevel);
    const targetDays = clamp(Math.round(Number(st.targetDays) || 7), 1, 30);
    const targetMode = st.targetMode === "percent" ? "percent" : "amount";
    const bank = Math.max(1, Number(st.bank) || 1);
    const planStartBank = Math.max(1, Number(st.planStartBank) || bank);
    const targetValue = Math.max(targetMode === "percent" ? 1 : bank + 1, Number(st.targetValue) || (targetMode === "percent" ? 25 : bank * 1.25));
    const targetBank = targetMode === "percent"
      ? planStartBank * (1 + targetValue/100)
      : Math.max(targetValue, planStartBank + 1);
    const totalGoal = Math.max(0.1, targetBank - planStartBank);
    const progressProfit = bank - planStartBank;
    const progressPct = clamp(progressProfit / totalGoal, -2, 2);
    const remainingToTarget = Math.max(0, targetBank - bank);
    const remainingPct = clamp(1 - progressPct, 0, 3);
    const dailyGoal = totalGoal / targetDays;
    const avgOdds = (profile.oddsMin + profile.oddsMax) / 2;
    const pRequired = clamp(1/avgOdds + profile.baseEv, 0.45, 0.92);
    const unit = unitForBank(bank);
    const lossesToday = todayEntries.filter(e=>e.result === "loss").length;
    const consecutiveLosses = (()=>{
      let streak = 0;
      for(let i=todayEntries.length-1;i>=0;i--){
        if(todayEntries[i].result === "loss") streak += 1;
        else break;
      }
      return streak;
    })();
    const isWinningDay = todayEntries.reduce((s,e)=>s+(Number(e.profit)||0),0) > 0;
    const streakStop = consecutiveLosses >= st.stopLossStreak;
    let stakeMult = 1;
    let evGate = profile.baseEv;
    if(isWinningDay && !streakStop){
      stakeMult = 1.15;
    }
    if(lossesToday >= 1){
      stakeMult = Math.min(stakeMult, 0.8);
      evGate += 0.01;
    }
    if(lossesToday >= 2){
      stakeMult = 0.65;
      evGate += 0.015;
    }
    const stepStakes = [
      Math.max(st.minUnit, Math.round((unit * stakeMult) / st.minUnit) * st.minUnit),
      Math.max(st.minUnit, Math.round((unit * 1.25 * stakeMult) / st.minUnit) * st.minUnit),
      Math.max(st.minUnit, Math.round((unit * 1.5 * stakeMult) / st.minUnit) * st.minUnit)
    ];
    const maxStake = Math.max(st.minUnit, bank * Math.min(profile.maxStakePct, st.maxStakePct));
    return {
      profile,
      targetDays,
      targetMode,
      targetValue,
      planStartBank,
      targetBank,
      totalGoal,
      progressProfit,
      progressPct,
      remainingToTarget,
      remainingPct,
      dailyGoal,
      avgOdds,
      pRequired,
      unit,
      lossesToday,
      consecutiveLosses,
      streakStop,
      stepStakes: stepStakes.map(v=>clamp(v, st.minUnit, maxStake)),
      evGate,
      recoveryMode: lossesToday >= 1
    };
  }

  function bitacoraRoadmap(plan, dayIndex, bank){
    const checkpoints = [
      { id: "base", label: "Base", pct: 0.25 },
      { id: "run", label: "Tracción", pct: 0.5 },
      { id: "close", label: "Cierre", pct: 0.75 },
      { id: "goal", label: "Meta", pct: 1 }
    ];
    return checkpoints.map(cp=>{
      const checkpointBank = plan.planStartBank + (plan.totalGoal * cp.pct);
      const checkpointDay = Math.max(1, Math.round(plan.targetDays * cp.pct));
      const reached = bank >= checkpointBank;
      const expectedByNow = dayIndex >= checkpointDay;
      const gap = bank - checkpointBank;
      return {
        ...cp,
        checkpointBank,
        checkpointDay,
        reached,
        expectedByNow,
        gap
      };
    });
  }

  function evaluatePickCandidate({ odds, pFinal, pMkt, pickType }, st, plan, todayState){
    const implied = odds > 1 ? 1 / odds : 0;
    const marketRef = Number.isFinite(pMkt) && pMkt > 0 ? pMkt : implied;
    const edge = pFinal - marketRef;
    const ev = (pFinal * odds) - 1;
    const b = Math.max(0.0001, odds - 1);
    const kelly = clamp((pFinal * b - (1 - pFinal)) / b, -1, 1);
    const fractionalKelly = Math.max(0, kelly * st.kellyFraction);
    const rawStake = (Number(st.bank) || 0) * fractionalKelly;
    let stake = Math.max(st.minUnit, Math.round(rawStake / st.minUnit) * st.minUnit);
    if(todayState.result === "winning") stake *= 1.15;
    if(todayState.result === "losing") stake *= 0.8;
    stake = clamp(stake, st.minUnit, Math.max(st.minUnit, st.bank * st.maxStakePct));
    let label = "🔴 No toca hoy";
    let reason = "No cumple EV o rango de cuota del plan.";
    let confidence = 0.35;
    if(ev >= plan.evGate && odds >= plan.profile.oddsMin && odds <= plan.profile.oddsMax){
      label = "🟢 Apta para plan";
      reason = "Cumple EV mínima y está dentro del rango de cuota objetivo.";
      confidence = 0.82;
    }else if(ev > 0){
      label = "🟡 Solo si vas ganando";
      reason = "Tiene EV positivo, pero fuera de la zona óptima del plan.";
      confidence = 0.6;
    }
    if(plan.streakStop){
      label = "🔴 Día bloqueado por racha";
      reason = "Se activó el freno por pérdidas consecutivas.";
      confidence = 0.15;
    }
    const flexibility = clamp(1 - Math.abs(odds - ((plan.profile.oddsMin + plan.profile.oddsMax)/2)) / Math.max(0.2, plan.profile.oddsMax - plan.profile.oddsMin), 0, 1);
    return {
      pickType,
      odds,
      pFinal,
      pMkt: marketRef,
      edge,
      ev,
      kelly: fractionalKelly,
      stake,
      label,
      reason,
      confidence,
      flexibility
    };
  }

  function sparklinePath(values, width=640, height=200, minY=null, maxY=null){
    if(!values.length) return "";
    const low = minY ?? Math.min(...values);
    const high = maxY ?? Math.max(...values);
    const spread = (high - low) || 1;
    return values.map((v,i)=>{
      const x = values.length===1 ? 0 : (i/(values.length-1))*width;
      const y = height - ((v - low) / spread) * height;
      return `${i===0?"M":"L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
  }

  function pickFirstNumber(...values){
    for(const value of values){
      if(value===null || value===undefined || value==="") continue;
      const raw = typeof value === "string" ? value.replace(",", ".") : value;
      const n = Number(raw);
      if(Number.isFinite(n)) return n;
    }
    return null;
  }

  function pickFirstString(...values){
    for(const value of values){
      if(typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function teamStrength(db, teamId){
    const players = db.players.filter(p=>p.teamId===teamId);
    if(!players.length) return 1.0;
    const avg = players.reduce((acc,p)=>acc+(Number(p.rating)||5),0)/players.length;
    return Math.max(0.6, avg/5);
  }

  function poisson(lambda, goals){
    let fact = 1;
    for(let i=2;i<=goals;i++) fact*=i;
    return (Math.exp(-lambda) * (lambda**goals))/fact;
  }

  function impliedProb(odd){
    const n = Number(odd);
    if(!Number.isFinite(n) || n<=1.01) return null;
    return 1/n;
  }

  function clean1x2Probs(oddH, oddD, oddA){
    const pH = impliedProb(oddH);
    const pD = impliedProb(oddD);
    const pA = impliedProb(oddA);
    if(pH===null || pD===null || pA===null) return null;
    const overround = pH+pD+pA;
    if(!overround) return null;
    return { pH: pH/overround, pD: pD/overround, pA: pA/overround };
  }

  function eloToStrength01(elo=1500){
    const x = (Number(elo || 1500) - 1500) / 200;
    return 1 / (1 + Math.exp(-x));
  }

  function tableToStrength01(rank=10, total=20, points=0, played=0){
    const safeTotal = Math.max(2, Number(total) || 20);
    const safeRank = clamp(Number(rank) || safeTotal, 1, safeTotal);
    const strengthRank = 1 - ((safeRank - 1) / (safeTotal - 1));
    const ppg = (Number(points) || 0) / Math.max(1, Number(played) || 0);
    const ppg01 = clamp((ppg - 0.5) / 2, 0, 1);
    return clamp(strengthRank * 0.6 + ppg01 * 0.4, 0, 1);
  }

  function confidenceElo(matchesCount=0){
    return clamp((Number(matchesCount) || 0) / 20, 0.2, 1);
  }

  function confidenceTable(played=0, totalMatchdays=38){
    const progress = (Number(played) || 0) / Math.max(1, Number(totalMatchdays) || 38);
    return clamp(0.3 + 0.7 * progress, 0.3, 1);
  }

  function confidenceMarket({ hasDrawOdds=true, snapshotTooEarly=false }={}){
    let conf = 0.9;
    if(!hasDrawOdds) conf -= 0.2;
    if(snapshotTooEarly) conf -= 0.2;
    return clamp(conf, 0.4, 1);
  }

  function normalizeDynamicWeights({ base, conf }){
    let wE = (Number(base.elo) || 0) * (Number(conf.elo) || 0);
    let wT = (Number(base.table) || 0) * (Number(conf.table) || 0);
    let wM = (Number(base.market) || 0) * (Number(conf.market) || 0);
    const sum = wE + wT + wM;
    if(sum<=0) return { elo: 0.5, table: 0.5, market: 0 };
    wE /= sum; wT /= sum; wM /= sum;
    return { elo: wE, table: wT, market: wM };
  }

  function rebuildTeamRatings(db){
    const ratings = {};
    const KByMatches = (matchesCount=0)=>matchesCount<10 ? 40 : matchesCount<30 ? 25 : 18;
    const matches = (db?.tracker || []).slice().sort(compareByDateAsc);
    matches.forEach((m)=>{
      if(!m?.homeId || !m?.awayId) return;
      const h = ratings[m.homeId] || { teamId: m.homeId, rating: 1500, matchesCount: 0, lastUpdated: "" };
      const a = ratings[m.awayId] || { teamId: m.awayId, rating: 1500, matchesCount: 0, lastUpdated: "" };
      const homeAdvElo = 70;
      const expectedHome = 1 / (1 + Math.pow(10, ((a.rating - (h.rating + homeAdvElo)) / 400)));
      const expectedAway = 1 - expectedHome;
      const hg = Number(m.homeGoals) || 0;
      const ag = Number(m.awayGoals) || 0;
      const scoreHome = hg>ag ? 1 : hg===ag ? 0.5 : 0;
      const scoreAway = 1 - scoreHome;
      h.rating += KByMatches(h.matchesCount) * (scoreHome - expectedHome);
      a.rating += KByMatches(a.matchesCount) * (scoreAway - expectedAway);
      h.matchesCount += 1;
      a.matchesCount += 1;
      h.lastUpdated = m.date || h.lastUpdated;
      a.lastUpdated = m.date || a.lastUpdated;
      ratings[m.homeId] = h;
      ratings[m.awayId] = a;
    });
    db.teamRatings = ratings;
  }

  function buildLeagueTableSnapshot(db, leagueId="", date=""){
    const matches = (db?.tracker || [])
      .filter((m)=>!leagueId || m.leagueId===leagueId)
      .filter((m)=>!date || String(m.date || "")<=String(date || ""));
    const rowsMap = new Map();
    const touch = (teamId)=>{
      if(!rowsMap.has(teamId)) rowsMap.set(teamId, { teamId, points: 0, gf: 0, ga: 0, played: 0 });
      return rowsMap.get(teamId);
    };
    matches.forEach((m)=>{
      const home = touch(m.homeId);
      const away = touch(m.awayId);
      const hg = Number(m.homeGoals) || 0;
      const ag = Number(m.awayGoals) || 0;
      home.gf += hg; home.ga += ag; home.played += 1;
      away.gf += ag; away.ga += hg; away.played += 1;
      if(hg>ag){ home.points += 3; }
      else if(hg<ag){ away.points += 3; }
      else { home.points += 1; away.points += 1; }
    });
    const rows = [...rowsMap.values()].sort((a,b)=>{
      if(b.points!==a.points) return b.points-a.points;
      const gdA = a.gf-a.ga;
      const gdB = b.gf-b.ga;
      if(gdB!==gdA) return gdB-gdA;
      return b.gf-a.gf;
    }).map((row, idx)=>({ ...row, rank: idx+1 }));
    return { leagueId, seasonId: db?.settings?.season || "", date: date || new Date().toISOString().slice(0,10), rows };
  }

  function buildOpponentStrengthSnapshot({ db, match, teamId, venue, marketOdds=null, matchDate="" }){
    const opponentId = teamId===match.homeId ? match.awayId : match.homeId;
    const oppRating = db.teamRatings?.[opponentId] || { rating: 1500, matchesCount: 0 };
    const eloStrength01 = eloToStrength01(oppRating.rating);
    const tableSnapshot = buildLeagueTableSnapshot(db, match.leagueId || "", matchDate || match.date || "");
    const row = (tableSnapshot.rows || []).find((r)=>r.teamId===opponentId) || null;
    const totalTeams = Math.max(2, (tableSnapshot.rows || []).length || 20);
    const tableStrength01 = row ? tableToStrength01(row.rank, totalTeams, row.points, row.played) : 0.5;
    const market = marketOdds || clean1x2Probs(match.oddsHome, match.oddsDraw, match.oddsAway);
    const marketStrength01 = market
      ? (venue === "H" ? Number(market.pA) || 0.5 : Number(market.pH) || 0.5)
      : 0.5;
    const totalMatchdays = Math.max(10, totalTeams - 1);
    const conf = {
      elo: confidenceElo(oppRating.matchesCount),
      table: confidenceTable(Number(row?.played) || 0, totalMatchdays),
      market: market ? confidenceMarket({ hasDrawOdds: true, snapshotTooEarly: false }) : 0
    };
    const base = { elo: 0.3, table: row ? 0.2 : 0, market: market ? 0.5 : 0 };
    const weights = normalizeDynamicWeights({ base, conf });
    const strength01 = clamp(
      weights.elo * eloStrength01
      + weights.table * tableStrength01
      + weights.market * marketStrength01,
      0,
      1
    );
    return {
      matchId: match.id,
      date: matchDate || match.date || "",
      opponentId,
      venue,
      signals: {
        elo: { value: Number(oppRating.rating.toFixed(1)), conf: Number(conf.elo.toFixed(2)) },
        table: { value: Number(tableStrength01.toFixed(2)), conf: Number(conf.table.toFixed(2)) },
        market: { value: Number(marketStrength01.toFixed(2)), conf: Number(conf.market.toFixed(2)) }
      },
      blend: {
        strength01: Number(strength01.toFixed(2)),
        weights: {
          elo: Number(weights.elo.toFixed(2)),
          table: Number(weights.table.toFixed(2)),
          market: Number(weights.market.toFixed(2))
        },
        notes: [market ? "market strong" : "market missing", row ? "table ok" : "table missing", "elo stable"]
      }
    };
  }

  function parseStatsPayload(raw){
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const sectionStats = Array.isArray(data?.sections)
      ? data.sections.flatMap(section=>(section?.stats||[]).map(stat=>({
        key: stat?.category || stat?.key || stat?.label || stat?.name || stat?.stat || "Métrica",
        home: stat?.home?.main ?? stat?.home?.raw ?? stat?.home,
        away: stat?.away?.main ?? stat?.away?.raw ?? stat?.away
      })))
      : [];
    const list = Array.isArray(data)
      ? data
      : sectionStats.length ? sectionStats
      : Array.isArray(data?.stats) ? data.stats
      : Array.isArray(data?.estadisticas) ? data.estadisticas
      : Array.isArray(data?.statistics) ? data.statistics
      : [];

    const stats = list.map(item=>({
      key: String(item?.key || item?.label || item?.name || item?.stat || "Métrica").trim(),
      home: String(item?.home ?? item?.local ?? item?.a ?? "0").trim(),
      away: String(item?.away ?? item?.visitante ?? item?.b ?? "0").trim()
    })).filter(s=>s.key);

    if(!stats.length) throw new Error("JSON de estadísticas inválido");
    return stats;
  }

  function parseNumericStat(value){
    if(typeof value === "number") return value;
    const raw = String(value || "").trim();
    if(!raw) return 0;
    const clean = raw.replace(/,/g, ".");
    const found = clean.match(/-?\d+(\.\d+)?/);
    if(!found) return 0;
    const parsed = Number(found[0]);
    if(!Number.isFinite(parsed)) return 0;
    return /%/.test(clean) ? parsed : parsed;
  }

  function normalizeStatsForMatch(match){
    const list = Array.isArray(match?.stats) ? match.stats : [];
    const normalized = {};
    list.forEach((row)=>{
      const key = String(row?.key || "").trim().toLowerCase();
      if(!key) return;
      normalized[key] = {
        home: parseNumericStat(row?.home),
        away: parseNumericStat(row?.away)
      };
    });
    return normalized;
  }

  function getMatchStats(matchId, db){
    const match = db?.tracker?.find((row)=>row.id===matchId);
    if(!match) return null;
    if(match.statsRaw) return match.statsRaw;
    if(Array.isArray(match.stats) && match.stats.length){
      return { kind: "match_stats", stats: match.stats };
    }
    return null;
  }

  function getMatchNarrative(matchId, db){
    const match = db?.tracker?.find((row)=>row.id===matchId);
    if(!match) return "";
    if(Array.isArray(match?.narrativeModule?.pages)){
      return match.narrativeModule.pages.map((page)=>String(page || "").trim()).filter(Boolean).join("\n");
    }
    return String(match?.narrativeModule?.rawText || "").trim();
  }

  function resolveResultForTeam(match, teamId){
    const gf = Number(match?.homeId===teamId ? match?.homeGoals : match?.awayGoals) || 0;
    const ga = Number(match?.homeId===teamId ? match?.awayGoals : match?.homeGoals) || 0;
    if(gf>ga) return "W";
    if(gf===ga) return "D";
    return "L";
  }

  function calcTeamRestDays(matches=[], teamId, targetDate){
    const targetTs = parseSortableDate(targetDate);
    const past = matches
      .filter((m)=>(m.homeId===teamId || m.awayId===teamId) && parseSortableDate(m.date) < targetTs)
      .sort(compareByDateAsc);
    const prev = past.at(-1);
    if(!prev) return 7;
    const prevTs = parseSortableDate(prev.date);
    if(!Number.isFinite(prevTs) || !Number.isFinite(targetTs)) return 7;
    return clamp(Math.round((targetTs - prevTs) / 86400000), 0, 14);
  }

  function computeMatchFeatures({ teamId, matchId, matchDate, statsRaw, narrativeRaw, context }){
    const normalizedStats = normalizeStatsForMatch({ stats: Array.isArray(statsRaw?.stats) ? statsRaw.stats : [] });
    const parsed = parseMatchNarrative(narrativeRaw, [context.teamName, context.opponentName]);
    const events = parsed.events || [];
    const keyByRegex = (regex)=>Object.keys(normalizedStats).find((key)=>regex.test(key));
    const side = context.isHome ? "home" : "away";
    const oppSide = context.isHome ? "away" : "home";
    const pickStat = (regex, fallback=0)=>{
      const key = keyByRegex(regex);
      if(!key) return fallback;
      return Number(normalizedStats[key]?.[side]) || fallback;
    };
    const pickOppStat = (regex, fallback=0)=>{
      const key = keyByRegex(regex);
      if(!key) return fallback;
      return Number(normalizedStats[key]?.[oppSide]) || fallback;
    };
    const shots = pickStat(/shots|remates|tiros/gi, 8);
    const xg = pickStat(/xg|goles esperados/gi, 1.1);
    const cards = pickStat(/yellow|amarillas|roja|tarjetas/gi, 2);
    const oppShots = pickOppStat(/shots|remates|tiros/gi, 8);
    const pressureEvents = events.filter((evt)=>evt.type==="pressure").length;
    const paceEvents = events.filter((evt)=>["shot","big_chance","corner","goal"].includes(evt.type)).length;
    const cardsEvents = events.filter((evt)=>evt.type==="yellow" || evt.type==="red").length;

    const pulseBase = clamp(30 + shots*2 + xg*12 + pressureEvents*2, 0, 100);
    const fatigueBase = clamp(55 - context.restDays*4 + cards*4 + Math.max(0, paceEvents-10), 0, 100);
    const resilBase = clamp(40 + (context.pastPointsPerGame*15) + Math.max(0, shots-oppShots)*1.2, 0, 100);
    const aggrBase = clamp(28 + cards*8 + pressureEvents*4 + cardsEvents*3, 0, 100);
    const volBase = clamp(20 + Math.abs(shots-oppShots)*3 + paceEvents*2, 0, 100);

    const importanceAdj = (Number(context.importance) || 0) * 8;
    const restAdj = (Number(context.restDays) - 4) * 1.5;
    const momentumAdj = (Number(context.momentum) || 0) * 12;

    const pulse = clamp(pulseBase + importanceAdj + momentumAdj, 0, 100);
    const fatiga = clamp(fatigueBase - restAdj, 0, 100);
    const resiliencia = clamp(resilBase + momentumAdj * 0.8, 0, 100);
    const agresividad = clamp(aggrBase + importanceAdj * 0.6, 0, 100);
    const volatilidad = clamp(volBase + Math.abs(momentumAdj) * 0.5, 0, 100);

    const features = {
      pulse,
      fatiga,
      resiliencia,
      agresividad,
      volatilidad,
      edadMedia: clamp(Number(context.edadMedia) || 26, 17, 40),
      descanso: clamp(Number(context.restDays) || 0, 0, 14),
      momentum: clamp(Number(context.momentum) || 0, -1, 1),
      importancia: clamp(Number(context.importance) || 0, 0, 1)
    };

    const featureAudit = {
      version: "snapshot_v1",
      base: { pulseBase, fatigueBase, resilBase, aggrBase, volBase },
      ajustes: { importanceAdj, restAdj, momentumAdj },
      fuentes: {
        stats: Object.keys(normalizedStats),
        narrativeEvents: events.length,
        matchId,
        matchDate
      },
      pulse: { base: pulseBase, adjContext: importanceAdj + momentumAdj, final: pulse, sources: ["shots", "xg", "narrativePressure"] },
      fatiga: { base: fatigueBase, adjContext: -restAdj, final: fatiga, sources: ["restDays", "cards", "matchPace"] },
      resiliencia: { base: resilBase, adjContext: momentumAdj * 0.8, final: resiliencia, sources: ["pastPointsPerGame", "shotDiff"] }
    };

    return { features, featureAudit };
  }

  function rebuildLearningTrainingSet(db){
    const snapshots = Array.isArray(db?.learning?.matchSnapshots) ? db.learning.matchSnapshots : [];
    const ordered = [...snapshots].sort((a,b)=>parseSortableDate(a.matchDate)-parseSortableDate(b.matchDate));
    const trainingSet = [];
    ordered.forEach((snap)=>{
      const targetTs = parseSortableDate(snap.matchDate);
      const seqTeam = ordered.filter((s)=>s.teamId===snap.teamId && parseSortableDate(s.matchDate) < targetTs).slice(-5);
      const seqRival = ordered.filter((s)=>s.teamId===snap.opponentId && parseSortableDate(s.matchDate) < targetTs).slice(-5);
      if(seqTeam.length<5 || seqRival.length<5) return;
      trainingSet.push({
        matchId: snap.matchId,
        teamId: snap.teamId,
        opponentId: snap.opponentId,
        matchDate: snap.matchDate,
        seqTeam,
        seqRival,
        label: snap.result
      });
    });
    db.learning.trainingSet = trainingSet;
  }

  async function calculateSnapshotForMatch({ db, team, match }){
    if(!db || !team || !match) throw new Error("Partido inválido");
    const teamId = team.id;
    const opponentId = match.homeId===team.id ? match.awayId : match.homeId;
    const opponent = db.teams.find((row)=>row.id===opponentId);
    const statsRaw = getMatchStats(match.id, db);
    const narrativeRaw = getMatchNarrative(match.id, db);
    if(!statsRaw) throw new Error("Faltan estadísticas");
    if(!narrativeRaw) throw new Error("Falta relato");
    const allTeamMatches = db.tracker
      .filter((m)=>m.homeId===teamId || m.awayId===teamId)
      .sort(compareByDateAsc);
    const targetTs = parseSortableDate(match.date);
    const pastMatches = allTeamMatches.filter((m)=>parseSortableDate(m.date) < targetTs);
    const last5 = pastMatches.slice(-5);
    const points = last5.reduce((sum, m)=>{
      const result = resolveResultForTeam(m, teamId);
      return sum + (result==="W" ? 3 : result==="D" ? 1 : 0);
    }, 0);
    const momentum = last5.length ? clamp(points / (last5.length*3) * 2 - 1, -1, 1) : 0;
    const players = db.players.filter((p)=>p.teamId===teamId);
    const avgAge = players.length
      ? players.reduce((sum, p)=>sum + (Number(p.age) || 26), 0) / players.length
      : 26;
    const restDays = calcTeamRestDays(db.tracker, teamId, match.date);
    const importance = clamp(competitionWeight(db, match), 0, 1);
    const context = {
      teamName: team.name,
      opponentName: opponent?.name || "Rival",
      isHome: match.homeId===team.id,
      restDays,
      momentum,
      importance,
      edadMedia: avgAge,
      pastPointsPerGame: last5.length ? points / (last5.length * 3) : 0.5
    };
    const computed = computeMatchFeatures({
      teamId,
      matchId: match.id,
      matchDate: match.date,
      statsRaw,
      narrativeRaw,
      context
    });
    const result = resolveResultForTeam(match, teamId);
    const score = context.isHome
      ? `${match.homeGoals}-${match.awayGoals}`
      : `${match.awayGoals}-${match.homeGoals}`;
    const snapshot = {
      matchId: match.id,
      teamId,
      opponentId,
      league: db.leagues.find((l)=>l.id===match.leagueId)?.name || "Liga",
      matchDate: match.date,
      homeAway: context.isHome ? "GL" : "GV",
      result,
      score,
      statsRaw,
      narrativeRaw,
      features: computed.features,
      featureAudit: computed.featureAudit
    };
    match.featureSnapshots ||= {};
    match.featureSnapshots[teamId] = snapshot;
    match.featureSnapshotStatus ||= {};
    match.featureSnapshotStatus[teamId] = { status: "ok", updatedAt: new Date().toISOString() };
    db.learning.matchSnapshots = (db.learning.matchSnapshots || []).filter((row)=>!(row.matchId===match.id && row.teamId===teamId));
    db.learning.matchSnapshots.push(snapshot);
    rebuildLearningTrainingSet(db);
    saveDb(db);
    return snapshot;
  }

  function normalizeFeatureSchema(snapshot){
    const f = snapshot?.features || {};
    return {
      pulse: clamp(Number(f.pulse) || 0, 0, 100),
      fatigue: clamp(Number(f.fatiga) || 0, 0, 100),
      resilience: clamp(Number(f.resiliencia) || 0, 0, 100),
      aggression: clamp(Number(f.agresividad) || 0, 0, 100),
      volatility: clamp(Number(f.volatilidad) || 0, 0, 100),
      restDays: clamp(Number(f.descanso) || 0, 0, 14),
      momentum: clamp(Number(f.momentum) || 0, -1, 1),
      importance: clamp(Number(f.importancia) || 0, 0, 1),
      avgAge: clamp(Number(f.edadMedia) || 26, 17, 40)
    };
  }

  async function buildTeamPack({
    db,
    team,
    matches = [],
    includeStats = true,
    includeNarrative = true,
    includeSnapshots = true,
    recalcSnapshots = false,
    narrativeMaxChars = 0,
    includeFeaturesRaw = true
  }){
    const orderedMatches = [...matches].sort(compareByDateAsc);
    const packMatches = [];
    const snapshots = [];
    for(const match of orderedMatches){
      const isHome = match.homeId===team.id;
      const opponent = db.teams.find((row)=>row.id===(isHome ? match.awayId : match.homeId));
      const statsRaw = includeStats ? (getMatchStats(match.id, db) || null) : null;
      const narrativeRawBase = includeNarrative ? (getMatchNarrative(match.id, db) || "") : "";
      const narrativeRaw = narrativeMaxChars>0 ? String(narrativeRawBase).slice(0, narrativeMaxChars) : narrativeRawBase;
      packMatches.push({
        matchId: String(match.id),
        matchDate: match.date || "",
        league: db.leagues.find((l)=>l.id===match.leagueId)?.name || match.competition || "Liga",
        homeAway: isHome ? "home" : "away",
        opponent: { id: opponent?.id || "unknown", name: opponent?.name || "Rival" },
        scoreFT: { home: Number(match.homeGoals) || 0, away: Number(match.awayGoals) || 0 },
        statsRaw,
        narrativeRaw
      });
      if(!includeSnapshots) continue;
      let snapshot = match?.featureSnapshots?.[team.id] || null;
      if(recalcSnapshots || !snapshot){
        try{
          snapshot = await calculateSnapshotForMatch({ db, team, match });
        }catch(_e){
          snapshot = null;
        }
      }
      if(snapshot){
        snapshots.push({
          matchId: String(match.id),
          matchDate: match.date || "",
          featureSchema: "F9_v1",
          features: normalizeFeatureSchema(snapshot),
          featuresRaw: includeFeaturesRaw ? (snapshot?.features || null) : undefined,
          audit: snapshot?.featureAudit || {}
        });
      }
    }
    const from = orderedMatches[0]?.date || "";
    const to = orderedMatches.at(-1)?.date || "";
    return {
      schemaVersion: "FL_TEAMPACK_v1",
      createdAt: new Date().toISOString(),
      team: { id: team.id, name: team.name },
      range: { from, to },
      cutoffDate: to,
      includes: { stats: includeStats, narrative: includeNarrative, snapshots: includeSnapshots },
      matches: packMatches,
      snapshots,
      quality: { computedAtExport: true }
    };
  }

  function computeTeamPackDataStrength(pack, targetCount = 20){
    const matches = Array.isArray(pack?.matches) ? pack.matches : [];
    const matchCount = matches.length;
    const withStats = matches.filter((m)=>!!m.statsRaw).length;
    const withNarrative = matches.filter((m)=>String(m.narrativeRaw || "").trim().length>0).length;
    const withSnapshots = Array.isArray(pack?.snapshots) ? pack.snapshots.length : 0;
    const coverage = clamp(matchCount / targetCount, 0, 1);
    const lastDate = matches.reduce((latest, m)=>{
      const ts = parseSortableDate(m.matchDate);
      return Number.isFinite(ts) && (!Number.isFinite(latest) || ts>latest) ? ts : latest;
    }, NaN);
    const daysSinceLast = Number.isFinite(lastDate) ? Math.max(0, Math.round((Date.now()-lastDate)/86400000)) : 365;
    const recency = clamp(Math.exp(-daysSinceLast/30), 0, 1);
    const pctStats = matchCount ? withStats / matchCount : 0;
    const pctNarrative = matchCount ? withNarrative / matchCount : 0;
    const completeness = clamp((0.6*pctStats) + (0.4*pctNarrative), 0, 1);
    const missingCritical = matches.filter((m)=>!m.matchDate || !m.scoreFT || !Number.isFinite(Number(m.scoreFT.home)) || !Number.isFinite(Number(m.scoreFT.away))).length;
    const missingStatsCritical = pack?.includes?.stats
      ? matches.filter((m)=>!m.statsRaw || (typeof m.statsRaw==="object" && !Array.isArray(m.statsRaw) && Object.keys(m.statsRaw || {}).length===0)).length
      : 0;
    const missingCriticalRate = matchCount ? (missingCritical + missingStatsCritical) / matchCount : 1;
    const duplicateMatchIdRate = matchCount ? 1 - (new Set(matches.map((m)=>String(m.matchId))).size / matchCount) : 1;
    let unorderedDates = 0;
    for(let i=1;i<matches.length;i++){
      if(parseSortableDate(matches[i-1].matchDate) > parseSortableDate(matches[i].matchDate)) unorderedDates++;
    }
    const unorderedDateRate = matchCount>1 ? unorderedDates / (matchCount - 1) : 0;
    const consistency = clamp(1 - (missingCriticalRate + duplicateMatchIdRate + unorderedDateRate), 0, 1);
    const score = Math.round(100 * ((0.4*coverage) + (0.2*recency) + (0.3*completeness) + (0.1*consistency)));
    return {
      score,
      coverage,
      recency,
      completeness,
      consistency,
      missingCriticalRate,
      duplicateMatchIdRate,
      unorderedDateRate,
      pctStats,
      pctNarrative,
      pctSnapshots: matchCount ? withSnapshots / matchCount : 0,
      matches: matchCount,
      daysSinceLast
    };
  }

  function parseTeamPackStatsBySide(match){
    let statsRaw = match?.statsRaw;
    if(typeof statsRaw === "string") statsRaw = safeParseJSON(statsRaw, null);
    const statsList = Array.isArray(statsRaw?.stats)
      ? statsRaw.stats
      : Array.isArray(statsRaw)
        ? statsRaw
        : [];
    const normalized = normalizeStatsForMatch({ stats: statsList });
    const isHome = String(match?.homeAway || "").toLowerCase() === "home";
    const side = isHome ? "home" : "away";
    const oppSide = isHome ? "away" : "home";
    const pick = (regex)=>{
      const key = Object.keys(normalized).find((k)=>regex.test(k));
      if(!key) return { own: 0, opp: 0 };
      return {
        own: Number(normalized[key]?.[side]) || 0,
        opp: Number(normalized[key]?.[oppSide]) || 0
      };
    };
    return {
      shots: pick(/shots\s*on\s*target|tiros?\s*a\s*puerta|remates?\s*a\s*puerta/i),
      shotsAll: pick(/shots|remates|tiros/i),
      corners: pick(/corners?|c[oó]rners?/i),
      possession: pick(/possession|posesi[oó]n/i),
      bigChances: pick(/big\s*chances?|ocasiones?\s*claras?/i),
      cards: pick(/cards|tarjetas|amarillas|rojas/i),
      xg: pick(/(^|\s)xg|goles\s*esperados/i)
    };
  }

  function computeTeamPackCompleteness(match){
    const hasScore = Number.isFinite(Number(match?.scoreFT?.home)) && Number.isFinite(Number(match?.scoreFT?.away));
    const hasVenue = ["home", "away"].includes(String(match?.homeAway || "").toLowerCase());
    const hasNarrative = String(match?.narrativeRaw || "").trim().length > 40;
    const stats = parseTeamPackStatsBySide(match);
    const hasShots = (stats.shotsAll.own + stats.shotsAll.opp) > 0;
    const hasCorners = (stats.corners.own + stats.corners.opp) > 0;
    const hasShotsOT = (stats.shots.own + stats.shots.opp) > 0;
    const hasPoss = (stats.possession.own + stats.possession.opp) > 0;
    const hasXg = (stats.xg.own + stats.xg.opp) > 0;
    const score = clamp(
      ((hasScore && hasVenue) ? 0.2 : 0)
      + (hasNarrative ? 0.2 : 0)
      + ((hasShots && hasCorners) ? 0.3 : 0)
      + (hasShotsOT ? 0.2 : 0)
      + ((hasPoss || hasXg) ? 0.1 : 0),
      0,
      1
    );
    return {
      score,
      level: score >= 0.8 ? "alto" : score >= 0.55 ? "medio" : "bajo"
    };
  }

  function buildTeamAggregate(teamPack){
    const matches = Array.isArray(teamPack?.matches) ? [...teamPack.matches].sort((a,b)=>parseSortableDate(a.matchDate)-parseSortableDate(b.matchDate)) : [];
    const teamName = teamPack?.team?.name || "Equipo";
    const baseRows = matches.map((m)=>{
      const stats = parseTeamPackStatsBySide(m);
      const isHome = String(m?.homeAway || "").toLowerCase() === "home";
      const gf = Number(isHome ? m?.scoreFT?.home : m?.scoreFT?.away) || 0;
      const ga = Number(isHome ? m?.scoreFT?.away : m?.scoreFT?.home) || 0;
      const points = gf>ga ? 3 : gf===ga ? 1 : 0;
      const reasons = buildRelatoTags(m?.narrativeRaw || "", teamName, m?.opponent?.name || "Rival");
      const tagMap = Object.fromEntries(reasons.map((r)=>[r.tagId, r]));
      const oppStrength01 = clamp(Number(m?.opponentStrength01 ?? m?.opponent?.strength01 ?? 0.5) || 0.5, 0, 1);
      return {
        matchId: String(m?.matchId || uid("pkm")),
        date: m?.matchDate || "-",
        opponent: m?.opponent?.name || "Rival",
        venue: isHome ? "H" : "A",
        gf,
        ga,
        outcome: gf>ga ? "W" : gf===ga ? "D" : "L",
        points,
        goalDiff: gf-ga,
        efficiency: gf / Math.max(1, stats.shots.own || stats.shotsAll.own || 1),
        oppStrength01,
        stats,
        reasons,
        tagMap,
        completeness: computeTeamPackCompleteness(m),
        narrativeRaw: String(m?.narrativeRaw || ""),
        statsRaw: m?.statsRaw || null,
        source: m
      };
    });
    const avg = (arr)=>arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    const byVenue = {
      home: baseRows.filter((r)=>r.venue === "H"),
      away: baseRows.filter((r)=>r.venue === "A")
    };
    const kpisFromRows = (rows)=>{
      const shotsFor = avg(rows.map((r)=>r.stats.shotsAll.own));
      const shotsAgainst = avg(rows.map((r)=>r.stats.shotsAll.opp));
      const shotsOTFor = avg(rows.map((r)=>r.stats.shots.own));
      const bigFor = avg(rows.map((r)=>r.stats.bigChances.own));
      const goalsFor = avg(rows.map((r)=>r.gf));
      const poss = avg(rows.map((r)=>r.stats.possession.own || 50));
      const cornersDelta = avg(rows.map((r)=>r.stats.corners.own - r.stats.corners.opp));
      const finishingFail = avg(rows.map((r)=>(Number(r.tagMap.finishing_failure?.strength) || 0) * (1.1 - 0.2*(r.oppStrength01 || 0.5))));
      const clinical = avg(rows.map((r)=>(Number(r.tagMap.clinical_finish?.strength) || 0) * (0.9 + 0.2*(r.oppStrength01 || 0.5))));
      const momentum = avg(rows.map((r)=>(Number(r.tagMap.momentum_control?.strength || r.tagMap.territorial_pressure?.strength) || 0) * (0.9 + 0.2*(r.oppStrength01 || 0.5))));
      const territorial = avg(rows.map((r)=>(Number(r.tagMap.territorial_pressure?.strength) || 0) * (0.9 + 0.2*(r.oppStrength01 || 0.5))));
      const setpieceThreat = avg(rows.map((r)=>(Number(r.tagMap.setpiece_threat?.strength) || 0) * (0.9 + 0.2*(r.oppStrength01 || 0.5))));
      const disciplineIssues = avg(rows.map((r)=>(Number(r.tagMap.discipline_issues?.strength) || 0) * (1.1 - 0.2*(r.oppStrength01 || 0.5))));
      const defensiveIssues = avg(rows.map((r)=>(Number(r.tagMap.defensive_errors?.strength || r.tagMap.discipline_issues?.strength) || 0) * (1.1 - 0.2*(r.oppStrength01 || 0.5))));
      const avgEfficiency = avg(rows.map((r)=>r.efficiency * (0.90 + 0.25*(r.oppStrength01 || 0.5))));
      const attackProduction = clamp(30 + shotsFor*3 + shotsOTFor*4 + bigFor*9 + clamp(cornersDelta+2,0,8)*4 + setpieceThreat*16 + territorial*14, 0, 100);
      const attackConversion = clamp(20 + goalsFor*18 + avgEfficiency*95 + clinical*22 - finishingFail*28, 0, 100);
      const attack = clamp(attackProduction*0.6 + attackConversion*0.4, 0, 100);
      const defense = clamp(70 - shotsAgainst*4 - defensiveIssues*15, 0, 100);
      const control = clamp(35 + (poss-45)*1.2 + cornersDelta*3 + momentum*22, 0, 100);
      const efficiency = clamp(35 + avgEfficiency*130 + clinical*16 - finishingFail*22, 0, 100);
      const setpieceStrength = clamp(32 + setpieceThreat*35 + clamp(cornersDelta, -4, 6)*5, 0, 100);
      const discipline = clamp(72 - avg(rows.map((r)=>r.stats.cards.own))*6 - disciplineIssues*38, 0, 100);
      return {
        attack,
        defense,
        control,
        efficiency,
        attackProduction,
        attackConversion,
        defenseStability: defense,
        setpieceStrength,
        discipline
      };
    };
    const kpis = kpisFromRows(baseRows);
    const confidence = clamp(avg(baseRows.map((r)=>r.completeness.score)), 0, 1);
    const tagTotals = new Map();
    baseRows.forEach((row)=>{
      Object.values(row.tagMap || {}).forEach((tag)=>{
        const key = String(tag?.tagId || "");
        if(!key) return;
        const prev = tagTotals.get(key) || { count: 0, strength: 0, label: tag.label || key };
        prev.count += 1;
        prev.strength += Number(tag?.strength) || 0;
        if(!prev.label && tag?.label) prev.label = tag.label;
        tagTotals.set(key, prev);
      });
    });
    const teamDNA = [...tagTotals.entries()]
      .map(([tagId, info])=>({
        tagId,
        label: info.label || tagId,
        count: info.count,
        presencePct: clamp((info.count / Math.max(1, baseRows.length))*100, 0, 100),
        intensityPct: clamp((info.strength / Math.max(1, baseRows.length))*100, 0, 100)
      }))
      .sort((a,b)=>b.intensityPct-a.intensityPct);
    const defeatCausesMap = new Map();
    baseRows.filter((row)=>row.outcome === "L").forEach((row)=>{
      Object.values(row.tagMap || {}).forEach((tag)=>{
        const strength = Number(tag?.strength) || 0;
        if(strength < 0.35) return;
        const key = String(tag?.tagId || "");
        if(!key) return;
        const prev = defeatCausesMap.get(key) || { count: 0, label: tag.label || key };
        prev.count += 1;
        defeatCausesMap.set(key, prev);
      });
    });
    const defeatCauses = [...defeatCausesMap.entries()]
      .map(([tagId, info])=>({ tagId, label: info.label || tagId, count: info.count }))
      .sort((a,b)=>b.count-a.count);
    return {
      teamName,
      matches: baseRows,
      byVenue,
      kpis,
      radar: { home: kpisFromRows(byVenue.home), away: kpisFromRows(byVenue.away) },
      teamDNA,
      defeatCauses,
      confidence,
      sampleSize: baseRows.length,
      panelLevel: baseRows.length >= 20 ? "avanzado" : baseRows.length >= 10 ? "completo" : baseRows.length >= 5 ? "basico" : "insuficiente"
    };
  }

  function getJsonStorage(key){
    const parsed = safeParseJSON(localStorage.getItem(key), {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  function saveTeamBrainFeatures(teamId, snapshots = []){
    if(!teamId) return;
    const store = getJsonStorage(TEAM_BRAIN_FEATURES_KEY);
    const prevRows = Array.isArray(store?.[teamId]) ? store[teamId] : [];
    const incomingRows = (Array.isArray(snapshots) ? snapshots : [])
      .filter((row)=>row && typeof row === "object")
      .map((row)=>({
        matchId: String(row.matchId || ""),
        date: String(row.matchDate || row.date || ""),
        features: normalizeFeatureSchema(row.features || row.featuresRaw || {})
      }))
      .filter((row)=>row.date && row.features && Object.keys(row.features).length);
    const merged = [...prevRows, ...incomingRows];
    const dedupMap = new Map();
    merged.forEach((row)=>{
      const key = `${String(row?.matchId || "")}|${String(row?.date || "")}`;
      if(!key || key === "|") return;
      dedupMap.set(key, row);
    });
    store[teamId] = [...dedupMap.values()]
      .sort((a,b)=>parseSortableDate(a.date)-parseSortableDate(b.date))
      .slice(-20);
    localStorage.setItem(TEAM_BRAIN_FEATURES_KEY, JSON.stringify(store));
  }

  function getTeamBrainFeatures(teamId, historicalDate = ""){
    if(!teamId) return [];
    const store = getJsonStorage(TEAM_BRAIN_FEATURES_KEY);
    const rows = Array.isArray(store?.[teamId]) ? store[teamId] : [];
    const cutoff = parseSortableDate(historicalDate);
    return rows
      .filter((row)=>{
        const ts = parseSortableDate(row?.date);
        if(!Number.isFinite(ts)) return false;
        if(Number.isFinite(cutoff) && ts >= cutoff) return false;
        return true;
      })
      .slice()
      .sort((a,b)=>parseSortableDate(a.date)-parseSortableDate(b.date))
      .slice(-3);
  }

  async function openTeamPackDb(){
    if(typeof indexedDB === "undefined") return null;
    return new Promise((resolve)=>{
      const req = indexedDB.open(TEAM_PACKS_DB, 1);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(TEAM_PACKS_STORE)){
          db.createObjectStore(TEAM_PACKS_STORE, { keyPath: "teamId" });
        }
      };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>resolve(null);
    });
  }

  async function saveTeamPackRecord(teamId, record){
    if(!teamId || !record || typeof record !== "object") return false;
    const safeManifest = (record.manifest && typeof record.manifest === "object") ? record.manifest : {};
    const indexStore = getJsonStorage(TEAM_PACKS_INDEX_KEY);
    indexStore[teamId] = { ...(indexStore[teamId] || {}), ...safeManifest };
    localStorage.setItem(TEAM_PACKS_INDEX_KEY, JSON.stringify(indexStore));
    const db = await openTeamPackDb();
    if(!db){
      const fallback = getJsonStorage(TEAM_PACKS_KEY);
      fallback[teamId] = record;
      localStorage.setItem(TEAM_PACKS_KEY, JSON.stringify(fallback));
      return true;
    }
    await new Promise((resolve)=>{
      const tx = db.transaction(TEAM_PACKS_STORE, "readwrite");
      tx.objectStore(TEAM_PACKS_STORE).put({ teamId, ...record, updatedAt: new Date().toISOString() });
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>resolve();
    });
    db.close();
    return true;
  }

  async function loadTeamPackRecord(teamId){
    if(!teamId) return null;
    const db = await openTeamPackDb();
    if(!db){
      const fallback = getJsonStorage(TEAM_PACKS_KEY);
      return fallback?.[teamId] || null;
    }
    const row = await new Promise((resolve)=>{
      const tx = db.transaction(TEAM_PACKS_STORE, "readonly");
      const req = tx.objectStore(TEAM_PACKS_STORE).get(teamId);
      req.onsuccess = ()=>resolve(req.result || null);
      req.onerror = ()=>resolve(null);
    });
    db.close();
    return row;
  }

  function openStatsModal({ db, match, team, onSave } = {}){
    if(!match) return;
    const teamSnapshot = team?.id ? match?.featureSnapshots?.[team.id] : null;
    const featureRows = teamSnapshot?.features
      ? Object.entries(teamSnapshot.features).map(([key, value])=>`<tr><td>${key}</td><td><b>${typeof value==="number" ? value.toFixed(2) : String(value)}</b></td></tr>`).join("")
      : "<tr><td colspan='2'>Sin métricas calculadas para este equipo.</td></tr>";
    const auditRows = teamSnapshot?.featureAudit
      ? Object.entries(teamSnapshot.featureAudit).map(([key, value])=>`<tr><td>${key}</td><td><pre class='fl-mini' style='white-space:pre-wrap;'>${JSON.stringify(value, null, 2)}</pre></td></tr>`).join("")
      : "<tr><td colspan='2'>Sin auditoría todavía.</td></tr>";

    const backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
    backdrop.innerHTML = `
      <div class="fl-card" style="width:min(960px,100%);max-height:90vh;overflow:auto;">
        <div class="fl-row" style="justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:900;">Estadísticas del partido</div>
          <button class="fl-btn" id="closeStatsModal">Cerrar</button>
        </div>
        <div class="fl-row" style="margin-bottom:8px;gap:8px;">
          <button class="fl-btn" id="tabStatsBtn">Estadísticas</button>
          <button class="fl-btn" id="tabFeaturesBtn">Métricas calculadas</button>
        </div>
        <div id="tabStatsPanel">
          <div class="fl-muted" style="margin-bottom:8px;">Pega JSON con formato <code>stats</code>, <code>statistics</code> o <code>sections[].stats[]</code>.</div>
          <textarea id="statsImportModal" class="fl-text" placeholder='{"kind":"match_stats","sections":[{"section":"Estadísticas principales","stats":[{"category":"Posesión","home":{"main":"67%"},"away":{"main":"33%"}}]}]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="saveStatsModal">Guardar estadísticas</button>
            <span id="statsModalStatus" class="fl-muted"></span>
          </div>
        </div>
        <div id="tabFeaturesPanel" style="display:none;">
          <div style="font-weight:800;margin-bottom:6px;">Vector final (features)</div>
          <table class="fl-table"><thead><tr><th>Métrica</th><th>Valor</th></tr></thead><tbody>${featureRows}</tbody></table>
          <div style="font-weight:800;margin:10px 0 6px;">Audit (base + ajustes + fuentes usadas)</div>
          <table class="fl-table"><thead><tr><th>Clave</th><th>Detalle</th></tr></thead><tbody>${auditRows}</tbody></table>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    if(match.statsRaw){
      const area = backdrop.querySelector("#statsImportModal");
      area.value = JSON.stringify(match.statsRaw, null, 2);
    }

    const close = ()=>backdrop.remove();
    backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) close(); });
    backdrop.querySelector("#closeStatsModal").onclick = close;
    backdrop.querySelector("#tabStatsBtn").onclick = ()=>{
      backdrop.querySelector("#tabStatsPanel").style.display = "block";
      backdrop.querySelector("#tabFeaturesPanel").style.display = "none";
    };
    backdrop.querySelector("#tabFeaturesBtn").onclick = ()=>{
      backdrop.querySelector("#tabStatsPanel").style.display = "none";
      backdrop.querySelector("#tabFeaturesPanel").style.display = "block";
    };
    backdrop.querySelector("#saveStatsModal").onclick = ()=>{
      const status = backdrop.querySelector("#statsModalStatus");
      try{
        const rawObj = JSON.parse(backdrop.querySelector("#statsImportModal").value.trim());
        const stats = parseStatsPayload(rawObj);
        match.statsRaw = rawObj;
        match.stats = stats;
        saveDb(db);
      if(linkedMemoryMatch){
        saveBrainV2(linkedBrainV2);
      }
        status.textContent = `✅ Guardado (${stats.length} métricas)`;
        onSave?.();
        setTimeout(close, 500);
      }catch(err){
        status.textContent = `❌ ${String(err.message||err)}`;
      }
    };
  }

  function openFutureMatchModal({ db, team, matchId = "", onSave } = {}){
    if(!team) return;
    ensureTeamIntState(team);
    const editing = (team.futureMatches || []).find(m=>m.id===matchId) || null;
    const backdrop = document.createElement("div");
    backdrop.className = "fl-modal-backdrop";
    const competitionOptions = db.leagues
      .slice()
      .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }))
      .map(l=>`<option value="${l.id}">${l.name} · ${l.type || "league"}</option>`)
      .join("");
    const rivalOptions = db.teams
      .filter(t=>t.id!==team.id)
      .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }))
      .map(t=>`<option value="${t.id}">${t.name}</option>`)
      .join("");
    const marketOptions = (db.marketTracker || [])
      .map(row=>`<option value="${row.matchId}">${row.fecha || "sin fecha"} · ${row.liga || "sin liga"} · ${row.matchId}</option>`)
      .join("");
    backdrop.innerHTML = `
      <div class="fl-modal">
        <div class="fl-row" style="justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <div class="fl-modal-title">${editing ? "Editar partido" : "Nuevo partido"}</div>
            <div class="fl-mini">Completa rival, liga/competición y contexto para INT.</div>
          </div>
          <button class="fl-btn" id="closeFutureModal">Cerrar</button>
        </div>
        <div class="fl-modal-grid" style="margin-bottom:10px;">
          <div class="fl-field"><label>Rival</label><select id="fmRival" class="fl-select"><option value="">Seleccionar rival</option>${rivalOptions}</select></div>
          <div class="fl-field"><label>Fecha</label><input id="fmDate" type="date" class="fl-input"></div>
          <div class="fl-field"><label>Liga / Competición</label><select id="fmCompetitionId" class="fl-select"><option value="">Seleccionar competición</option>${competitionOptions}</select></div>
          <div class="fl-field"><label>Etapa</label><input id="fmStage" class="fl-input" placeholder="Liga / Grupos / KO / Final"></div>
          <div class="fl-field"><label>Importancia</label><select id="fmImportance" class="fl-select"><option value="nada en juego">Nada en juego</option><option value="top4">Top4</option><option value="descenso">Descenso</option><option value="derby">Derby</option><option value="final">Final</option></select><div id="fmImportanceHint" class="fl-mini" style="margin-top:4px;opacity:.75;"></div></div>
          <div class="fl-field"><label>Market mood</label><select id="fmMarketMood" class="fl-select"><option value="estable">Estable</option><option value="dinero temprano">Dinero temprano</option><option value="raro">Raro</option></select></div>
          <div class="fl-field"><label>Market vinculado</label><select id="fmMarketLink" class="fl-select"><option value="">Sin vínculo</option>${marketOptions}</select></div>
          <div class="fl-field"><label>Snapshot cuota (1X2)</label><input id="fmOdds" class="fl-input" placeholder="1.70,3.80,5.20"></div>
          <div class="fl-field"><label>Descanso (días)</label><input id="fmRestDays" type="number" min="0" max="14" class="fl-input" placeholder="Auto"></div>
        </div>
        <div class="fl-row" style="gap:16px;margin-bottom:12px;">
          <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input id="fmIsHome" type="checkbox"> Juega de local</label>
          <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input id="fmPeakNear" type="checkbox"> Pico en 7 días</label>
          <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input id="fmLongTravel" type="checkbox"> Viaje largo</label>
          <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input id="fmPostHype" type="checkbox"> Post-hype</label>
          <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input id="fmWeather" type="checkbox"> Clima adverso</label>
        </div>
        <div class="fl-row" style="justify-content:space-between;">
          <span id="futureModalStatus" class="fl-mini"></span>
          <div class="fl-row">
            ${editing ? '<button class="fl-btn" id="deleteFutureModal" style="border-color:#da3633;color:#ff7b72;">Eliminar</button>' : ''}
            <button class="fl-btn" id="saveFutureModal">${editing ? "Guardar cambios" : "Registrar partido"}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = ()=>backdrop.remove();
    backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) close(); });
    backdrop.querySelector("#closeFutureModal").onclick = close;

    const setValue = (id, value)=>{
      const el = backdrop.querySelector(id);
      if(!el) return;
      if(el.type === "checkbox") el.checked = Boolean(value);
      else if(value!==undefined && value!==null) el.value = String(value);
    };
    setValue("#fmRival", editing?.rivalTeamId || "");
    setValue("#fmDate", editing?.date || "");
    setValue("#fmCompetitionId", editing?.competitionId || editing?.leagueId || "");
    setValue("#fmImportance", normalizeImportanceTag(editing?.importanceTag || "nada en juego"));
    setValue("#fmStage", editing?.stage || "Liga");
    setValue("#fmMarketMood", editing?.marketMood || "estable");
    setValue("#fmMarketLink", editing?.marketMatchId || "");
    setValue("#fmRestDays", Number.isFinite(Number(editing?.restDays)) ? editing.restDays : "");
    setValue("#fmIsHome", editing?.isHome ?? true);
    setValue("#fmPeakNear", editing?.peakMatchHint);
    setValue("#fmLongTravel", editing?.longTravel);
    setValue("#fmPostHype", editing?.postHype);
    setValue("#fmWeather", editing?.weatherFlag);

    const refreshImportanceHint = ()=>{
      const compId = backdrop.querySelector("#fmCompetitionId").value;
      const competition = getCompetitionById(db, compId);
      const hint = backdrop.querySelector("#fmImportanceHint");
      if(!hint) return;
      hint.textContent = normalizeCompetitionType(competition?.type) === "league"
        ? "Modo tabla activo: Top4/Descenso aplican."
        : "Importancia de tabla no aplica; se evalúa modo KO.";
    };
    backdrop.querySelector("#fmCompetitionId").onchange = refreshImportanceHint;
    refreshImportanceHint();

    const applyMarketFromLink = ()=>{
      const marketId = String(backdrop.querySelector("#fmMarketLink")?.value || "").trim();
      if(!marketId) return;
      const row = (db.marketTracker || []).find(item=>item.matchId===marketId);
      if(!row) return;
      const last = Array.isArray(row.cuotas) && row.cuotas.length ? row.cuotas[row.cuotas.length-1] : null;
      if(last){
        backdrop.querySelector("#fmOdds").value = [last.home, last.draw, last.away].filter(Number.isFinite).join(",");
      }
      if(Array.isArray(row.cuotas) && row.cuotas.length >= 3) backdrop.querySelector("#fmMarketMood").value = "dinero temprano";
      if(row.settlement?.CLV && Math.abs(Number(row.settlement.CLV)) >= 0.08) backdrop.querySelector("#fmMarketMood").value = "raro";
    };
    backdrop.querySelector("#fmMarketLink").onchange = applyMarketFromLink;
    applyMarketFromLink();

    backdrop.querySelector("#saveFutureModal").onclick = ()=>{
      const status = backdrop.querySelector("#futureModalStatus");
      const rivalTeamId = backdrop.querySelector("#fmRival").value;
      const date = String(backdrop.querySelector("#fmDate").value || "").trim();
      const competitionId = String(backdrop.querySelector("#fmCompetitionId").value || "").trim();
      const selectedCompetition = getCompetitionById(db, competitionId);
      const competition = selectedCompetition?.name || "Liga";
      const importanceTag = normalizeImportanceTag(backdrop.querySelector("#fmImportance").value || "nada en juego");
      const stage = String(backdrop.querySelector("#fmStage").value || "Liga").trim() || "Liga";
      const marketMood = String(backdrop.querySelector("#fmMarketMood").value || "estable").trim();
      const marketMatchId = String(backdrop.querySelector("#fmMarketLink").value || "").trim();
      const oddsRaw = String(backdrop.querySelector("#fmOdds").value || "").trim();
      const restDaysRaw = backdrop.querySelector("#fmRestDays").value;
      const restDays = restDaysRaw==="" ? null : clamp(Number(restDaysRaw) || 0, 0, 14);
      if(!rivalTeamId){ status.textContent = "❌ Selecciona un rival."; return; }
      if(!date){ status.textContent = "❌ Elige una fecha."; return; }
      if(!competitionId){ status.textContent = "❌ Selecciona una competición."; return; }

      const payload = {
        id: editing?.id || uid("fm"),
        date,
        rivalTeamId,
        competition,
        competitionId,
        competitionType: normalizeCompetitionType(selectedCompetition?.type),
        stage,
        isHome: backdrop.querySelector("#fmIsHome").checked,
        importanceTag,
        marketMood,
        marketMatchId,
        peakMatchHint: backdrop.querySelector("#fmPeakNear").checked,
        longTravel: backdrop.querySelector("#fmLongTravel").checked,
        postHype: backdrop.querySelector("#fmPostHype").checked,
        weatherFlag: backdrop.querySelector("#fmWeather").checked,
        snapshots: Array.isArray(editing?.snapshots) ? [...editing.snapshots] : []
      };
      if(oddsRaw){
        const nums = oddsRaw.split(/[ ,;/|]+/).map(v=>Number(v)).filter(Number.isFinite);
        if(nums.length>=3){
          payload.snapshots.push({ homeOdds: nums[0], drawOdds: nums[1], awayOdds: nums[2], timestamp: new Date().toISOString(), note: "quick-fill" });
        }
      }
      if(restDays!==null) payload.restDays = restDays;
      else if(editing && "restDays" in editing) payload.restDays = undefined;

      if(editing){
        const idx = team.futureMatches.findIndex(m=>m.id===editing.id);
        if(idx>=0) team.futureMatches[idx] = { ...editing, ...payload };
      }else{
        team.futureMatches.push(payload);
      }
      removeMirrorFutureMatch({ db, team, matchId: payload.id });
      const rival = db.teams.find(t=>t.id===rivalTeamId);
      if(rival) upsertMirrorFutureMatch({ db, team, rival, match: payload });
      ensureTeamInLeague(db, team.id, competitionId);
      ensureTeamInLeague(db, rivalTeamId, competitionId);
      saveDb(db);
      onSave?.();
      close();
    };

    const deleteBtn = backdrop.querySelector("#deleteFutureModal");
    if(deleteBtn){
      deleteBtn.onclick = ()=>{
        team.futureMatches = (team.futureMatches || []).filter(m=>m.id!==editing.id);
        removeMirrorFutureMatch({ db, team, matchId: editing.id });
        saveDb(db);
        onSave?.();
        close();
      };
    }
  }

  function toNumLoose(value){
    if(value===null || value===undefined) return null;
    const clean = String(value).replace('%','').replace(',','.').trim();
    if(!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  function statsBarsHtml(stats){
    return stats.map(s=>{
      const h = toNumLoose(s.home);
      const a = toNumLoose(s.away);
      const total = (h!==null && a!==null) ? h+a : null;
      const hPct = total && total>0 ? (h/total)*100 : 50;
      const aPct = total && total>0 ? (a/total)*100 : 50;
      return `
        <div style="margin-bottom:12px;">
          <div class="fl-row" style="justify-content:space-between;font-weight:700;">
            <span>${s.home}</span>
            <span>${s.key}</span>
            <span>${s.away}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
            <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#ff3b69 ${hPct}%, #2d333b ${hPct}%);"></div>
            <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#2d333b ${100-aPct}%, #1f6feb ${100-aPct}%);"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function teamFormFromTracker(db, teamId, limit=6){
    const games = db.tracker
      .filter(g=>g.homeId===teamId || g.awayId===teamId)
      .slice(-limit);
    if(!games.length) return { attack:1, defense:1, momentum:1, played:0 };
    let gf=0, ga=0, pts=0;
    games.forEach(g=>{
      const isHome = g.homeId===teamId;
      const goalsFor = isHome ? Number(g.homeGoals)||0 : Number(g.awayGoals)||0;
      const goalsAgainst = isHome ? Number(g.awayGoals)||0 : Number(g.homeGoals)||0;
      gf += goalsFor;
      ga += goalsAgainst;
      pts += goalsFor>goalsAgainst ? 3 : goalsFor===goalsAgainst ? 1 : 0;
    });
    const n = games.length;
    const avgFor = gf/n;
    const avgAgainst = ga/n;
    const pointsRate = pts/(n*3);
    return {
      attack: Math.max(0.7, Math.min(1.45, 0.8 + avgFor*0.35)),
      defense: Math.max(0.7, Math.min(1.45, 0.8 + avgAgainst*0.35)),
      momentum: Math.max(0.85, Math.min(1.2, 0.9 + pointsRate*0.4)),
      played: n
    };
  }

  function normalizeStatKey(key){
    return String(key || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  }

  function statNumberFromSide(raw){
    if(raw===null || raw===undefined) return null;
    const clean = String(raw).replace("%", "").replace(",", ".").trim();
    if(!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  function metricFromStats(stats, patterns, side){
    if(!Array.isArray(stats) || !stats.length) return null;
    for(const item of stats){
      const key = normalizeStatKey(item?.key);
      if(!patterns.some(pattern=>key.includes(pattern))) continue;
      const value = statNumberFromSide(side==="home" ? item?.home : item?.away);
      if(Number.isFinite(value)) return value;
    }
    return null;
  }

  function tableContextForTeam({ teamContext, matchday, isHome }){
    const pos = clamp(Number(teamContext?.pos) || 10, 1, 20);
    const objective = pickFirstString(teamContext?.objective, "mid").toLowerCase();
    const phase = matchday>=28 ? "late" : matchday>=12 ? "mid" : "early";
    const relegationZone = pos>=18;
    const titleZone = pos<=3;
    let pressure = 0.18 + (phase==="late" ? 0.18 : phase==="mid" ? 0.08 : 0);
    if(relegationZone) pressure += phase==="late" ? 0.48 : 0.28;
    if(titleZone) pressure += phase==="late" ? 0.3 : 0.18;
    if(objective==="relegation" || objective==="survival") pressure += 0.14;
    if(objective==="title" || objective==="europe") pressure += 0.12;
    if(objective==="mid") pressure -= 0.05;

    let riskMode = 0;
    if(relegationZone) riskMode += isHome ? 0.2 : -0.1;
    if(titleZone) riskMode += isHome ? 0.1 : -0.2;
    if(objective==="cupfocus") riskMode -= 0.2;
    if(objective==="relegation") riskMode += isHome ? 0.15 : -0.05;
    if(phase==="late") riskMode += pressure>0.55 ? -0.05 : 0;

    return {
      pos,
      objective,
      pressure: clamp(pressure, 0, 1),
      riskMode: clamp(riskMode, -1, 1),
      phase
    };
  }

  function applyDrawBoostToMatrix(matrix, drawBoost){
    const safeBoost = clamp(Number(drawBoost) || 0, 0, 0.25);
    const adjusted = matrix.map((row, h)=>row.map((cell, a)=>{
      if(h!==a) return cell;
      return cell * (1 + safeBoost);
    }));
    let total = 0;
    adjusted.forEach(row=>row.forEach(p=>{ total += p; }));
    if(!(total>0)) return matrix;
    return adjusted.map(row=>row.map(p=>p/total));
  }

  function summarizeMatrix(matrix){
    let pHome = 0, pDraw = 0, pAway = 0;
    let best = { h: 0, a: 0, p: 0 };
    for(let h=0; h<matrix.length; h++){
      for(let a=0; a<matrix[h].length; a++){
        const p = matrix[h][a];
        if(h>a) pHome += p;
        else if(h===a) pDraw += p;
        else pAway += p;
        if(p>best.p) best = { h, a, p };
      }
    }
    return { pHome, pDraw, pAway, best };
  }

  function weightedAverage(items, valueFn, decay=0.9){
    if(!items.length) return null;
    let weighted = 0;
    let totalWeight = 0;
    const ordered = items.slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
    ordered.forEach((item, idx)=>{
      const value = Number(valueFn(item));
      if(!Number.isFinite(value)) return;
      const weight = decay ** (ordered.length - idx - 1);
      weighted += value * weight;
      totalWeight += weight;
    });
    return totalWeight>0 ? weighted/totalWeight : null;
  }

  function listLeagueMatches(db, leagueId, limit=140){
    return db.tracker
      .filter(m=>!leagueId || m.leagueId===leagueId)
      .slice(-limit);
  }

  function leagueContextFromTracker(db, leagueId){
    const matches = listLeagueMatches(db, leagueId, 180);
    if(!matches.length){
      return {
        matches: 0,
        avgGoalsHome: 1.35,
        avgGoalsAway: 1.15,
        avgCornersTotal: 9.2,
        avgCardsTotal: 4.4
      };
    }
    const avg = (getter, fallback=0)=>{
      const vals = matches.map(getter).filter(v=>Number.isFinite(v));
      if(!vals.length) return fallback;
      return vals.reduce((a,b)=>a+b,0)/vals.length;
    };
    const cornersAvg = avg(m=>{
      const h = pickFirstNumber(m.homeCorners, m.cornersHome, m.corners?.home);
      const a = pickFirstNumber(m.awayCorners, m.cornersAway, m.corners?.away);
      return Number.isFinite(h) && Number.isFinite(a) ? h+a : NaN;
    }, 9.2);
    const cardsAvg = avg(m=>{
      const hy = pickFirstNumber(m.homeYellow, m.cardsHomeYellow, m.cards?.homeYellow, 0) || 0;
      const ay = pickFirstNumber(m.awayYellow, m.cardsAwayYellow, m.cards?.awayYellow, 0) || 0;
      const hr = pickFirstNumber(m.homeRed, m.cardsHomeRed, m.cards?.homeRed, 0) || 0;
      const ar = pickFirstNumber(m.awayRed, m.cardsAwayRed, m.cards?.awayRed, 0) || 0;
      return hy + ay + (hr + ar) * 1.6;
    }, 4.4);

    return {
      matches: matches.length,
      avgGoalsHome: avg(m=>Number(m.homeGoals)||0, 1.35),
      avgGoalsAway: avg(m=>Number(m.awayGoals)||0, 1.15),
      avgCornersTotal: cornersAvg,
      avgCardsTotal: cardsAvg
    };
  }

  function teamAnalytics(db, teamId, leagueId, limit=20){
    const games = db.tracker
      .filter(g=>(g.homeId===teamId || g.awayId===teamId) && (!leagueId || g.leagueId===leagueId))
      .slice(-limit);
    const homeGames = games.filter(g=>g.homeId===teamId);
    const awayGames = games.filter(g=>g.awayId===teamId);

    const avgSide = (list, forKey, againstKey, fallbackFor, fallbackAgainst)=>{
      const forWeighted = weightedAverage(list, g=>pickFirstNumber(g[forKey], g[fallbackFor]), 0.9);
      const againstWeighted = weightedAverage(list, g=>pickFirstNumber(g[againstKey], g[fallbackAgainst]), 0.9);
      return {
        for: Number.isFinite(forWeighted) ? forWeighted : 0,
        against: Number.isFinite(againstWeighted) ? againstWeighted : 0,
        played: list.length
      };
    };

    const goalsHome = avgSide(homeGames, "homeGoals", "awayGoals");
    const goalsAway = avgSide(awayGames, "awayGoals", "homeGoals");
    const xgHome = avgSide(homeGames, "homeXg", "awayXg", "xgHome", "xgAway");
    const xgAway = avgSide(awayGames, "awayXg", "homeXg", "xgAway", "xgHome");

    const narrativeSideCounters = (match, side)=>{
      const counters = match?.narrativeModule?.normalized?.counters?.[side];
      if(counters) return counters;
      const events = match?.narrativeModule?.normalized?.events || [];
      const teams = match?.narrativeModule?.normalized?.teams || {};
      const sideName = String(teams[side] || "").toLowerCase();
      if(!events.length || !sideName) return null;
      return events.reduce((acc, ev)=>{
        if(String(ev?.team || "").toLowerCase()!==sideName) return acc;
        if(ev.type==="corner") acc.corners += 1;
        if(ev.type==="yellow") acc.cards += 1;
        if(ev.type==="red") acc.reds += 1;
        return acc;
      }, { corners: 0, cards: 0, reds: 0 });
    };

    const narrativeValue = (match, sideTeamId, kind)=>{
      const side = match.homeId===sideTeamId ? "home" : match.awayId===sideTeamId ? "away" : null;
      if(!side) return null;
      const counters = narrativeSideCounters(match, side);
      if(!counters) return null;
      if(kind==="corners") return Number(counters.corners);
      if(kind==="cards") return Number(counters.cards) + Number(counters.reds || 0) * 1.6;
      return null;
    };

    const cornersFor = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      return pickFirstNumber(
        isHome ? g.homeCorners : g.awayCorners,
        isHome ? g.cornersHome : g.cornersAway,
        narrativeValue(g, teamId, "corners")
      );
    }, 0.9) || 0;
    const cornersAgainst = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const oppTeamId = isHome ? g.awayId : g.homeId;
      return pickFirstNumber(
        isHome ? g.awayCorners : g.homeCorners,
        isHome ? g.cornersAway : g.cornersHome,
        narrativeValue(g, oppTeamId, "corners")
      );
    }, 0.9) || 0;
    const cardsRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const y = pickFirstNumber(isHome ? g.homeYellow : g.awayYellow, 0) || 0;
      const r = pickFirstNumber(isHome ? g.homeRed : g.awayRed, 0) || 0;
      const explicit = y + r*1.6;
      return explicit>0 ? explicit : (narrativeValue(g, teamId, "cards") || 0);
    }, 0.88) || 0;

    const statsAttackRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const side = isHome ? "home" : "away";
      const shotsOnTarget = metricFromStats(g.stats, ["shots on target", "tiros a puerta", "remates a puerta"], side);
      const dangerous = metricFromStats(g.stats, ["big chances", "ocasiones", "ataques peligrosos"], side);
      const poss = metricFromStats(g.stats, ["possession", "posesion"], side);
      const values = [
        Number.isFinite(shotsOnTarget) ? shotsOnTarget * 0.12 : null,
        Number.isFinite(dangerous) ? dangerous * 0.06 : null,
        Number.isFinite(poss) ? poss / 100 : null
      ].filter(v=>Number.isFinite(v));
      if(!values.length) return null;
      return values.reduce((a,b)=>a+b,0)/values.length;
    }, 0.9);

    const statsDefenseRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const oppSide = isHome ? "away" : "home";
      const oppShotsOnTarget = metricFromStats(g.stats, ["shots on target", "tiros a puerta", "remates a puerta"], oppSide);
      const oppDangerous = metricFromStats(g.stats, ["big chances", "ocasiones", "ataques peligrosos"], oppSide);
      const values = [
        Number.isFinite(oppShotsOnTarget) ? oppShotsOnTarget * 0.12 : null,
        Number.isFinite(oppDangerous) ? oppDangerous * 0.06 : null
      ].filter(v=>Number.isFinite(v));
      if(!values.length) return null;
      return values.reduce((a,b)=>a+b,0)/values.length;
    }, 0.9);

    const form5Games = games.slice(-5);
    let formPts = 0, formGF = 0, formGA = 0;
    form5Games.forEach(g=>{
      const isHome = g.homeId===teamId;
      const gf = isHome ? Number(g.homeGoals)||0 : Number(g.awayGoals)||0;
      const ga = isHome ? Number(g.awayGoals)||0 : Number(g.homeGoals)||0;
      formGF += gf;
      formGA += ga;
      formPts += gf>ga ? 3 : gf===ga ? 1 : 0;
    });

    return {
      sample: games.length,
      goalsHome,
      goalsAway,
      xgHome,
      xgAway,
      cornersFor,
      cornersAgainst,
      cardsRate,
      statsImpact: {
        attack: Number.isFinite(statsAttackRate) ? clamp(0.88 + statsAttackRate * 0.35, 0.78, 1.35) : 1,
        defenseWeakness: Number.isFinite(statsDefenseRate) ? clamp(0.85 + statsDefenseRate * 0.4, 0.72, 1.38) : 1,
        sample: games.filter(g=>Array.isArray(g.stats) && g.stats.length>0).length
      },
      form5: {
        played: form5Games.length,
        points: formPts,
        gf: formGF,
        ga: formGA,
        gd: formGF - formGA
      }
    };
  }

  function buildTeamBehaviorSeries(db, teamId){
    const ordered = db.tracker
      .filter(g=>g.homeId===teamId || g.awayId===teamId)
      .slice()
      .sort((a,b)=>String(a.date || "").localeCompare(String(b.date || "")));
    let cumulativePoints = 0;
    let cumulativeGoalDiff = 0;
    const formQueue = [];
    let wins = 0;
    let draws = 0;
    let losses = 0;

    const series = ordered.map((match, idx)=>{
      const isHome = match.homeId===teamId;
      const gf = isHome ? Number(match.homeGoals)||0 : Number(match.awayGoals)||0;
      const ga = isHome ? Number(match.awayGoals)||0 : Number(match.homeGoals)||0;
      const points = gf>ga ? 3 : gf===ga ? 1 : 0;
      if(points===3) wins += 1;
      else if(points===1) draws += 1;
      else losses += 1;
      cumulativePoints += points;
      cumulativeGoalDiff += gf - ga;
      formQueue.push(points);
      if(formQueue.length > 5) formQueue.shift();
      const formAvg = formQueue.reduce((acc, val)=>acc+val, 0) / formQueue.length;
      const momentumNow = clamp(formAvg / 3, 0, 1);

      return {
        index: idx + 1,
        label: match.date || `J${idx+1}`,
        cumulativePoints,
        cumulativeGoalDiff,
        momentumNow,
        gf,
        ga
      };
    });

    const last = series[series.length - 1] || null;
    const prev = series.length > 1 ? series[series.length - 2] : null;
    return {
      series,
      summary: {
        played: series.length,
        points: last?.cumulativePoints || 0,
        goalDiff: last?.cumulativeGoalDiff || 0,
        wins,
        draws,
        losses,
        currentMomentum: last?.momentumNow || 0,
        momentumDelta: last && prev ? (last.momentumNow - prev.momentumNow) : 0
      }
    };
  }

  let _teamBehaviorChart = null;
  function renderTeamBehaviorChart(canvas, behavior){
    if(!canvas || typeof Chart === "undefined") return;
    const series = behavior?.series || [];
    try{ if(_teamBehaviorChart){ _teamBehaviorChart.destroy(); _teamBehaviorChart = null; } }catch(_e){}
    if(!series.length) return;

    _teamBehaviorChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: series.map((row, idx)=> row.label || `J${idx+1}`),
        datasets: [
          {
            label: "Puntos acumulados",
            data: series.map(row=>row.cumulativePoints),
            borderColor: "#1f6feb",
            backgroundColor: "rgba(31,111,235,.2)",
            tension: 0.25,
            yAxisID: "y"
          },
          {
            label: "Momentum actual (0-100)",
            data: series.map(row=>Math.round(row.momentumNow * 100)),
            borderColor: "#2ea043",
            backgroundColor: "rgba(46,160,67,.18)",
            tension: 0.3,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        animation: { duration: 800, easing: "easeOutQuart" },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { position: "left", ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } },
          y1: {
            position: "right",
            min: 0,
            max: 100,
            ticks: { color: "#9ca3af" },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  function parseStatNumber(value){
    if(value===null || value===undefined) return null;
    if(typeof value === "number") return Number.isFinite(value) ? value : null;
    const txt = String(value).replace(/,/g, ".");
    const m = txt.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function parseSortableDate(value){
    const raw = String(value || "").trim();
    if(!raw) return Number.NaN;
    const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(exact){
      const year = Number(exact[1]);
      const month = Number(exact[2]) - 1;
      const day = Number(exact[3]);
      return Date.UTC(year, month, day);
    }
    const loose = raw.match(/^(\d{4,})-(\d{2})-(\d{2})$/);
    if(loose){
      const year = Number(String(loose[1]).slice(-4));
      const month = Number(loose[2]) - 1;
      const day = Number(loose[3]);
      return Date.UTC(year, month, day);
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  function compareByDateAsc(a, b){
    const aTs = parseSortableDate(a?.date);
    const bTs = parseSortableDate(b?.date);
    if(Number.isFinite(aTs) && Number.isFinite(bTs)) return aTs - bTs;
    if(Number.isFinite(aTs)) return -1;
    if(Number.isFinite(bTs)) return 1;
    return String(a?.date || "").localeCompare(String(b?.date || ""));
  }

  function startOfTodayTs(){
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  function diffDaysFromToday(dateStr){
    const ts = parseSortableDate(dateStr);
    if(!Number.isFinite(ts)) return null;
    return Math.round((ts - startOfTodayTs()) / 86400000);
  }

  function ensureTeamIntState(team){
    team.intProfile ||= {
      priorityCompetition: "Liga",
      seasonGoal: "top4",
      squadDepth: 3,
      coachRotation: 3,
      styleTags: [],
      derbyRivals: [],
      seasonContext: "",
      modeLens: "empresa"
    };
    if(!team.intProfile.seasonGoal && team.intProfile.seasonObjective) team.intProfile.seasonGoal = team.intProfile.seasonObjective;
    if(!team.intProfile.seasonObjective) team.intProfile.seasonObjective = team.intProfile.seasonGoal;
    if(!team.intProfile.coachRotation && team.intProfile.coachRotationPolicy) team.intProfile.coachRotation = team.intProfile.coachRotationPolicy;
    if(!team.intProfile.coachRotationPolicy) team.intProfile.coachRotationPolicy = team.intProfile.coachRotation;
    if(!Array.isArray(team.intProfile.styleTags) && Array.isArray(team.intProfile.psychTags)) team.intProfile.styleTags = [...team.intProfile.psychTags];
    if(!Array.isArray(team.intProfile.psychTags) && Array.isArray(team.intProfile.styleTags)) team.intProfile.psychTags = [...team.intProfile.styleTags];
    if(!Array.isArray(team.intProfile.derbyRivals) && Array.isArray(team.intProfile.rivalries)) team.intProfile.derbyRivals = [...team.intProfile.rivalries];
    if(!Array.isArray(team.intProfile.rivalries) && Array.isArray(team.intProfile.derbyRivals)) team.intProfile.rivalries = [...team.intProfile.derbyRivals];
    team.futureMatches ||= [];
    team.intSnapshotsByMatchId ||= {};
    team.intPatterns ||= {};
    team.intMatchStateById ||= {};
    team.contextoEstrategico ||= {
      rachaLocal: "",
      ausenciasClave: [],
      patrones: [],
      factorDia: {}
    };
    team.contextoEstrategico.rachaLocal = String(team.contextoEstrategico.rachaLocal || "").trim();
    team.contextoEstrategico.ausenciasClave = Array.isArray(team.contextoEstrategico.ausenciasClave)
      ? team.contextoEstrategico.ausenciasClave.map(item=>String(item || "").trim()).filter(Boolean)
      : [];
    team.contextoEstrategico.patrones = Array.isArray(team.contextoEstrategico.patrones)
      ? team.contextoEstrategico.patrones.map(item=>String(item || "").trim()).filter(Boolean)
      : [];
    team.contextoEstrategico.factorDia = typeof team.contextoEstrategico.factorDia === "object" && team.contextoEstrategico.factorDia !== null
      ? team.contextoEstrategico.factorDia
      : {};
  }

  function parseCommaList(raw){
    return String(raw || "")
      .split(",")
      .map(item=>item.trim())
      .filter(Boolean);
  }

  function obtenerAjusteContextual(db, equipoId, date = new Date()){
    const team = db.teams.find((t)=>t.id===equipoId);
    const ctx = team?.contextoEstrategico || {};
    const ajuste = { agresividad: 0, pulse: 0, resiliencia: 0 };

    const rachaLocal = String(ctx.rachaLocal || "").toUpperCase();
    const ausenciasClave = Array.isArray(ctx.ausenciasClave) ? ctx.ausenciasClave : [];
    const patrones = Array.isArray(ctx.patrones) ? ctx.patrones : [];
    const factorDia = ctx.factorDia && typeof ctx.factorDia === "object" ? ctx.factorDia : {};

    if(/\b\d+P\b/.test(rachaLocal) || rachaLocal.includes("P")) ajuste.resiliencia -= 0.15;
    if(ausenciasClave.length > 0) ajuste.pulse -= 0.10;
    if(patrones.some((p)=>/\b1T\b/i.test(String(p || "")))) ajuste.pulse -= 0.05;
    if(patrones.some((p)=>/no gana en casa|sin ganar en casa/i.test(String(p || "")))) ajuste.resiliencia -= 0.05;

    const dayKey = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
    const dayPenalty = Number(factorDia[dayKey]);
    if(Number.isFinite(dayPenalty)) ajuste.pulse += dayPenalty;

    ajuste.agresividad = clamp(ajuste.agresividad, -0.3, 0.3);
    ajuste.pulse = clamp(ajuste.pulse, -0.3, 0.3);
    ajuste.resiliencia = clamp(ajuste.resiliencia, -0.3, 0.3);
    return ajuste;
  }

  function normalizeImportanceTag(tag){
    const clean = String(tag || "").trim().toLowerCase();
    if(["final","top4","descenso","derby","nada en juego"].includes(clean)) return clean;
    return "nada en juego";
  }

  function stakesByTag(tag, stakesMode="table"){
    const normalized = normalizeImportanceTag(tag);
    if(stakesMode === "knockout"){
      const map = { "final":35, "derby":18, "top4":0, "descenso":0, "nada en juego":10 };
      return map[normalized] ?? 10;
    }
    const tableMap = { "top4":22, "descenso":22, "derby":12, "final":30, "nada en juego":8 };
    return tableMap[normalized] ?? 8;
  }

  function competitionWeight(db, match){
    const type = competitionTypeFromMatch(db, match);
    if(type === "continental") return 32;
    if(type === "cup") return 26;
    if(type === "friendly") return 12;
    return 22;
  }

  function competitionPressureWeight(type){
    if(type === "continental") return 1.3;
    if(type === "cup") return 0.8;
    return 1.0;
  }

  function stageWeight(stage){
    const clean = String(stage || "").toLowerCase();
    if(/final/.test(clean)) return 10;
    if(/semi|cuartos|quarter|octavos|ko|elimin/.test(clean)) return 8;
    if(/grupo|group/.test(clean)) return 4;
    return 2;
  }

  function parseMarketSnapshot(snapshot){
    const h = Number(snapshot?.homeOdds ?? snapshot?.home ?? snapshot?.h);
    const d = Number(snapshot?.drawOdds ?? snapshot?.draw ?? snapshot?.x);
    const a = Number(snapshot?.awayOdds ?? snapshot?.away ?? snapshot?.a);
    const tsRaw = snapshot?.timestamp || snapshot?.ts || snapshot?.date;
    const ts = parseSortableDate(tsRaw);
    const avg = average([h,d,a].filter(Number.isFinite), Number.NaN);
    return Number.isFinite(avg) ? { avg, ts } : null;
  }

  function buildWindowSignals({ db, team, match }){
    const allMatches = (team?.futureMatches || []).filter(Boolean);
    const centerDay = diffDaysFromToday(match.date);
    const rows = allMatches.filter(row=>row.id!==match.id).map(row=>({ row, d: diffDaysFromToday(row.date) })).filter(x=>Number.isFinite(x.d));
    const in7 = rows.filter(x=>x.d>=0 && x.d<=7).length + (Number.isFinite(centerDay) && centerDay>=0 && centerDay<=7 ? 1 : 0);
    const in14 = rows.filter(x=>x.d>=0 && x.d<=14).length + (Number.isFinite(centerDay) && centerDay>=0 && centerDay<=14 ? 1 : 0);
    const windowRows = allMatches.filter(row=>{ const d = diffDaysFromToday(row.date); return Number.isFinite(d) && d>=0 && d<=14; });
    const hardness = Math.round(windowRows.reduce((acc, row)=>{
      const stakesMode = stakesModeFromMatch(db, row);
      const pressureW = competitionPressureWeight(competitionTypeFromMatch(db, row));
      return acc + (((competitionWeight(db, row)*0.5) + stakesByTag(row.importanceTag, stakesMode)*0.5 + stageWeight(row.stage)) * pressureW);
    }, 0));
    const congestionScore = clamp((in7*20) + (in14*7) + Math.min(25, hardness/7), 0, 100);
    const futurePeak = rows.filter(x=>x.d>=0 && x.d<=7).some(x=>competitionWeight(db, x.row) + stageWeight(x.row.stage) + stakesByTag(x.row.importanceTag, stakesModeFromMatch(db, x.row)) >= 55);
    const prevIntense = rows.filter(x=>x.d<0 && x.d>=-4).some(x=>competitionWeight(db, x.row) + stakesByTag(x.row.importanceTag, stakesModeFromMatch(db, x.row)) >= 50);
    const beforePriority = rows.some(x=>x.d>0 && x.d<=4 && (competitionWeight(db, x.row) + stageWeight(x.row.stage) > competitionWeight(db, match) + stageWeight(match.stage) + 4));
    const betweenIntense = prevIntense && futurePeak;
    const sandwichRisk = clamp((beforePriority ? 60 : 0) + (betweenIntense ? 40 : 0), 0, 100);
    const recoveryNeed = clamp((prevIntense ? 45 : 10) + (congestionScore*0.45), 0, 100);
    return {
      congestionScore,
      sandwichRisk,
      peakMatchNearby: futurePeak,
      recoveryNeed,
      windowPressure: {
        matches7d: in7,
        matches14d: in14,
        hardness,
        congestionLevel: congestionScore >= 70 ? "🔴" : congestionScore >= 45 ? "🟡" : "🟢"
      }
    };
  }

  function calculateInterestSignals({ team, rival, match, allFutureMatches, db }){
    ensureTeamIntState(team);
    const profile = team.intProfile || {};
    const importanceTag = normalizeImportanceTag(match.importanceTag);
    const stakesMode = stakesModeFromMatch(db, match);
    const competitionType = competitionTypeFromMatch(db, match);
    const seasonGoal = String(profile.seasonGoal || profile.seasonObjective || "top4").toLowerCase();
    const stakes = clamp((competitionWeight(db, match)*0.55) + stageWeight(match.stage) + (stakesByTag(importanceTag, stakesMode)*0.55) + (/titulo/.test(seasonGoal) ? 4 : 1), 0, 40);
    const isPriorityComp = profile.priorityCompetition && String(match.competition||"").toLowerCase().includes(String(profile.priorityCompetition).toLowerCase());
    const contextGoal = /titulo|title/.test(seasonGoal) ? 9 : /descenso/.test(seasonGoal) ? 8 : /top4/.test(seasonGoal) ? 7 : 5;
    const contextSituation = /lider|primero/.test(String(profile.seasonContext||"").toLowerCase()) ? 6 : /persig|pelea/.test(String(profile.seasonContext||"").toLowerCase()) ? 5 : 3;
    const isDerby = importanceTag === "derby" || (rival && (profile.derbyRivals||profile.rivalries||[]).some(name=>String(name).toLowerCase()===String(rival.name||"").toLowerCase() || String(name)===String(rival.id||"")));
    const teamContext = clamp(contextGoal + contextSituation + (isPriorityComp ? 6 : 3) + (isDerby ? 6 : 0), 0, 25);
    const restDays = Number.isFinite(Number(match.restDays)) ? Number(match.restDays) : 4;
    const depth = clamp(Number(profile.squadDepth) || 3, 1, 5);
    const coachRotation = clamp(Number(profile.coachRotation || profile.coachRotationPolicy) || 3, 1, 5);
    const window = buildWindowSignals({ db, team, match });
    const windowAdjustment = clamp(8 - (window.congestionScore*0.20) - (window.sandwichRisk*0.12) - (window.recoveryNeed*0.08) + (window.peakMatchNearby ? -4 : 0), -25, 10);
    const emotion = clamp((isDerby ? 6 : 0) + (match.postHype ? 2 : 0) + (match.weatherFlag ? 1 : 0), 0, 10);
    const snapshots = Array.isArray(match.snapshots) ? match.snapshots : [];
    const parsed = snapshots.map(parseMarketSnapshot).filter(Boolean).sort((a,b)=>(Number.isFinite(a.ts)?a.ts:0)-(Number.isFinite(b.ts)?b.ts:0));
    const earlyDrift = parsed.length>=2 ? ((parsed[parsed.length-1].avg - parsed[0].avg) / parsed[0].avg) * 100 : 0;
    const lateSnapback = parsed.length>=3 ? ((parsed[parsed.length-1].avg - parsed[Math.max(0, parsed.length-2)].avg) / parsed[Math.max(0, parsed.length-2)].avg) * 100 : 0;
    const volatilityIndex = parsed.length>=2 ? clamp(stdDev(parsed.map(p=>p.avg))*60, 0, 100) : 0;
    const marketSignal = clamp((/dinero temprano/.test(String(match.marketMood||"")) ? -4 : 0) + (/raro/.test(String(match.marketMood||"")) ? -6 : 2) + (earlyDrift<=-2 ? 3 : earlyDrift>=2 ? -3 : 0) + (Math.abs(lateSnapback)>=1.5 ? -2 : 0), -10, 10);
    let interest = clamp(stakes + teamContext + windowAdjustment + emotion + marketSignal, 0, 100);
    const rotationPressure = clamp((window.congestionScore*0.35) + (window.sandwichRisk*0.35) + (window.recoveryNeed*0.2) + (coachRotation*6) - (depth*5) + (restDays<=3 ? 12 : 0), 0, 100);
    const rotationProbable = rotationPressure >= 68 ? "Alta" : rotationPressure >= 42 ? "Media" : "Baja";
    const dataCompleteness = clamp((match.competition ? 8 : 0) + (match.stage ? 8 : 0) + (match.importanceTag ? 8 : 0) + (profile.seasonGoal || profile.seasonObjective ? 8 : 0) + (profile.priorityCompetition ? 8 : 0), 0, 40);
    const depthScore = clamp((snapshots.length >= 1 ? 10 : 0) + (snapshots.length >= 2 ? 8 : 0) + (snapshots.length >= 3 ? 6 : 0) + (snapshots.some(s=>s.kind==="lineup") ? 6 : 0), 0, 30);
    const consistency = clamp((Math.abs(windowAdjustment)>=12 && Math.abs(marketSignal)<=2 ? 10 : 20) + (windowAdjustment<0 && marketSignal<0 ? 8 : 0) + (match.overrideWithoutEvidence ? -8 : 0), 0, 30);
    let confidence = clamp(dataCompleteness + depthScore + consistency, 0, 100);
    const latestRawSnapshot = snapshots[snapshots.length-1] || null;
    const underdogOdds = Number(match.isHome===false
      ? (latestRawSnapshot?.awayOdds ?? latestRawSnapshot?.away ?? latestRawSnapshot?.a)
      : (latestRawSnapshot?.homeOdds ?? latestRawSnapshot?.home ?? latestRawSnapshot?.h));
    const isUnderdogCup = competitionType === "cup" && Number.isFinite(underdogOdds) && underdogOdds > 4;
    if(isUnderdogCup){
      interest = clamp(interest + 25, 0, 100);
      confidence = clamp(confidence + 5, 0, 100);
    }
    const reasonTags = [
      isPriorityComp ? `Prioridad en ${match.competition || "competición"}` : "",
      /lider|primero/.test(String(profile.seasonContext||"").toLowerCase()) ? "Defiende posición alta" : "",
      window.congestionScore >= 55 ? `Bloque cargado (${window.windowPressure.matches14d} partidos/14d)` : "",
      window.sandwichRisk >= 60 ? "Partido en sándwich de calendario" : "",
      window.peakMatchNearby ? "Hay partido pico cercano" : ""
    ].filter(Boolean).slice(0,2);
    team.intMatchStateById[match.id] = {
      computed: { interest, rotationProbable, confidence },
      windowInfo: {
        congestion: Math.round(window.congestionScore),
        sandwich: Math.round(window.sandwichRisk),
        peakNearby: window.peakMatchNearby,
        recoveryNeed: Math.round(window.recoveryNeed)
      },
      snapshots,
      notes: Array.isArray(match.notes) ? match.notes : []
    };
    return {
      stakes, teamContext, windowAdjustment, rotationPressure,
      interest, confidence,
      rotationProbable,
      marketMood: match.marketMood || "estable",
      restDays,
      stakesMode,
      reasonTags,
      market: { earlyDrift, lateSnapback, volatilityIndex, marketSignal },
      windowInfo: window
    };
  }

  function buildTeamIntPatterns(db, team){
    const matches = db.tracker.filter(m=>m.homeId===team.id || m.awayId===team.id).slice(-18);
    if(!matches.length) return { badges:["Sin datos suficientes"], drop:0, variance:0, preBigDrop:0 };
    const goalDiffs = matches.map(m=>{
      const isHome = m.homeId===team.id;
      return (isHome ? Number(m.homeGoals) - Number(m.awayGoals) : Number(m.awayGoals) - Number(m.homeGoals));
    });
    const lowStake = team.futureMatches.filter(m=>normalizeImportanceTag(m.importanceTag)==="nada en juego").length;
    const variance = stdDev(goalDiffs);
    const avg = average(goalDiffs, 0);
    const badges = [];
    if(lowStake>=2 && avg < 0.2) badges.push("🧊 Baja intensidad en low-stakes");
    if(variance > 1.3) badges.push("🎲 Alta varianza cuando rota");
    if(goalDiffs.some(v=>v>=2)) badges.push("⚡ Se activa en partidos grandes");
    if(matches.filter(m=>{
      const isHome = m.homeId===team.id;
      return !isHome && Number(m.homeGoals)===Number(m.awayGoals);
    }).length >= 3) badges.push("🧯 Tiende a conformarse con empate de visita");
    return { badges: badges.length ? badges : ["Sin patrón fuerte todavía"], drop: Math.round((0.5 - avg) * 10), variance: Number(variance.toFixed(2)), preBigDrop: Math.round(variance*8) };
  }

  function getMatchStatForTeam(match, teamId, regexList=[]){
    const stats = Array.isArray(match?.stats) ? match.stats : [];
    if(!stats.length) return null;
    const isHome = match.homeId===teamId;
    const keyField = (row)=>String(row?.key || row?.name || row?.label || "").toLowerCase();
    for(const row of stats){
      const key = keyField(row);
      if(!regexList.some(rx=>rx.test(key))) continue;
      const sideValue = isHome ? (row.home ?? row.local ?? row.teamA) : (row.away ?? row.visitante ?? row.teamB);
      const parsed = parseStatNumber(sideValue);
      if(Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function average(values, fallback=0){
    const clean = values.filter(v=>Number.isFinite(v));
    if(!clean.length) return fallback;
    return clean.reduce((a,b)=>a+b,0) / clean.length;
  }

  function stdDev(values){
    const clean = values.filter(v=>Number.isFinite(v));
    if(clean.length < 2) return 0;
    const mean = average(clean, 0);
    const variance = clean.reduce((acc, val)=>acc + (val - mean) ** 2, 0) / clean.length;
    return Math.sqrt(Math.max(0, variance));
  }

  function normalizePersonName(name){
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function psychHeatColor(score){
    const v = clamp(Number(score) || 0, 0, 100);
    if(v >= 72) return "#3fb950";
    if(v >= 52) return "#58a6ff";
    if(v >= 35) return "#d29922";
    return "#f85149";
  }

  function computeTeamPlayerPsychHeat(db, teamId, options={}){
    const maxMatches = clamp(Number(options.maxMatches) || 12, 3, 30);
    const players = db.players.filter(p=>p.teamId===teamId);
    const matches = db.tracker
      .filter(m=>m.homeId===teamId || m.awayId===teamId)
      .slice()
      .sort(compareByDateAsc)
      .slice(-maxMatches);
    const perPlayer = new Map();

    const touchPlayer = (name)=>{
      const key = normalizePersonName(name);
      if(!key) return null;
      if(!perPlayer.has(key)) perPlayer.set(key, {
        key,
        name: String(name || "").trim() || "Jugador",
        score: 50,
        events: 0,
        aggr: 0,
        res: 0,
        vol: 0,
        fat: 0
      });
      return perPlayer.get(key);
    };

    matches.forEach((match, idx)=>{
      const teamName = match.homeId===teamId ? match.homeName : match.awayName;
      const teamNorm = normalizePersonName(teamName);
      const recency = 0.68 + ((idx + 1) / Math.max(1, matches.length)) * 0.32;
      const events = match?.narrativeModule?.normalized?.events || [];
      events.forEach((evt)=>{
        const playerName = evt?.player;
        if(!playerName) return;
        const evtTeamNorm = normalizePersonName(evt?.team);
        if(teamNorm && evtTeamNorm && teamNorm !== evtTeamNorm) return;
        const p = touchPlayer(playerName);
        if(!p) return;
        const min = Number(evt?.min);
        let scoreDelta = 0;
        if(evt.type === "goal"){
          scoreDelta += 9;
          p.res += 0.16;
        }else if(evt.type === "save"){
          scoreDelta += 7;
          p.res += 0.14;
        }else if(evt.type === "corner"){
          scoreDelta += 1.4;
        }else if(evt.type === "yellow"){
          scoreDelta -= 6.5;
          p.aggr += 0.16;
          p.vol += 0.12;
        }else if(evt.type === "red"){
          scoreDelta -= 16;
          p.aggr += 0.28;
          p.vol += 0.22;
          p.fat += 0.14;
        }else if(evt.type === "foul"){
          scoreDelta -= 2;
          p.aggr += 0.08;
        }else if(evt.type === "offside"){
          scoreDelta -= 1.2;
          p.vol += 0.04;
        }else if(evt.type === "sub"){
          if(Number.isFinite(min) && min >= 70) p.fat += 0.04;
          scoreDelta += 0.5;
        }
        p.score = clamp(p.score + scoreDelta * recency, 0, 100);
        p.events += 1;
      });
    });

    const rosterHeat = players.map((pl)=>{
      const key = normalizePersonName(pl.name);
      const fromNarrative = perPlayer.get(key);
      const statBase = clamp(
        50
        + (Number(pl.goals)||0) * 1.5
        + (Number(pl.assists)||0) * 1.3
        + clamp((Number(pl.minutes)||0) / 700, 0, 4)
        - (Number(pl.yellowCards)||0) * 1.9
        - (Number(pl.redCards)||0) * 7,
        5,
        95
      );
      const heat = fromNarrative
        ? clamp(fromNarrative.score * 0.72 + statBase * 0.28, 0, 100)
        : statBase;
      return {
        key,
        name: pl.name,
        heat,
        events: fromNarrative?.events || 0,
        aggr: fromNarrative?.aggr || 0,
        res: fromNarrative?.res || 0,
        vol: fromNarrative?.vol || 0,
        fat: fromNarrative?.fat || 0
      };
    });

    const heatValues = rosterHeat.map(item=>item.heat);
    const avgHeat = average(heatValues, 50);
    const spread = stdDev(heatValues);
    const byName = {};
    rosterHeat.forEach(item=>{ byName[item.key] = Math.round(item.heat); });
    const samples = Math.max(1, rosterHeat.length);
    const aggr = rosterHeat.reduce((sum, p)=>sum + p.aggr, 0) / samples;
    const res = rosterHeat.reduce((sum, p)=>sum + p.res, 0) / samples;
    const vol = rosterHeat.reduce((sum, p)=>sum + p.vol, 0) / samples;
    const fat = rosterHeat.reduce((sum, p)=>sum + p.fat, 0) / samples;

    return {
      byName,
      list: rosterHeat,
      summary: {
        avgHeat,
        spread,
        narrativeEvents: rosterHeat.reduce((sum, p)=>sum + p.events, 0),
        psychAdjustments: {
          aggressiveness: clamp(aggr * 28 + Math.max(0, 52 - avgHeat) * 0.12, -8, 12),
          resilience: clamp(res * 24 + (avgHeat - 50) * 0.18, -10, 12),
          volatility: clamp(vol * 30 + spread * 0.07, -8, 14),
          fatigue: clamp(fat * 18 + Math.max(0, 54 - avgHeat) * 0.1, -8, 12)
        },
        teamPsychPulse: clamp(avgHeat - spread * 0.3 + res * 40 - fat * 24, 0, 100)
      }
    };
  }

    function engineForTeam(db, teamId){
    return recomputeTeamGlobalEngine(db, teamId) || getOrCreateDiagProfile(db, teamId, "").engineV1 || {};
  }

function computeTeamIntelligencePanel(db, teamId){
    const matches = db.tracker
      .filter(m=>m.homeId===teamId || m.awayId===teamId)
      .slice()
      .sort(compareByDateAsc);
    const engine = recomputeTeamGlobalEngine(db, teamId) || getOrCreateDiagProfile(db, teamId, "").engineV1 || {};
    const playerHeat = computeTeamPlayerPsychHeat(db, teamId);
    if(!matches.length){
      return {
        matches: [],
        metrics: { powerIndex: 50, trend: "→ Plano", trendSlope: 0, consistencyScore: 50, momentum5: 0.5 },
        psych: { aggressiveness: 50, resilience: 50, volatility: 50, fatigue: 50, playerPulse: playerHeat.summary.teamPsychPulse },
        tactical: { directAttack: 50, possession: 50, transitions: 50, press: 50, setPieces: 50 },
        momentum: { labels: [], xgDifferential: [], realPerformance: [], expectedPerformance: [] },
        prediction: { eloDynamic: 1500, offenseRating: 50, defenseRating: 50, psychIndex: 50, consistencyIndex: 50 },
        sos: { sos01: 0.5, sos: 0 },
        playerHeat
      };
    }

    const pointsSeries = [];
    const xgDiffSeries = [];
    const expectedSeries = [];
    const powerSeries = [];
    const fatigueLoad = [];
    const labels = [];
    let comebackPoints = 0;
    let comebackSamples = 0;
    let travelPenalty = 0;

    matches.forEach((m, idx)=>{
      const isHome = m.homeId===teamId;
      const gf = isHome ? Number(m.homeGoals)||0 : Number(m.awayGoals)||0;
      const ga = isHome ? Number(m.awayGoals)||0 : Number(m.homeGoals)||0;
      const pts = gf>ga ? 3 : gf===ga ? 1 : 0;
      const xgFor = isHome ? parseStatNumber(m.homeXg) : parseStatNumber(m.awayXg);
      const xgAgainst = isHome ? parseStatNumber(m.awayXg) : parseStatNumber(m.homeXg);
      const xgDiff = Number.isFinite(xgFor) && Number.isFinite(xgAgainst) ? xgFor - xgAgainst : (gf - ga) * 0.6;
      const expectedPts = clamp(1.5 + xgDiff * 1.2, 0, 3);
      labels.push(m.date || `J${idx+1}`);
      pointsSeries.push(pts);
      xgDiffSeries.push(xgDiff);
      expectedSeries.push(expectedPts / 3);
      if(ga > 0){
        comebackSamples += 1;
        if(gf >= ga) comebackPoints += pts;
      }
      if(!isHome) travelPenalty += 1;
      const dateTs = parseSortableDate(m.date);
      const prevTs = idx>0 ? parseSortableDate(matches[idx-1].date) : NaN;
      const restDays = Number.isFinite(dateTs) && Number.isFinite(prevTs) ? Math.max(0, (dateTs - prevTs)/(1000*60*60*24)) : 5;
      fatigueLoad.push(clamp((4 - restDays) / 4, 0, 1));

      const shortPoints = pointsSeries.slice(Math.max(0, pointsSeries.length - 5));
      const momentum5 = average(shortPoints, 1.5) / 3;
      const consistencyInv = 1 - clamp(stdDev(pointsSeries) / 1.5, 0, 1);
      const homeMatches = matches.slice(0, idx+1).filter(x=>x.homeId===teamId);
      const awayMatches = matches.slice(0, idx+1).filter(x=>x.awayId===teamId);
      const homePpg = average(homeMatches.map(x=>{ const g1=Number(x.homeGoals)||0, g2=Number(x.awayGoals)||0; return g1>g2?3:g1===g2?1:0; }), 1.2) / 3;
      const awayPpg = average(awayMatches.map(x=>{ const g1=Number(x.awayGoals)||0, g2=Number(x.homeGoals)||0; return g1>g2?3:g1===g2?1:0; }), 1.0) / 3;
      const locality = clamp(0.5 + (homePpg - awayPpg) * 0.5, 0, 1);
      const psychInverse = 1 - clamp(Number(engine?.profile?.psychLoad) || 0.5, 0, 1);
      const shockInverse = 1 - clamp(Number(engine?.profile?.shock) || 0.5, 0, 1);
      const xgNorm = clamp(0.5 + average(xgDiffSeries, 0) / 2.2, 0, 1);
      const power = clamp((0.30*xgNorm + 0.20*momentum5 + 0.15*consistencyInv + 0.15*locality + 0.10*psychInverse + 0.10*shockInverse) * 100, 0, 100);
      powerSeries.push(power);
    });

    const momentum5 = average(pointsSeries.slice(-5), 1.5) / 3;
    const consistencyScore = clamp((1 - stdDev(pointsSeries)/1.5) * 100, 0, 100);
    const powerIndex = powerSeries[powerSeries.length-1] || 50;
    const recentAvg = average(powerSeries.slice(-5), powerIndex);
    const prevAvg = average(powerSeries.slice(-10, -5), recentAvg);
    const trendSlope = recentAvg - prevAvg;

    const aggressionBase = clamp(
      35 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/falta/, /foul/]) ?? 12), 12) / 20
      + 20 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/amarilla/, /yellow/]) ?? 2.2), 2.2) / 5
      + 25 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/duel/]) ?? 50), 50) / 100
      + 20 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/tiro.*20/, /shot.*20/]) ?? 2), 2) / 6,
      0,
      100
    );
    const resilienceBase = clamp(
      50 * (comebackSamples ? (comebackPoints / (comebackSamples*3)) : 0.5)
      + 30 * clamp(average(pointsSeries.slice(-5), 1.5) / 3, 0, 1)
      + 20 * clamp((Number(engine?.haTraits?.awayResilience)||0), 0, 1),
      0,
      100
    );
    const perfResidual = pointsSeries.map((pts, i)=>(pts/3) - expectedSeries[i]);
    const volatilityBase = clamp(stdDev(perfResidual) * 220, 0, 100);
    const fatigueBase = clamp((average(fatigueLoad, 0.4)*60) + (travelPenalty / Math.max(1, matches.length))*40, 0, 100);
    const psychAdj = playerHeat.summary.psychAdjustments;
    const aggression = clamp(aggressionBase + psychAdj.aggressiveness, 0, 100);
    const resilience = clamp(resilienceBase + psychAdj.resilience, 0, 100);
    const volatility = clamp(volatilityBase + psychAdj.volatility, 0, 100);
    const fatigue = clamp(fatigueBase + psychAdj.fatigue, 0, 100);

    const possession = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/posesi/]) ?? 50), 50), 0, 100);
    const wingPlay = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/banda/, /cross/, /centro/]) ?? 40), 40), 0, 100);
    const inBoxShots = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/área/, /area/, /box/]) ?? 45), 45), 0, 100);
    const progressivePass = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/progres/]) ?? 48), 48), 0, 100);
    const highPress = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/presi/, /press/]) ?? 46), 46), 0, 100);
    const sos01 = average(matches.map((m)=>Number(m?.opponentStrengthByTeam?.[teamId]?.blend?.strength01) || 0.5), 0.5);
    const sos = Math.round((sos01 - 0.5) * 400);

    return {
      matches,
      metrics: {
        powerIndex,
        trendSlope,
        trend: trendSlope > 2 ? "↗ Subiendo" : trendSlope < -2 ? "↘ Cayendo" : "→ Plano",
        consistencyScore,
        momentum5,
        powerSeries,
        labels
      },
      psych: { aggressiveness: aggression, resilience, volatility, fatigue, playerPulse: playerHeat.summary.teamPsychPulse },
      playerHeat,
      tactical: {
        directAttack: clamp((wingPlay*0.4 + inBoxShots*0.6), 0, 100),
        possession,
        transitions: clamp((progressivePass*0.6 + highPress*0.4), 0, 100),
        press: highPress,
        setPieces: clamp((average(matches.map(m=>isFinite(parseStatNumber(m.homeCorners)||parseStatNumber(m.awayCorners)) ? (m.homeId===teamId ? Number(m.homeCorners)||0 : Number(m.awayCorners)||0) : 5), 5) / 12) * 100, 0, 100)
      },
      momentum: {
        labels,
        xgDifferential: xgDiffSeries.map(v=>clamp(50 + v*20, 0, 100)),
        realPerformance: pointsSeries.map(v=>Math.round((v/3)*100)),
        expectedPerformance: expectedSeries.map(v=>Math.round(v*100))
      },
      prediction: {
        eloDynamic: Math.round(1450 + powerIndex*3.2),
        offenseRating: clamp(50 + average(xgDiffSeries, 0)*18 + average(pointsSeries.slice(-5), 1.5)*8, 0, 100),
        defenseRating: clamp(55 - average(xgDiffSeries, 0)*14 + consistencyScore*0.25, 0, 100),
        psychIndex: clamp(100 - ((fatigue*0.45) + (volatility*0.25) - (resilience*0.2) - (aggression*0.1)), 0, 100),
        consistencyIndex: consistencyScore
      },
      sos: { sos01: Number(sos01.toFixed(2)), sos }
    };
  }

  function renderSimpleLineChart(canvas, labels, datasets){
    if(!canvas || typeof Chart !== "function") return;
    if(canvas._chart){ try{ canvas._chart.destroy(); }catch(_e){} }
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        animation: { duration: 800, easing: "easeOutQuart" },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { min: 0, max: 100, ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } }
        }
      }
    });
  }

  function renderRadarChart(canvas, labels, data, color="#1f6feb"){
    if(!canvas || typeof Chart !== "function") return;
    if(canvas._chart){ try{ canvas._chart.destroy(); }catch(_e){} }
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels,
        datasets: [{ label: "Índice", data, borderColor: color, backgroundColor: `${color}33`, pointBackgroundColor: color }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        animation: { duration: 800, easing: "easeOutQuart" },
        scales: { r: { suggestedMin: 0, suggestedMax: 100, angleLines: { color: "rgba(255,255,255,.1)" }, grid: { color: "rgba(255,255,255,.09)" }, pointLabels: { color: "#9ca3af" }, ticks: { color: "#9ca3af", backdropColor: "transparent" } } }
      }
    });
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value){
    return clamp(Number(value) || 0, 0, 1);
  }

  function ensureDiagProfileState(db){
    db.diagProfiles ||= {};
  }

  function createEmptyDiagProfile(teamName=""){
    return {
      team: teamName,
      version: "diagProfile_v1",
      matchesCount: 0,
      traits: {
        territorial_strength: 0.5,
        finishing_quality: 0.5,
        transition_attack: 0.5,
        transition_defense: 0.5,
        low_block_execution: 0.5,
        chance_creation: 0.5,
        discipline_risk: 0.5,
        late_game_management: 0.5
      },
      lastUpdated: null
    };
  }

  function getOrCreateDiagProfile(db, teamId, teamName){
    ensureDiagProfileState(db);
    if(!db.diagProfiles[teamId]) db.diagProfiles[teamId] = createEmptyDiagProfile(teamName || "");
    const profile = db.diagProfiles[teamId];
    profile.team = teamName || profile.team || "";
    profile.version = "diagProfile_v1";
    profile.matchesCount = Number(profile.matchesCount) || 0;
    profile.traits ||= createEmptyDiagProfile().traits;
    Object.keys(createEmptyDiagProfile().traits).forEach(key=>{
      profile.traits[key] = clamp(Number(profile.traits[key]) || 0.5, 0, 1);
    });
    return profile;
  }

  function classifyStyle(traits={}){
    if((traits.territorial_strength||0)>0.58 && (traits.finishing_quality||0)<0.45) return "sterile_domination";
    if((traits.low_block_execution||0)>0.55 && (traits.transition_attack||0)>0.55) return "absorb_and_strike";
    if((traits.late_game_management||0)>0.58) return "late_collider";
    if((traits.discipline_risk||0)>0.62) return "high_variance";
    if((traits.territorial_strength||0)>0.56 && (traits.chance_creation||0)>0.52) return "territorial_builder";
    return "balanced";
  }

  function createRng(seed){
    if(!Number.isFinite(Number(seed))) return Math.random;
    let x = (Number(seed) >>> 0) || 1;
    return ()=>{
      x += 0x6D2B79F5;
      let r = Math.imul(x ^ (x >>> 15), x | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng){
    const u = Math.max(1e-9, rng());
    const v = Math.max(1e-9, rng());
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }

  function buildMatchPlan(teamAProfile, teamBProfile, context={}){
    const h = teamAProfile.traits || {};
    const a = teamBProfile.traits || {};
    const clash = [];
    if((h.territorial_strength||0)>0.56 && (a.transition_attack||0)>0.55 && (h.transition_defense||0)<0.47) clash.push("away_transition_window");
    if((a.territorial_strength||0)>0.56 && (h.transition_attack||0)>0.55 && (a.transition_defense||0)<0.47) clash.push("home_transition_window");
    if((h.territorial_strength||0)>0.58 && (h.finishing_quality||0)<0.45) clash.push("home_sterile_risk");
    if((a.territorial_strength||0)>0.58 && (a.finishing_quality||0)<0.45) clash.push("away_sterile_risk");
    return {
      home: teamAProfile.team,
      away: teamBProfile.team,
      context: {
        homeAdv: clamp(Number(context.homeAdv)||0.06, 0, 0.3),
        leagueGoalsAvg: clamp(Number(context.leagueGoalsAvg)||2.6, 1.6, 4.2)
      },
      matchup: {
        homeStyle: classifyStyle(h),
        awayStyle: classifyStyle(a),
        styleClash: clash
      },
      rates: {
        baseGoalRatePerBlock: clamp(Number(context.baseGoalRatePerBlock)||0.22, 0.08, 0.6),
        volatility: clamp(Number(context.globalVolatility)||0.34, 0.1, 0.8)
      },
      homeProfile: teamAProfile,
      awayProfile: teamBProfile
    };
  }

  function generateCandlesFromBlocks(blocks=[], team="home"){
    let prev = 0;
    return blocks.map(b=>{
      const close = team==="home" ? Number(b.iddHome)||0 : Number(b.iddAway)||0;
      const item = { label: `${b.t0}-${b.t1}`, open: prev, close, high: Math.max(prev, close), low: Math.min(prev, close) };
      prev = close;
      return item;
    });
  }

  function generateDiagnosis(candles=[], blocksEvents=[]){
    const closes = candles.map(c=>Number(c.close)||0);
    const diffs = closes.slice(1).map((v, i)=>v-closes[i]);
    let breakIdx = 0;
    let maxDelta = -1;
    diffs.forEach((d, i)=>{ if(Math.abs(d)>maxDelta){ maxDelta = Math.abs(d); breakIdx = i+1; } });
    const breakBlock = candles[breakIdx]?.label || "0-10";
    const late = closes.slice(8);
    const lateStrength = late.length ? late.reduce((a,b)=>a+b,0)/late.length : 0;
    const signs = closes.reduce((acc,v,i)=> acc + ((i>0 && Math.sign(v)!==Math.sign(closes[i-1])) ? 1 : 0), 0);
    const vol = closes.length ? Math.sqrt(closes.reduce((s,v)=>s + v*v,0)/closes.length) : 0;
    const patterns = [];
    if(blocksEvents.some(e=>e.type==="goal" && e.shock)) patterns.push("shock_transition");
    if(vol>0.35) patterns.push("oscillation");
    if(lateStrength<-0.12) patterns.push("late_risk_exposure");
    if(signs>=5) patterns.push("second_half_break");
    if(!blocksEvents.some(e=>e.type==="goal") && closes.reduce((a,b)=>a+b,0)>1.2) patterns.push("sterile_dominance");
    const text = [];
    if(patterns.includes("sterile_dominance")) text.push("Dominio sin conversión: presión sostenida sin premio.");
    if(patterns.includes("shock_transition")) text.push("Gol contra tendencia: transición castiga el control rival.");
    if(patterns.includes("late_risk_exposure")) text.push("Cierre vulnerable: exposición tardía.");
    if(!text.length) text.push("Partido por fases sin quiebre dominante.");
    return { breakBlock, patterns, text, metrics: { vol, lateStrength, switches: signs } };
  }

  function applyMatchToTeamProfile(profile, diagnostic, perspective="for"){
    const next = structuredClone(profile || createEmptyDiagProfile());
    const alpha = 0.12;
    const touch = (k, s)=>{ next.traits[k] = clamp(next.traits[k]*(1-alpha) + s*alpha, 0, 1); };
    const has = p=>diagnostic?.patterns?.includes(p);
    if(has("sterile_dominance")){ touch("territorial_strength", 0.66); touch("finishing_quality", 0.36); }
    if(has("shock_transition")){ touch("transition_attack", perspective==="for" ? 0.66 : 0.45); touch("transition_defense", perspective==="against" ? 0.35 : 0.58); }
    if(has("late_risk_exposure")) touch("late_game_management", 0.35);
    if(has("oscillation")) touch("discipline_risk", 0.64);
    next.matchesCount = (Number(next.matchesCount)||0) + 1;
    next.lastUpdated = new Date().toISOString();
    return next;
  }

  function normalizeIdd(value){
    const raw = clamp(Number(value) || 0, -1, 1);
    return clamp((raw + 1) / 2, 0, 1);
  }

  function computePerformanceIndex(metrics={}){
    const avgIDD = normalizeIdd(metrics.avgIDD);
    const threat = clamp(Number(metrics.threat) || 0, 0, 1);
    const lateIDD = normalizeIdd(metrics.lateIDD);
    const avgComposure = clamp(Number(metrics?.psych?.avgComposure) || 0, 0, 1);
    const avgTiltRisk = clamp(Number(metrics?.psych?.avgTiltRisk) || 0, 0, 1);
    return clamp(
      0.45 * avgIDD +
      0.25 * threat +
      0.10 * lateIDD +
      0.10 * avgComposure -
      0.10 * avgTiltRisk,
      0,
      1
    );
  }

  function createHomeAwayBucket(){
    return { n: 0, avgPI: 0.5, avgIDD: 0, avgThreat: 0.5, avgComposure: 0.5, avgTilt: 0.5, lateStrength: 0.5 };
  }

  function updateHomeAwayBucket(bucket, payload){
    const prevN = Number(bucket.n) || 0;
    const alpha = prevN < 10 ? 0.18 : 0.10;
    const ema = (oldVal, nextVal)=> oldVal * (1 - alpha) + nextVal * alpha;
    bucket.avgPI = clamp(ema(Number(bucket.avgPI) || 0.5, clamp(Number(payload.pi) || 0.5, 0, 1)), 0, 1);
    bucket.avgIDD = clamp(ema(Number(bucket.avgIDD) || 0, clamp(Number(payload.avgIDD) || 0, -1, 1)), -1, 1);
    bucket.avgThreat = clamp(ema(Number(bucket.avgThreat) || 0.5, clamp(Number(payload.threat) || 0, 0, 1)), 0, 1);
    bucket.avgComposure = clamp(ema(Number(bucket.avgComposure) || 0.5, clamp(Number(payload.avgComposure) || 0, 0, 1)), 0, 1);
    bucket.avgTilt = clamp(ema(Number(bucket.avgTilt) || 0.5, clamp(Number(payload.avgTilt) || 0, 0, 1)), 0, 1);
    bucket.lateStrength = clamp(ema(Number(bucket.lateStrength) || 0.5, normalizeIdd(payload.lateIDD)), 0, 1);
    bucket.n = prevN + 1;
    return bucket;
  }

  function computeHaTraits(homeBucket, awayBucket){
    const homeBoost = clamp((Number(homeBucket.avgPI) || 0.5) - (Number(awayBucket.avgPI) || 0.5), -0.30, 0.30);
    const awayResilience = clamp((Number(awayBucket.avgPI) || 0.5) / ((Number(homeBucket.avgPI) || 0.5) + 0.001), 0, 1);
    const awayFragility = clamp(1 - awayResilience, 0, 1);
    const crowdEnergy = clamp((Number(homeBucket.lateStrength) || 0.5) - (Number(awayBucket.lateStrength) || 0.5) + 0.5, 0, 1);
    const travelTilt = clamp((Number(awayBucket.avgTilt) || 0.5) - (Number(homeBucket.avgTilt) || 0.5) + 0.5, 0, 1);
    return { homeBoost, awayResilience, awayFragility, crowdEnergy, travelTilt };
  }

  const PESOS_FOOTBALL_LAB = {
    agresividad: {
      "falta": 0.04,
      "tarjeta amarilla": 0.18,
      "tarjeta roja": 0.50,
      "entrada dura": 0.12,
      "amonestado": 0.15,
      "pelea": 0.25,
      "discusión": 0.10,
      "var": 0.08
    },
    peligro: {
      "remate": 0.12,
      "tiro a puerta": 0.15,
      "larguero": 0.25,
      "poste": 0.25,
      "paradón": 0.20,
      "salva bajo palos": 0.30,
      "córner": 0.05,
      "fuera de juego": -0.02,
      "ataque": 0.03
    }
  };

  function escapeRegexToken(text = ""){
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function detectarMinutoMaximoRelato(texto = ""){
    const pattern = /(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*'/g;
    let maxMinute = 0;
    let match;
    while((match = pattern.exec(texto)) !== null){
      const base = Number(match[1]) || 0;
      const extra = Number(match[2]) || 0;
      const minute = base + extra;
      if(minute > maxMinute) maxMinute = minute;
    }
    return Math.max(maxMinute, 0);
  }

  function extraerMetricasDelRelato(texto = ""){
    const raw = String(texto || "").toLowerCase();
    const baseScores = { agresividad: 0, peligro: 0 };

    for(const categoria of Object.keys(PESOS_FOOTBALL_LAB)){
      for(const [palabra, peso] of Object.entries(PESOS_FOOTBALL_LAB[categoria])){
        const regex = new RegExp(escapeRegexToken(palabra), "gi");
        const coincidencias = (raw.match(regex) || []).length;
        baseScores[categoria] += coincidencias * Number(peso || 0);
      }
    }

    const minutoMax = detectarMinutoMaximoRelato(raw);
    const ventanaMin = minutoMax > 0 ? minutoMax : 90;
    const factorTiempo = Math.max(ventanaMin / 90, 0.1);
    const golesDetectados = (raw.match(/\bg+o+l+\b|\banota\b|\bmarca\b/gi) || []).length;

    return {
      agresividad: clamp(baseScores.agresividad / factorTiempo, 0, 1),
      peligro: clamp(baseScores.peligro / factorTiempo, 0, 1),
      golesDetectados,
      minutoMax,
      factorTiempo,
      raw: baseScores
    };
  }

  function extraerMarcadorDesdeRelato(texto = ""){
    const raw = String(texto || "");
    const marcadorRegex = /(\d{1,2})\s*[-:]\s*(\d{1,2})/g;
    let match;
    let ultimo = null;
    while((match = marcadorRegex.exec(raw)) !== null){
      ultimo = { home: Number(match[1]) || 0, away: Number(match[2]) || 0 };
    }
    return ultimo;
  }

  function ajustarPrediccionPorMarcador(prediccion = [0, 0, 0], golesFavor = 0, golesContra = 0){
    const base = Array.isArray(prediccion) ? prediccion.map((v)=>Math.max(0, Number(v) || 0)) : [0, 0, 0];
    while(base.length < 3) base.push(0);
    const diferencia = (Number(golesFavor) || 0) - (Number(golesContra) || 0);
    let boost = 0;
    if(diferencia >= 2) boost = 0.35;
    else if(diferencia === 1) boost = 0.15;
    else if(diferencia === -1) boost = -0.20;
    else if(diferencia <= -2) boost = -0.35;

    const salida = [...base];
    salida[0] = clamp(salida[0] + boost, 0, 1);
    if(boost > 0){
      salida[1] = Math.max(0, salida[1] - boost * 0.45);
      salida[2] = Math.max(0, salida[2] - boost * 0.55);
    }else if(boost < 0){
      const castigo = Math.abs(boost);
      salida[1] = Math.max(0, salida[1] - castigo * 0.35);
      salida[2] = clamp(salida[2] + castigo * 0.35, 0, 1);
    }

    const sum = salida.reduce((acc, v)=>acc + v, 0) || 1;
    return salida.map((v)=>v / sum);
  }

  function computeTeamNarrativeMetrics(matches = []){
    const narrated = matches
      .map((match)=>({
        match,
        text: String(match?.narrativeModule?.rawText || "").trim()
      }))
      .filter((row)=>row.text.length>0)
      .map((row)=>({ ...row, metrics: extraerMetricasDelRelato(row.text) }));

    if(!narrated.length){
      return {
        games: 0,
        avgAgresividad: 0,
        avgPeligro: 0,
        avgWindow: 90,
        topAgresividad: null,
        topPeligro: null
      };
    }

    const avgAgresividad = narrated.reduce((acc, row)=>acc + row.metrics.agresividad, 0) / narrated.length;
    const avgPeligro = narrated.reduce((acc, row)=>acc + row.metrics.peligro, 0) / narrated.length;
    const avgWindow = narrated.reduce((acc, row)=>acc + (row.metrics.minutoMax || 90), 0) / narrated.length;
    const byAgg = [...narrated].sort((a,b)=>b.metrics.agresividad - a.metrics.agresividad);
    const byDanger = [...narrated].sort((a,b)=>b.metrics.peligro - a.metrics.peligro);

    return {
      games: narrated.length,
      avgAgresividad,
      avgPeligro,
      avgWindow,
      topAgresividad: byAgg[0] || null,
      topPeligro: byDanger[0] || null
    };
  }

  function inferEngineMetricsFromMatch(match, teamId){
    const isHome = match?.homeId===teamId;
    const side = isHome ? "home" : "away";
    const oppSide = isHome ? "away" : "home";
    const narrativeLabels = match?.narrativeModule?.diagnostic?.diagnostic?.labels
      || match?.narrativeModule?.diagnostic?.labels
      || {};
    const avgIDD = clamp(Number(narrativeLabels.control_without_conversion) || 0, 0, 1) * 2 - 1;
    const lateIDD = clamp(Number(narrativeLabels.late_risk_exposure) || 0, 0, 1) * 2 - 1;
    const threat = metricFromStats(match?.stats, ["big chances", "ocasiones", "ataques peligrosos"], side);
    const intensityRaw = metricFromStats(match?.stats, ["shots", "remates", "shots on target", "tiros a puerta"], side);
    const ownXg = metricFromStats(match?.stats, ["goles esperados (xg)", "xg"], side);
    const oppXg = metricFromStats(match?.stats, ["goles esperados (xg)", "xg"], oppSide);
    const ownXgot = metricFromStats(match?.stats, ["xg a puerta", "xgot"], side);
    const shotsOn = metricFromStats(match?.stats, ["shots on target", "tiros a puerta", "remates a puerta"], side);
    const corners = metricFromStats(match?.stats, ["corners", "corneres", "córneres"], side);
    const touchesBox = metricFromStats(match?.stats, ["toques en el area rival", "toques en el área rival"], side);
    const fouls = metricFromStats(match?.stats, ["faltas", "fouls"], side);
    const yellows = metricFromStats(match?.stats, ["tarjetas amarillas", "yellow cards"], side);
    const tackles = metricFromStats(match?.stats, ["entradas", "tackles"], side);
    const duels = metricFromStats(match?.stats, ["duelos ganados", "duels won"], side);
    const interceptions = metricFromStats(match?.stats, ["intercepciones", "interceptions"], side);
    const narrativeEvents = match?.narrativeModule?.normalized?.events || [];
    const shockGoals = narrativeEvents.filter(evt=>evt?.type==="goal" && Number(evt?.min)>=70).length;
    const aggressionIndex = clamp(
      0.30 * clamp((Number(tackles) || 50) / 100, 0, 1) +
      0.20 * clamp((Number(duels) || 40) / 70, 0, 1) +
      0.16 * clamp((Number(interceptions) || 4) / 10, 0, 1) +
      0.20 * clamp((Number(fouls) || 8) / 16, 0, 1) +
      0.14 * clamp((Number(yellows) || 1) / 5, 0, 1),
      0,
      1
    );
    const shockIndex = clamp(
      0.35 * clamp(Number(narrativeLabels.transition_punished) || 0, 0, 1) +
      0.25 * clamp(Number(narrativeLabels.late_risk_exposure) || 0, 0, 1) +
      0.20 * clamp((Number(shockGoals) || 0) / 3, 0, 1) +
      0.20 * clamp((Number(oppXg) || 1.2) / 2.8, 0, 1),
      0,
      1
    );
    const psychLoad = clamp(
      0.36 * clamp(Number(narrativeLabels.control_without_conversion) || 0, 0, 1) +
      0.30 * clamp(Number(narrativeLabels.discipline_impact) || 0, 0, 1) +
      0.18 * aggressionIndex +
      0.16 * shockIndex,
      0,
      1
    );
    const confidence = clamp(
      0.35 * clamp((Number(ownXg) || 0.9) / 2.2, 0, 1) +
      0.25 * clamp((Number(ownXgot) || 1) / 2.5, 0, 1) +
      0.20 * clamp((Number(shotsOn) || 3) / 9, 0, 1) +
      0.20 * clamp((Number(touchesBox) || 14) / 45, 0, 1),
      0,
      1
    );
    const composure = clamp(0.62 - psychLoad * 0.34 + confidence * 0.24, 0, 1);
    const frustration = clamp(0.24 + psychLoad * 0.58 - confidence * 0.22, 0, 1);
    const tiltRisk = clamp(0.18 + psychLoad * 0.50 + aggressionIndex * 0.24 - composure * 0.26, 0, 1);
    return {
      avgIDD,
      lateIDD,
      threat: clamp(Number(threat) || 0.5, 0, 1),
      intensity: clamp(Number(intensityRaw) || 0.5, 0, 1),
      shockGoals,
      aggressionIndex,
      shockIndex,
      psychLoad,
      sterilePressure: clamp(Number(narrativeLabels.control_without_conversion) || 0.2, 0, 1),
      psych: {
        avgConfidence: confidence,
        avgComposure: composure,
        avgFrustration: frustration,
        avgTiltRisk: tiltRisk
      }
    };
  }

  function recomputeTeamGlobalEngine(db, teamId){
    const team = db.teams.find(t=>t.id===teamId);
    if(!team) return null;
    const profile = getOrCreateDiagProfile(db, teamId, team.name);
    const orderedMatches = db.tracker
      .filter(m=>(m.homeId===teamId || m.awayId===teamId) && m?.teamEngine?.[teamId])
      .sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
    const home = createHomeAwayBucket();
    const away = createHomeAwayBucket();
    const series = [];
    orderedMatches.forEach((match, idx)=>{
      const sample = match.teamEngine[teamId];
      const metrics = sample.metrics || {};
      const psych = metrics.psych || {};
      const pi = computePerformanceIndex(metrics);
      sample.pi = pi;
      const target = sample.isHome ? home : away;
      updateHomeAwayBucket(target, {
        pi,
        avgIDD: metrics.avgIDD,
        lateIDD: metrics.lateIDD,
        threat: metrics.threat,
        avgComposure: psych.avgComposure,
        avgTilt: psych.avgTiltRisk
      });
      const epa = clamp(Number(sample.epa) || 0.5, 0, 1);
      const ema = clamp(Number(sample.emaIntensity) || 0.5, 0, 1);
      const globalStrength = clamp(0.40*pi + 0.25*epa + 0.20*ema + 0.15*(1 - clamp(Number(psych.avgTiltRisk) || 0.5, 0, 1)), 0, 1);
      series.push({
        label: match.date || `M${idx+1}`,
        score: globalStrength,
        pi,
        epa,
        ema,
        aggression: clamp(Number(metrics.aggressionIndex) || 0.5, 0, 1),
        shock: clamp(Number(metrics.shockIndex) || 0.5, 0, 1),
        psychLoad: clamp(Number(metrics.psychLoad) || Number(psych.avgTiltRisk) || 0.5, 0, 1),
        isHome: sample.isHome
      });
    });
    const haTraits = computeHaTraits(home, away);
    const trend = series.slice(-5);
    const currentStrength = trend.length ? trend.reduce((sum, item)=>sum + item.score, 0) / trend.length : 0.5;
    profile.engineV1 = {
      version: "hae_epa_ema_v1",
      updatedAt: new Date().toISOString(),
      samples: series.length,
      currentStrength,
      homeAway: { home, away },
      haTraits,
      profile: {
        aggression: series.length ? series.reduce((sum, item)=>sum + item.aggression, 0) / series.length : 0.5,
        shock: series.length ? series.reduce((sum, item)=>sum + item.shock, 0) / series.length : 0.5,
        psychLoad: series.length ? series.reduce((sum, item)=>sum + item.psychLoad, 0) / series.length : 0.5
      },
      series
    };
    return profile.engineV1;
  }

  function renderTeamGlobalEngineChart(canvas, engine){
    if(!canvas || typeof Chart!=="function") return;
    if(canvas._chart){
      canvas._chart.destroy();
      canvas._chart = null;
    }
    const labels = (engine?.series || []).map(item=>item.label);
    const dataStrength = (engine?.series || []).map(item=>Math.round((item.score || 0) * 100));
    const dataEPA = (engine?.series || []).map(item=>Math.round((item.epa || 0) * 100));
    const dataEMA = (engine?.series || []).map(item=>Math.round((item.ema || 0) * 100));
    const dataAggression = (engine?.series || []).map(item=>Math.round((item.aggression || 0) * 100));
    const dataShock = (engine?.series || []).map(item=>Math.round((item.shock || 0) * 100));
    const dataPsychLoad = (engine?.series || []).map(item=>Math.round((item.psychLoad || 0) * 100));
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Fuerza global", data: dataStrength, borderColor: "#2ea043", backgroundColor: "rgba(46,160,67,.16)", tension: 0.25 },
          { label: "EPA", data: dataEPA, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.16)", tension: 0.25 },
          { label: "EMA psicológico", data: dataEMA, borderColor: "#d29922", backgroundColor: "rgba(210,153,34,.14)", tension: 0.25 },
          { label: "Agresividad", data: dataAggression, borderColor: "#ff7b72", backgroundColor: "rgba(255,123,114,.12)", tension: 0.2, borderDash: [5, 3] },
          { label: "Shock", data: dataShock, borderColor: "#a371f7", backgroundColor: "rgba(163,113,247,.14)", tension: 0.2, borderDash: [3, 3] },
          { label: "Carga psicológica", data: dataPsychLoad, borderColor: "#f2cc60", backgroundColor: "rgba(242,204,96,.10)", tension: 0.22 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        animation: { duration: 800, easing: "easeOutQuart" },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { min: 0, max: 100, ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } }
        }
      }
    });
  }


  function normalizeScoreToken(value = ""){
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function buildTeamPerspectiveScore(match = {}, teamId = ""){
    if(!teamId) return "";
    const hg = Number(match?.homeGoals);
    const ag = Number(match?.awayGoals);
    if(!Number.isFinite(hg) || !Number.isFinite(ag)) return "";
    if(match?.homeId===teamId) return `${hg}-${ag}`;
    if(match?.awayId===teamId) return `${ag}-${hg}`;
    return "";
  }

  function findBrainV2MatchForTracker({ brainV2 = null, match = {}, team = {} } = {}){
    const state = brainV2 || loadBrainV2();
    const teamId = String(team?.id || "").trim();
    if(!teamId) return null;
    const rows = Array.isArray(state?.memories?.[teamId]) ? state.memories[teamId] : [];
    if(!rows.length) return null;
    const targetDate = String(match?.date || "").trim();
    const targetScore = normalizeScoreToken(buildTeamPerspectiveScore(match, teamId));
    const byDate = targetDate ? rows.filter((row)=>String(row?.date || "").trim()===targetDate) : rows;
    if(!byDate.length) return null;
    if(targetScore){
      const exact = byDate.find((row)=>normalizeScoreToken(row?.score || "")===targetScore);
      if(exact) return exact;
    }
    return byDate[byDate.length - 1] || null;
  }

  function resolveRivalForTeamMatch({ db, match, team, brainV2 = null } = {}){
    const isHome = match?.homeId===team?.id;
    const isAway = match?.awayId===team?.id;
    const directRivalId = isHome ? match?.awayId : isAway ? match?.homeId : (match?.rivalTeamId || "");
    const rivalById = directRivalId ? db?.teams?.find((t)=>t.id===directRivalId) : null;
    if(rivalById) return { id: rivalById.id, name: rivalById.name };

    const fallbackNames = [
      match?.opponent,
      match?.opponentName,
      match?.rival,
      match?.rivalName,
      isHome ? match?.awayTeam : isAway ? match?.homeTeam : "",
      isHome ? match?.away : isAway ? match?.home : ""
    ].map((v)=>String(v || "").trim()).filter(Boolean);
    if(fallbackNames.length) return { id: "", name: fallbackNames[0] };

    const memoryRow = findBrainV2MatchForTracker({ brainV2, match, team });
    const memoryRival = String(memoryRow?.opponent || "").trim();
    if(memoryRival) return { id: "", name: memoryRival };

    return { id: "", name: "-" };
  }

  function openTeamEngineModal({ db, match, team, onSave, brainV2 = null } = {}){
    if(!match || !team) return;
    const linkedBrainV2 = brainV2 || loadBrainV2();
    const linkedMemoryMatch = findBrainV2MatchForTracker({ brainV2: linkedBrainV2, match, team });
    const inferred = inferEngineMetricsFromMatch(match, team.id);
    const prev = match?.teamEngine?.[team.id] || {};
    const metrics = prev.metrics || inferred;
    const psych = metrics.psych || inferred.psych;
    const epa = clamp(Number(prev.epa) || 0.5, 0, 1);
    const emaIntensity = clamp(Number(prev.emaIntensity) || 0.5, 0, 1);
    const existingNarrative = match?.narrativeModule?.rawText || linkedMemoryMatch?.narrative || "";
    const existingStatsJson = match?.stats?.length
      ? JSON.stringify({ stats: match.stats }, null, 2)
      : (linkedMemoryMatch?.statsRaw
        ? JSON.stringify(parseBrainV2StatsToStatsRaw(linkedMemoryMatch.statsRaw), null, 2)
        : "");
    const rival = resolveRivalForTeamMatch({ db, match, team, brainV2: linkedBrainV2 });
    const homeName = db.teams.find(t=>t.id===match.homeId)?.name || (match.homeId===team.id ? team.name : rival.name) || "Local";
    const awayName = db.teams.find(t=>t.id===match.awayId)?.name || (match.awayId===team.id ? team.name : rival.name) || "Visitante";
    const backdrop = document.createElement("div");
    backdrop.className = "fl-modal-backdrop";
    backdrop.innerHTML = `
      <div class="fl-modal" style="max-width:920px;max-height:90vh;overflow:auto;">
        <div class="fl-row" style="justify-content:space-between;align-items:center;">
          <div style="font-size:18px;font-weight:900;">EPA + EMA + Localía (${team.name})</div>
          <div class="fl-mini">Rival detectado: <b>${rival?.name || "-"}</b></div>
          <button class="fl-btn" id="closeEngineModal">Cerrar</button>
        </div>
        <div class="fl-card" style="margin-top:10px;">
          <div style="font-weight:800;margin-bottom:6px;">📋 Relato del partido</div>
          <textarea id="engNarrative" class="fl-text" placeholder="Pega el relato línea por línea con minutos.">${existingNarrative}</textarea>
        </div>
        <div class="fl-card" style="margin-top:10px;">
          <div style="font-weight:800;margin-bottom:6px;">📊 Estadísticas (JSON)</div>
          <textarea id="engStatsJson" class="fl-text" placeholder='{"stats":[{"key":"Posesión","home":"67%","away":"33%"}]}' style="min-height:160px;">${existingStatsJson}</textarea>
          <div class="fl-mini" style="margin-top:6px;">Si ya había datos, aquí los puedes ver y editar.</div>
        </div>
        <div class="fl-mini" style="margin-top:8px;">Las métricas del motor se recalculan desde el relato + estadísticas al guardar.</div>
        <div class="fl-grid two" style="margin-top:8px;">
          <label class="fl-mini">EPA (0-1)<input id="engEPA" class="fl-input" type="number" min="0" max="1" step="0.01" value="${epa}"></label>
          <label class="fl-mini">EMA intensidad velas (0-1)<input id="engEMA" class="fl-input" type="number" min="0" max="1" step="0.01" value="${emaIntensity}"></label>
        </div>
        <div class="fl-row" style="margin-top:10px;">
          <button class="fl-btn" id="saveEngineModal">Guardar en gráfico global</button>
          <span id="engineModalStatus" class="fl-muted"></span>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#closeEngineModal").onclick = ()=>backdrop.remove();
    backdrop.onclick = (ev)=>{ if(ev.target===backdrop) backdrop.remove(); };
    backdrop.querySelector("#saveEngineModal").onclick = ()=>{
      const status = backdrop.querySelector("#engineModalStatus");
      const narrativeRaw = backdrop.querySelector("#engNarrative").value.trim();
      const statsRaw = backdrop.querySelector("#engStatsJson").value.trim();
      if(narrativeRaw){
        const parsed = extractNarratedEvents(narrativeRaw, { home: homeName, away: awayName });
        const diagnostic = buildNarrativeDiagnostic({ match, teams: { home: homeName, away: awayName }, parsed });
        match.narrativeModule = {
          rawText: narrativeRaw,
          normalized: {
            matchId: match.id,
            teams: { home: homeName, away: awayName },
            events: parsed.events,
            counters: parsed.counters
          },
          diagnostic: { matchId: match.id, diagnostic }
        };
      }
      if(statsRaw){
        try{
          const rawObj = JSON.parse(statsRaw);
          match.statsRaw = rawObj;
          match.stats = parseStatsPayload(rawObj);
        }catch(err){
          status.textContent = `❌ ${String(err.message || err)}`;
          return;
        }
      }
      if(linkedMemoryMatch){
        if(narrativeRaw) linkedMemoryMatch.narrative = narrativeRaw;
        if(statsRaw) linkedMemoryMatch.statsRaw = statsRaw;
      }
      const inferredFresh = inferEngineMetricsFromMatch(match, team.id);
      const mergedPsych = {
        ...inferredFresh.psych,
        ...(psych || {})
      };
      const finalMetrics = {
        ...inferredFresh,
        ...metrics,
        ...inferredFresh,
        psych: mergedPsych
      };
      const payload = {
        team: team.name,
        isHome: match.homeId===team.id,
        epa: clamp(Number(backdrop.querySelector("#engEPA").value) || 0, 0, 1),
        emaIntensity: clamp(Number(backdrop.querySelector("#engEMA").value) || 0, 0, 1),
        metrics: finalMetrics,
        updatedAt: new Date().toISOString()
      };
      payload.pi = computePerformanceIndex(payload.metrics);
      match.teamEngine ||= {};
      match.teamEngine[team.id] = payload;
      recomputeTeamGlobalEngine(db, team.id);
      saveDb(db);
      if(linkedMemoryMatch){
        saveBrainV2(linkedBrainV2);
      }
      status.textContent = `✅ PI ${payload.pi.toFixed(3)} guardado y agregado al motor global.`;
      if(typeof onSave==="function") setTimeout(()=>{ backdrop.remove(); onSave(); }, 320);
    };
  }

  function simulateMatchV2(plan, rngSeed){
    const rng = createRng(rngSeed);
    const ht = plan.homeProfile.traits || {};
    const at = plan.awayProfile.traits || {};
    const attackH = 0.40*(ht.territorial_strength||0.5) + 0.35*(ht.chance_creation||0.5) + 0.25*(ht.finishing_quality||0.5);
    const attackA = 0.40*(at.territorial_strength||0.5) + 0.35*(at.chance_creation||0.5) + 0.25*(at.finishing_quality||0.5);
    const defenseH = 0.50*(ht.transition_defense||0.5) + 0.50*(ht.low_block_execution||0.5);
    const defenseA = 0.50*(at.transition_defense||0.5) + 0.50*(at.low_block_execution||0.5);
    const blocks = [];
    const allEvents = [];
    const score = { home: 0, away: 0 };
    let prevIdd = 0;
    for(let k=0;k<10;k++){
      const t0 = k*10;
      const t1 = k===9 ? 90 : (k+1)*10;
      const scoreDiff = score.home - score.away;
      const late = t0>=70;
      const state = scoreDiff<0 ? (late?0.15:0.08) : scoreDiff>0 ? -0.05 : 0;
      const noise = randn(rng) * ((Number(ht.discipline_risk)||0.5 + (Number(at.discipline_risk)||0.5))/2) * plan.rates.volatility;
      let style = 0;
      if(plan.matchup.styleClash.includes("home_transition_window")) style += 0.08;
      if(plan.matchup.styleClash.includes("away_transition_window")) style -= 0.08;
      if(plan.matchup.styleClash.includes("home_sterile_risk") && k>=3 && k<=7) style -= 0.06;
      if(plan.matchup.styleClash.includes("away_sterile_risk") && k>=3 && k<=7) style += 0.06;
      const base = (attackH-defenseA) - (attackA-defenseH)*0.65 + plan.context.homeAdv*0.4;
      const iddHome = clamp(0.55*prevIdd + 0.45*(base + style + state + noise), -1, 1);
      const iddAway = -iddHome;
      const events = [];
      const goalH = plan.rates.baseGoalRatePerBlock * (1 + 0.9*Math.max(0, iddHome)) * (ht.finishing_quality||0.5) * (1-defenseA*0.75);
      const goalA = plan.rates.baseGoalRatePerBlock * (1 + 0.9*Math.max(0, iddAway)) * (at.finishing_quality||0.5) * (1-defenseH*0.75);
      const shockH = 0.08*(ht.transition_attack||0.5)*Math.max(0,-iddHome)*(1-(at.transition_defense||0.5));
      const shockA = 0.08*(at.transition_attack||0.5)*Math.max(0,-iddAway)*(1-(ht.transition_defense||0.5));
      if(rng() < goalH + shockH){ score.home += 1; events.push({type:"goal", team:"home", min:t0+Math.floor(rng()*10), shock:rng() < shockH/(goalH+shockH+1e-6)}); }
      if(rng() < goalA + shockA){ score.away += 1; events.push({type:"goal", team:"away", min:t0+Math.floor(rng()*10), shock:rng() < shockA/(goalA+shockA+1e-6)}); }
      const cardH = 0.05 + (ht.discipline_risk||0.5)*0.2 + (iddHome<-0.3 ? 0.08 : 0);
      const cardA = 0.05 + (at.discipline_risk||0.5)*0.2 + (iddAway<-0.3 ? 0.08 : 0);
      if(rng()<cardH) events.push({type:"yellow", team:"home", min:t0+Math.floor(rng()*10)});
      if(rng()<cardA) events.push({type:"yellow", team:"away", min:t0+Math.floor(rng()*10)});
      allEvents.push(...events);
      blocks.push({ t0, t1, iddHome, iddAway, events });
      prevIdd = iddHome;
    }
    const candlesHome = generateCandlesFromBlocks(blocks, "home");
    const candlesAway = generateCandlesFromBlocks(blocks, "away");
    const diagnostic = generateDiagnosis(candlesHome, allEvents);
    return { score, blocks, candlesHome, candlesAway, diagnostic };
  }

  function parseMinuteToken(raw){
    const txt = String(raw || "").trim();
    const plus = txt.match(/(\d+)\s*\+\s*(\d+)\s*'?/);
    if(plus) return Number(plus[1]) + Number(plus[2]);
    const simple = txt.match(/(\d{1,3})\s*'?/);
    return simple ? Number(simple[1]) : null;
  }

  function normalizeTeamToken(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  const LIVE_MICRO_RULES = [
    { key: "goal", regex: /\bgol\b|anota|marca/i, weight: 5 },
    { key: "shot_on_target", regex: /parada|guantes|atajad|salvad|portero|disparo a puerta|remate a puerta/i, weight: 3.3 },
    { key: "miss", regex: /fuera|por encima|desviad|poste|larguero|travesa[ñn]o/i, weight: 2.1 },
    { key: "big_chance", regex: /gran ocasi[oó]n|que oportunidad|qu[ée] oportunidad|cerca|ocasi[oó]n clar[ií]sima|mano a mano/i, weight: 3.8 },
    { key: "shot", regex: /dispara|remata|cabezazo|chut|disparo|tiro/i, weight: 2.2 },
    { key: "corner", regex: /c[oó]rner/i, weight: 1.5 },
    { key: "freekick", regex: /tiro libre|falta peligrosa/i, weight: 1.3 },
    { key: "setpiece_cross", regex: /centro de tiro libre/i, weight: 1.3 },
    { key: "possession_control", regex: /controla la posesi[oó]n|intercambiando pases/i, weight: 1.1 },
    { key: "foul", regex: /falta|infracci[oó]n/i, weight: 0.8 },
    { key: "yellow", regex: /tarjeta amarilla|\bamarilla\b|amonestad/i, weight: 1.1 },
    { key: "red", regex: /tarjeta roja|\broja\b|expulsad/i, weight: 2.7 },
    { key: "penalty_awarded", regex: /penalti|penalty|pena m[aá]xima/i, weight: 2.5 },
    { key: "var_review", regex: /\bvar\b/i, weight: 1.6 },
    { key: "penalty_cancelled", regex: /revierte|no hubo infracci[oó]n|anulad[oa]\s+por\s+var/i, weight: 2.3 },
    { key: "var_overturn", regex: /revierte|no hubo infracci[oó]n|anulad[oa]\s+por\s+var/i, weight: 2.3 },
    { key: "substitution", regex: /sustituci[oó]n|cambio/i, weight: 0.6 },
    { key: "injury", regex: /lesi[oó]n|no puede continuar|abandona lesionado|se duele/i, weight: 2.1 }
  ];

  function phaseOf(min){
    const minute = Number(min);
    if(!Number.isFinite(minute) || minute < 15) return "0-15";
    if(minute < 30) return "15-30";
    if(minute < 45) return "30-45";
    if(minute < 60) return "45-60";
    if(minute < 75) return "60-75";
    return "75-90";
  }

  function detectTeam(line="", teamHints=[]){
    const hints = (Array.isArray(teamHints) ? teamHints : []).filter(Boolean);
    if(!hints.length) return null;
    const lineNorm = normalizeTeamToken(line);
    const map = hints.map((name)=>({ name, token: normalizeTeamToken(name) })).filter((row)=>row.token);
    return map.find((row)=>lineNorm.includes(row.token))?.name || null;
  }

  function classifyMicroEvents(line=""){
    const txt = String(line || "");
    const found = LIVE_MICRO_RULES.filter((row)=>row.regex.test(txt)).map((row)=>row.key);
    if(found.includes("shot_on_target") && !found.includes("shot")) found.push("shot");
    return [...new Set(found)];
  }

  function parseNarrativeLines(text, teamHints=[]){
    const lines = String(text || "").split(/\n+/).map((line)=>line.trim()).filter(Boolean);
    const events = [];
    let pendingMinute = null;
    lines.forEach((line)=>{
      const minuteFound = line.match(/(\d{1,3}\s*\+\s*\d{1,2}|\d{1,3})\s*'/);
      if(minuteFound) pendingMinute = parseMinuteToken(minuteFound[1]);
      const minute = Number.isFinite(Number(pendingMinute)) ? Number(pendingMinute) : null;
      if(minute === null) return;
      const micro = classifyMicroEvents(line);
      if(!micro.length) return;
      const team = detectTeam(line, teamHints);
      const weight = micro.reduce((acc, key)=>acc + (Number(LIVE_MICRO_RULES.find((row)=>row.key===key)?.weight) || 0), 0);
      events.push({
        min: minute,
        team,
        micro,
        weight: Number(weight.toFixed(2)),
        phase: phaseOf(minute),
        raw: line
      });
    });
    return events;
  }

  function dangerIndex(counters={}){
    const shotsOT = Number(counters?.shotsOT || 0);
    const bigChances = Number(counters?.bigChances || 0);
    const shots = Number(counters?.shots || 0);
    const corners = Number(counters?.corners || 0);
    const cards = Number(counters?.cards || 0);
    return Number((1.2*shotsOT + 0.7*bigChances + 0.35*shots + 0.25*corners - 0.6*cards).toFixed(3));
  }

  function createLiveCounters(){
    return { shots: 0, shotsOT: 0, bigChances: 0, corners: 0, danger: 0, cards: 0, reds: 0, varShocks: 0, injuryEvents: 0, goals: 0 };
  }

  function accumulateCounters(events=[], teams=[]){
    const phaseKeys = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90"];
    const pair = (Array.isArray(teams) ? teams : []).filter(Boolean);
    const [homeName="home", awayName="away"] = pair;
    const byPhaseCounters = Object.fromEntries(phaseKeys.map((key)=>[key, { [homeName]: createLiveCounters(), [awayName]: createLiveCounters() }]));
    const totals = { [homeName]: createLiveCounters(), [awayName]: createLiveCounters() };
    const register = (bucket, micro=[])=>{
      if(micro.includes("shot")) bucket.shots += 1;
      if(micro.includes("shot_on_target")) bucket.shotsOT += 1;
      if(micro.includes("big_chance")) bucket.bigChances += 1;
      if(micro.includes("corner")) bucket.corners += 1;
      if(micro.includes("goal")) bucket.goals += 1;
      if(micro.includes("yellow")) bucket.cards += 1;
      if(micro.includes("red")){
        bucket.cards += 1;
        bucket.reds += 1;
      }
      if(micro.includes("penalty_cancelled") || micro.includes("var_overturn")) bucket.varShocks += 1;
      if(micro.includes("injury")) bucket.injuryEvents += 1;
      bucket.danger = dangerIndex(bucket);
    };
    (Array.isArray(events) ? events : []).forEach((event)=>{
      const side = event?.team === awayName ? awayName : homeName;
      const phase = phaseKeys.includes(event?.phase) ? event.phase : phaseOf(event?.min);
      register(byPhaseCounters[phase][side], event?.micro || []);
      register(totals[side], event?.micro || []);
    });
    return { byPhaseCounters, totals };
  }

  function detectTurningPoints(events=[], teams=[]){
    const safe = (Array.isArray(events) ? events : []).slice().sort((a,b)=>(Number(a?.min)||0) - (Number(b?.min)||0));
    const [homeName="home", awayName="away"] = (Array.isArray(teams) ? teams : []).filter(Boolean);
    const points = [];
    for(let i=0;i<safe.length;i++){
      const event = safe[i];
      const micro = event?.micro || [];
      if(micro.includes("penalty_awarded")){
        const cancel = safe.slice(i+1, i+7).find((row)=>{
          const dt = Math.abs((Number(row?.min)||0) - (Number(event?.min)||0));
          return dt <= 3 && (row?.micro || []).some((m)=>m === "penalty_cancelled" || m === "var_overturn");
        });
        if(cancel){
          const affected = event?.team || null;
          const rival = affected === homeName ? awayName : homeName;
          const pivotMin = Number(cancel.min) || Number(event.min) || 0;
          points.push({
            type: "turning_point_var",
            impact: "very_high",
            min: pivotMin,
            affectedTeam: affected,
            rivalTeam: rival,
            impactWindow: [pivotMin, pivotMin + 10],
            effects: { discipline_issues_risk: 0.12, counter_threat_rival: 0.15, frustration_boost: 0.14 }
          });
          points.push({
            type: "momentum_shift",
            min: pivotMin,
            towards: rival,
            causedBy: "turning_point_var",
            impactWindow: [pivotMin, pivotMin + 10]
          });
          points.push({
            type: "counter_strike_risk",
            min: pivotMin,
            team: rival,
            causedBy: "turning_point_var",
            impactWindow: [pivotMin, pivotMin + 10],
            boost: 0.15
          });
        }
      }
      if(micro.includes("goal")){
        points.push({
          type: "turning_point_goal",
          impact: "high",
          min: Number(event.min) || 0,
          scorer: event?.team || null,
          effects: { trailing_late_siege: 0.18, winner_low_block: 0.12 }
        });
      }
      if(micro.includes("red")){
        points.push({ type: "turning_point_red", impact: "very_high", min: Number(event.min) || 0, team: event?.team || null });
      }
      if(micro.includes("injury")){
        points.push({ type: "turning_point_injury", impact: "medium", min: Number(event.min) || 0, team: event?.team || null });
      }
    }
    return points;
  }

  function parseMatchNarrative(text, teamHints=[]){
    const teams = Array.isArray(teamHints) ? teamHints.filter(Boolean) : [];
    const liveSnapshot = parseNarrativeLines(text, teams);
    const events = liveSnapshot.map((event)=>{
      const micro = Array.isArray(event.micro) ? event.micro : [];
      const mapPrimary = micro.includes("goal") ? "goal"
        : micro.includes("corner") ? "corner"
          : micro.includes("big_chance") ? "big_chance"
            : micro.includes("shot") ? "shot"
              : micro.includes("shot_on_target") ? "save"
                : micro.includes("yellow") ? "yellow"
                  : micro.includes("red") ? "red"
                    : micro.includes("foul") ? "foul"
                      : micro.includes("possession_control") ? "pressure"
                        : micro[0] || "event";
      return { min: event.min, type: mapPrimary, team: event.team, text: event.raw, micro, phase: event.phase, weight: event.weight };
    });
    const counters = accumulateCounters(liveSnapshot, teams);
    const turningPoints = detectTurningPoints(liveSnapshot, teams);
    return { teams, events, liveSnapshot, byPhaseCounters: counters.byPhaseCounters, liveTotals: counters.totals, turningPoints };
  }

  function generateNarrative(preMatchPrior={}, byPhaseCounters={}, turningPoints=[], clashes=[]){
    const phases = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90"];
    const phaseCards = phases.map((phase)=>{
      const counter = byPhaseCounters?.[phase] || {};
      const [homeKey, awayKey] = Object.keys(counter);
      const home = counter?.[homeKey] || createLiveCounters();
      const away = counter?.[awayKey] || createLiveCounters();
      const totalShots = Number(home.shots || 0) + Number(away.shots || 0);
      const totalCorners = Number(home.corners || 0) + Number(away.corners || 0);
      const totalBig = Number(home.bigChances || 0) + Number(away.bigChances || 0);
      const totalCards = Number(home.cards || 0) + Number(away.cards || 0);
      const eventsDetected = totalShots + totalCorners + totalBig + totalCards;
      const earlyDangerDiff = Math.abs(Number(home.danger || 0) - Number(away.danger || 0));
      const scenes = [];

      if((phase === "0-15" || phase === "15-30") && earlyDangerDiff < 1.2){
        scenes.push({ id: "balanced_start", text: "Inicio equilibrado: ambos equipos prueban sin dominio claro.", evidence: 0.9 });
      }else if((phase === "0-15" || phase === "15-30") && totalShots <= 4 && totalCorners <= 2){
        scenes.push({ id: "chess_match", text: "Partido táctico, pocas ocasiones claras…", evidence: 0.75 });
      }

      if(Number(home.corners || 0) >= 2 || Number(away.corners || 0) >= 2) scenes.push({ id: "setpiece_build", text: "Empieza a cargar el balón parado…", evidence: 0.75 });
      if((Number(home.bigChances || 0) >= 2 && Number(home.goals || 0) === 0) || (Number(away.bigChances || 0) >= 2 && Number(away.goals || 0) === 0)) scenes.push({ id: "frustration_spiral", text: "Se acumula frustración: el plan genera, pero no rompe…", evidence: 0.7 });
      if(turningPoints.some((tp)=>tp.type === "turning_point_goal" && phaseOf(tp.min) === phase)) scenes.push({ id: "counter_punch", text: "Gol que castiga un momento de dominio…", evidence: 0.72 });

      const varPivotInPhase = turningPoints.some((tp)=>tp.type === "turning_point_var" && phaseOf(tp.min) === phase);
      const momentumShiftInPhase = turningPoints.some((tp)=>tp.type === "momentum_shift" && phaseOf(tp.min) === phase);
      if(varPivotInPhase || momentumShiftInPhase){
        scenes.push({ id: "var_turning_point", text: "Turning point VAR: el penalti anulado cambió el momentum.", evidence: 0.92 });
      }

      if(phase === "75-90" && (totalCorners >= 2 || totalShots >= 3)) scenes.push({ id: "late_siege", text: "Asedio final…", evidence: 0.82 });

      const sorted = scenes.sort((a,b)=>b.evidence-a.evidence).slice(0, 2);
      const evidenceComponents = [
        clamp(totalShots / 4, 0, 1),
        clamp(totalCorners / 3, 0, 1),
        clamp(totalBig / 2, 0, 1),
        clamp(totalCards / 2, 0, 1),
        clamp(eventsDetected / 8, 0, 1),
        sorted.length ? sorted[0].evidence : 0
      ];
      const evidenceScore = evidenceComponents.reduce((acc, v)=>acc + v, 0) / evidenceComponents.length;
      const prior = Number(preMatchPrior?.[phase] || 0.45);
      const confidence = clamp(0.5*prior + 0.5*evidenceScore, 0.08, 0.95);
      const conditional = evidenceScore < 0.35;
      return {
        phase,
        scenes: sorted.map((item)=>item.id),
        text: (sorted[0]?.text || "Podría aparecer un cambio táctico si continúa esta tendencia.") + (conditional ? " Podría romperse si continúa esta tendencia." : ""),
        matchState: home.danger > (1.25*away.danger)
          ? "CONTROL_HOME"
          : away.danger > (1.25*home.danger)
            ? "CONTROL_AWAY"
            : "EVEN/CHESS",
        chaos: Number(home.varShocks || 0) + Number(away.varShocks || 0) + Number(home.reds || 0) + Number(away.reds || 0) + Number(home.injuryEvents || 0) + Number(away.injuryEvents || 0) > 0,
        evidenceScore: Number(evidenceScore.toFixed(2)),
        confidence: Number(confidence.toFixed(2)),
        clashes
      };
    });
    return phaseCards;
  }

  function liveUpdate(newLine="", state={}){
    const teams = Array.isArray(state?.teams) ? state.teams : [];
    const prev = Array.isArray(state?.events) ? state.events : [];
    const incoming = parseNarrativeLines(newLine, teams);
    const events = [...prev, ...incoming].sort((a,b)=>(Number(a?.min)||0) - (Number(b?.min)||0));
    const counters = accumulateCounters(events, teams);
    const turningPoints = detectTurningPoints(events, teams);
    const phaseCards = generateNarrative(state?.preMatchPrior || {}, counters.byPhaseCounters, turningPoints, state?.clashes || []);
    return { ...state, events, byPhaseCounters: counters.byPhaseCounters, liveTotals: counters.totals, turningPoints, phaseCards };
  }

  function buildEventTimeline(events=[]){
    return [...events]
      .map((evt, idx)=>({ ...evt, min: Number.isFinite(Number(evt.min)) ? Number(evt.min) : 0, idx }))
      .sort((a,b)=>a.min===b.min ? a.idx-b.idx : a.min-b.min)
      .map(({ idx, ...evt })=>evt);
  }

  function blockFromMinute(minute){
    const safeMinute = Number.isFinite(Number(minute)) ? Number(minute) : 0;
    if(safeMinute >= 90) return 9;
    return clamp(Math.floor(safeMinute / 10), 0, 8);
  }

  function createBlockStats(){
    return {
      shots: 0,
      big_chances: 0,
      corners: 0,
      goals: 0,
      goals_conceded: 0,
      saves_forced: 0,
      cards: 0,
      fouls: 0,
      pressure_mentions: 0,
      idd: 0,
      idd_normalized: 0
    };
  }

  function computeMomentumBlocks(events=[], teams=[]){
    const timeline = buildEventTimeline(events);
    const [homeTeam, awayTeam] = teams;
    const blocks = Array.from({ length: 10 }, (_v, idx)=>({
      block: idx,
      range: idx < 9 ? `${idx*10}-${(idx+1)*10}` : "90+",
      teams: {
        [homeTeam || "home"]: createBlockStats(),
        [awayTeam || "away"]: createBlockStats()
      },
      idd: {}
    }));
    const statMap = {
      shot: "shots",
      big_chance: "big_chances",
      corner: "corners",
      goal: "goals",
      foul: "fouls",
      yellow: "cards",
      red: "cards",
      pressure: "pressure_mentions"
    };

    timeline.forEach((event)=>{
      const blk = blocks[blockFromMinute(event.min)];
      const side = event.team === awayTeam ? awayTeam : homeTeam;
      const otherSide = side === homeTeam ? awayTeam : homeTeam;
      const key = statMap[event.type];
      if(key && blk.teams[side]) blk.teams[side][key] += 1;
      if(event.type === "save" && blk.teams[otherSide]) blk.teams[otherSide].saves_forced += 1;
      if(event.type === "goal" && blk.teams[otherSide]) blk.teams[otherSide].goals_conceded += 1;
    });

    blocks.forEach((block)=>{
      [homeTeam, awayTeam].forEach(team=>{
        const stats = block.teams[team];
        const idd =
          0.5 * stats.big_chances +
          0.4 * stats.shots +
          0.3 * stats.corners +
          0.2 * stats.pressure_mentions -
          0.6 * stats.goals_conceded -
          0.2 * stats.cards;
        stats.idd = idd;
        stats.idd_normalized = clamp(idd / 5, -1, 1);
        block.idd[team] = stats.idd_normalized;
      });
    });

    return blocks;
  }

  function generateCandles(blocks=[], team=""){
    let prev = 0;
    return blocks.map((block)=>{
      const close = Number(block.idd?.[team]) || 0;
      const open = prev;
      const high = Math.max(open, close);
      const low = Math.min(open, close);
      prev = close;
      return { block: block.block, label: block.range || (block.block===9?"90+":`${block.block*10}-${(block.block+1)*10}`), open, high, low, close };
    });
  }

  function cumulativeSum(series=[]){
    let acc = 0;
    return series.map((value)=>{
      acc += Number(value) || 0;
      return acc;
    });
  }

  function stdDev(series=[]){
    if(!series.length) return 0;
    const mean = series.reduce((sum, value)=>sum + (Number(value) || 0), 0) / series.length;
    const variance = series.reduce((sum, value)=>{
      const n = Number(value) || 0;
      return sum + (n-mean)*(n-mean);
    }, 0) / series.length;
    return Math.sqrt(variance);
  }

  function countSignChanges(series=[]){
    let prev = 0;
    return series.reduce((count, value)=>{
      const sign = (Number(value) || 0) > 0 ? 1 : ((Number(value) || 0) < 0 ? -1 : 0);
      if(sign===0) return count;
      if(prev!==0 && sign!==prev) count += 1;
      prev = sign;
      return count;
    }, 0);
  }

  function maxConsecutiveBy(series=[], predicate=()=>false){
    let curr = 0;
    let max = 0;
    series.forEach((value)=>{
      if(predicate(Number(value) || 0)){
        curr += 1;
        if(curr > max) max = curr;
      }else{
        curr = 0;
      }
    });
    return max;
  }

  function computeMomentumDiagnostic(candles=[]){
    const iddSeries = candles.map(c=>Number(c.close) || 0);
    const iddAccum = cumulativeSum(iddSeries);
    const deltas = iddAccum.slice(1).map((value, idx)=>value - iddAccum[idx]);
    const maxDeltaAbs = deltas.reduce((best, value)=>Math.max(best, Math.abs(value)), 0);
    const breakDeltaIdx = deltas.reduce((bestIdx, value, idx)=>(
      Math.abs(value) > Math.abs(deltas[bestIdx] || 0) ? idx : bestIdx
    ), 0);
    const breakIdx = deltas.length ? breakDeltaIdx + 1 : 0;
    const breakLabel = candles[breakIdx]?.label || candles[0]?.label || "-";
    const breakDelta = deltas[breakDeltaIdx] || 0;
    const vol = stdDev(iddSeries);
    const trend = (iddAccum.at(-1) || 0) - (iddAccum[0] || 0);
    const lateStrength = iddSeries.length ? (iddSeries.slice(-2).reduce((sum,v)=>sum+v,0) / Math.max(1, iddSeries.slice(-2).length)) : 0;
    const switches = countSignChanges(iddSeries);
    const greenStreakMax = maxConsecutiveBy(iddSeries, v=>v > 0.15);
    const redStreakMax = maxConsecutiveBy(iddSeries, v=>v < -0.15);
    const secondPhaseBreak = ["50-60", "60-70"].includes(breakLabel) && breakDelta < -0.2;
    const equilibrium = Math.abs(trend) < 0.2 && vol < 0.25;
    const dominantNoClose = trend > 0.2 && lateStrength < 0;
    const oscillation = switches >= 4;
    const lateWeakness = lateStrength < -0.2 || (iddSeries.at(-1) || 0) < -0.25;

    const tagScores = {
      equilibrium: clamp(1 - (Math.abs(trend)/0.2 + vol/0.25)/2, 0, 1),
      no_close: dominantNoClose ? clamp((trend/0.8) + Math.max(0, -lateStrength/0.5), 0, 1) : 0,
      second_phase_break: secondPhaseBreak ? clamp(Math.abs(breakDelta)/Math.max(0.01, maxDeltaAbs), 0, 1) : 0,
      oscillation: clamp(switches/6, 0, 1),
      late_weakness: clamp(Math.max(0, -lateStrength)/0.4, 0, 1)
    };

    const tags = [];
    if(equilibrium) tags.push("equilibrado_estable");
    if(dominantNoClose) tags.push("domino_sin_cierre");
    if(secondPhaseBreak) tags.push("second_phase_break");
    if(oscillation) tags.push("oscillation");
    if(lateWeakness) tags.push("late_weakness");

    const diagnosticText = [];
    if(Math.abs(trend) < 0.2) diagnosticText.push("Partido de equilibrio con fases alternadas.");
    else if(trend > 0.2) diagnosticText.push("Equipo A tuvo ventaja territorial global.");
    else diagnosticText.push("Equipo A fue superado en el global del desarrollo.");
    diagnosticText.push(`Quiebre principal: ${breakLabel} (cambio fuerte de momentum).`);
    diagnosticText.push(`Volatilidad: ${vol > 0.35 ? "alta" : (vol > 0.2 ? "media" : "baja")}.`);
    diagnosticText.push(`Final: ${lateStrength > 0.2 ? "fuerte" : (lateStrength < -0.2 ? "débil" : "neutral")}.`);

    if(oscillation) diagnosticText.push("Patrón: vaivén (alternancias frecuentes).");
    else if(secondPhaseBreak && lateWeakness) diagnosticText.push("Patrón: ruptura y caída final.");
    else if(greenStreakMax >= 2 && lateStrength < 0) diagnosticText.push("Patrón: acumulación estéril.");

    return {
      metrics: {
        vol,
        trend,
        breakLabel,
        breakDelta,
        lateStrength,
        switches,
        greenStreakMax,
        redStreakMax
      },
      tagScores,
      tags,
      iddSeries,
      iddAccum,
      diagnosticText
    };
  }

  function detectPatterns({ candles=[], blocks=[], team="", opponent="" }){
    const detected = [];
    let greenStreak = 0;
    let streakGoals = 0;
    candles.forEach((candle, idx)=>{
      if(candle.close > candle.open){
        greenStreak += 1;
        streakGoals += Number(blocks[idx]?.teams?.[team]?.goals || 0);
      }else{
        if(greenStreak >= 2 && streakGoals === 0) detected.push({ type: "accumulation_without_conversion", block: idx-1 });
        greenStreak = 0;
        streakGoals = 0;
      }
      if(candle.close > 0.4 && Number(blocks[idx+1]?.teams?.[opponent]?.goals || 0) > 0){
        detected.push({ type: "shock_transition", block: idx+1 });
      }
      if(candle.close < -0.3 && Number(blocks[idx]?.teams?.[team]?.saves_forced || 0) >= 2 && Number(blocks[idx]?.teams?.[team]?.goals_conceded || 0)===0){
        detected.push({ type: "low_block_success", block: idx });
      }
    });
    if(greenStreak >= 2 && streakGoals === 0) detected.push({ type: "accumulation_without_conversion", block: candles.length-1 });
    for(let i=3;i<candles.length;i++){
      const prev2 = candles[i-3].close > 0.2 && candles[i-2].close > 0.2;
      const next2 = candles[i-1].close < -0.2 && candles[i].close < -0.2;
      if(prev2 && next2) detected.push({ type: "reversion", block: i });
    }
    const pre70 = candles.slice(0,7).some(c=>c.close > 0.45);
    const post70Drop = candles.slice(7).some(c=>c.close < -0.25);
    const rivalLateGoal = blocks.slice(8).some(b=>Number(b.teams?.[opponent]?.goals || 0) > 0);
    if(pre70 && post70Drop && rivalLateGoal) detected.push({ type: "late_collapse", block: 8 });
    return detected;
  }

  function computeMomentumSignature(team, blocks=[], events=[]){
    const iddSeries = blocks.map(block=>Number(block.idd?.[team]) || 0);
    const avg_IDD = iddSeries.reduce((sum, v)=>sum+v, 0) / Math.max(1, iddSeries.length);
    const variance = iddSeries.reduce((sum, v)=>sum + (v-avg_IDD)*(v-avg_IDD), 0) / Math.max(1, iddSeries.length);
    const volatility = Math.sqrt(variance);
    const lateBlocks = blocks.filter(block=>block.block>=7);
    const late_strength = lateBlocks.reduce((sum, block)=>sum + (Number(block.idd?.[team]) || 0), 0) / Math.max(1, lateBlocks.length);
    const totals = blocks.reduce((acc, block)=>{
      const st = block.teams?.[team] || createBlockStats();
      acc.goals += Number(st.goals) || 0;
      acc.big_chances += Number(st.big_chances) || 0;
      acc.shots += Number(st.shots) || 0;
      return acc;
    }, { goals: 0, big_chances: 0, shots: 0 });
    const conversion_efficiency = clamp(totals.goals / Math.max(0.25, totals.big_chances + totals.shots*0.5), 0, 2);
    const teamGoals = events.filter(evt=>evt.type==="goal" && evt.team===team);
    const shockGoalsCount = teamGoals.filter(evt=>{
      const block = blocks[blockFromMinute(evt.min)];
      return Number(block?.idd?.[team]) < 0;
    }).length;
    const shock_goals = teamGoals.length ? shockGoalsCount / teamGoals.length : 0;
    const lowBlockSamples = blocks.filter(block=>Number(block.idd?.[team]) < -0.2);
    const lowBlockRes = lowBlockSamples.length
      ? lowBlockSamples.filter(block=>Number(block.teams?.[team]?.goals_conceded || 0)===0).length / lowBlockSamples.length
      : 0.5;

    return {
      team,
      momentumSignature: {
        avg_IDD,
        volatility,
        late_strength,
        conversion_efficiency,
        shock_goals,
        low_block_resistance: lowBlockRes
      }
    };
  }

  function signatureToPowers(signature){
    const s = signature || {};
    const attack_power =
      0.4*(Number(s.avg_IDD) || 0) +
      0.3*(Number(s.conversion_efficiency) || 0) +
      0.3*(Number(s.late_strength) || 0);
    const defense_power =
      0.5*(1 - clamp(Number(s.volatility) || 0, 0, 1)) +
      0.5*(Number(s.low_block_resistance) || 0.5);
    return { attack_power: clamp(attack_power, 0, 1.5), defense_power: clamp(defense_power, 0, 1.2) };
  }

  function updateTeamProfile(teamProfile, diagnostic){
    const current = teamProfile?.momentumSignature || null;
    const next = diagnostic?.momentumSignature || {};
    const alpha = current ? 0.25 : 1;
    const blend = (key, fallback=0)=>{
      const currV = Number(current?.[key]);
      const nextV = Number(next?.[key]);
      if(!Number.isFinite(nextV)) return Number.isFinite(currV) ? currV : fallback;
      if(!Number.isFinite(currV)) return nextV;
      return currV*(1-alpha) + nextV*alpha;
    };
    const momentumSignature = {
      avg_IDD: blend("avg_IDD", 0),
      volatility: blend("volatility", 0.5),
      late_strength: blend("late_strength", 0),
      conversion_efficiency: blend("conversion_efficiency", 0.5),
      shock_goals: blend("shock_goals", 0.3),
      low_block_resistance: blend("low_block_resistance", 0.5)
    };
    return {
      team: diagnostic?.team || teamProfile?.team || "",
      version: "momentumSignature_v1",
      samples: (Number(teamProfile?.samples) || 0) + 1,
      updatedAt: new Date().toISOString(),
      momentumSignature,
      simulation: signatureToPowers(momentumSignature)
    };
  }

  function createEarlyTeamStats(){
    return {
      shots: 0,
      shotsOnTarget: 0,
      bigChances: 0,
      goals: 0,
      corners: 0,
      dangerCross: 0,
      dangerActions: 0,
      finalThird: 0,
      interceptions: 0,
      savesForced: 0,
      controlMentions: 0,
      lossMentions: 0,
      fouls: 0,
      cards: 0,
      redCards: 0,
      penalties: 0,
      posts: 0,
      injuries: 0,
      possessionHints: 0
    };
  }

  function detectEarlyType(line=""){
    if(/\bgol\b|anota|marca\s+el\s+\d+-\d+|empata|pone el|adelanta/i.test(line)) return "goal";
    if(/tarjeta roja|\broja\b|expulsad/i.test(line)) return "redCard";
    if(/penal(?:ti)?|pena m[aá]xima/i.test(line)) return "penalty";
    if(/al poste|al larguero|al travesa[nñ]o|estrella(?:\s+el)?\s+bal[oó]n\s+en\s+el\s+poste/i.test(line)) return "post";
    if(/ocasi[oó]n clar[ií]sima|casi marca|mano a mano|\bsolo\b|punto de penalti|gran oportunidad/i.test(line)) return "bigChance";
    if(/disparo a puerta|remate a puerta|atajada obligada|forz[ao]\s+al\s+portero|tiro al arco/i.test(line)) return "shotOnTarget";
    if(/dispara|remata|cabezazo|\btiro\b|disparo|chut/i.test(line)) return "shot";
    if(/c[oó]rner/i.test(line)) return "corner";
    if(/centro peligroso|cuelga al [aá]rea/i.test(line)) return "dangerCross";
    if(/dentro del [aá]rea|borde del [aá]rea|[aá]rea peque[nñ]a/i.test(line)) return "finalThird";
    if(/interceptado|despejado|rechaza/i.test(line)) return "interception";
    if(/parada|interviene|ataj|en los guantes/i.test(line)) return "save";
    if(/domina la posesi[oó]n|intercambian pases|combina/i.test(line)) return "control";
    if(/posesi[oó]n\s+\d{1,3}%|tiene\s+la\s+pelota|controla\s+el\s+bal[oó]n/i.test(line)) return "possessionHint";
    if(/pierde la posesi[oó]n|error|bal[oó]n sale/i.test(line)) return "loss";
    if(/presi[oó]n|asedia|encierra|acoso|insiste/i.test(line)) return "dangerAction";
    if(/falta|entrada|infracci[oó]n/i.test(line)) return "foul";
    if(/tarjeta amarilla|\bamarilla\b/i.test(line)) return "card";
    if(/lesi[oó]n|se duele|molestias|abandona lesionado/i.test(line)) return "injury";
    return null;
  }

  function resolveEarlyWindow(windowKey="0-10"){
    const token = String(windowKey || "0-10").trim();
    const pair = token.match(/(\d{1,3})\s*-\s*(\d{1,3})/);
    if(pair){
      const start = Number(pair[1]);
      const end = Number(pair[2]);
      if(Number.isFinite(start) && Number.isFinite(end) && end > start){
        return { start, end, label: `${start}-${end}` };
      }
    }
    const end = Number(token);
    if(Number.isFinite(end) && end > 0) return { start: 0, end, label: `0-${end}` };
    return { start: 0, end: 10, label: "0-10" };
  }

  function parseEarlyNarrative(text, { teamA="", teamB="", windowKey="0-10" }={}){
    const windowRange = resolveEarlyWindow(windowKey);
    const lines = String(text || "").split(/\n+/).map(line=>line.trim()).filter(Boolean);
    const teams = [teamA, teamB].filter(Boolean);
    const statsByTeam = new Map();
    const pushTeam = (name)=>{
      if(!name || statsByTeam.has(name)) return;
      statsByTeam.set(name, createEarlyTeamStats());
    };
    teams.forEach(pushTeam);
    const events = [];
    let pendingMinute = null;

    const findTeamInLine = (line="")=>{
      const teamFromParens = line.match(/\(([^)]+)\)/);
      if(teamFromParens?.[1]) return teamFromParens[1].trim();
      const lineNorm = normalizeTeamToken(line);
      const explicit = [...statsByTeam.keys()].find(name=>lineNorm.includes(normalizeTeamToken(name)));
      return explicit || null;
    };

    lines.forEach(line=>{
      const minuteFound = line.match(/(\d{1,3}\s*\+\s*\d{1,2}|\d{1,3})\s*'/);
      if(minuteFound) pendingMinute = parseMinuteToken(minuteFound[1]);
      const minute = Number.isFinite(Number(pendingMinute)) ? Number(pendingMinute) : null;
      if(minute===null || minute <= windowRange.start || minute > windowRange.end) return;
      if(/^\d{1,3}\s*\+\s*\d{1,2}\s*'$/.test(line) || /^\d{1,3}\s*'$/.test(line)) return;

      const type = detectEarlyType(line);
      if(!type) return;
      const detectedTeam = findTeamInLine(line) || teamA || "Equipo A";
      pushTeam(detectedTeam);
      events.push({ minute, team: detectedTeam, type, text: line });
    });

    if(statsByTeam.size < 2) pushTeam(teamB || "Rival");
    const teamList = [...statsByTeam.keys()].slice(0, 2);
    teamList.forEach(name=>{ if(!statsByTeam.has(name)) statsByTeam.set(name, createEarlyTeamStats()); });

    events.forEach(evt=>{
      const teamStats = statsByTeam.get(evt.team);
      if(!teamStats) return;
      if(evt.type === "goal") teamStats.goals += 1;
      if(evt.type === "shot") teamStats.shots += 1;
      if(evt.type === "shotOnTarget") teamStats.shotsOnTarget += 1;
      if(evt.type === "bigChance") teamStats.bigChances += 1;
      if(evt.type === "corner") teamStats.corners += 1;
      if(evt.type === "dangerCross") teamStats.dangerCross += 1;
      if(evt.type === "dangerAction") teamStats.dangerActions += 1;
      if(evt.type === "finalThird") teamStats.finalThird += 1;
      if(evt.type === "interception") teamStats.interceptions += 1;
      if(evt.type === "save") teamStats.savesForced += 1;
      if(evt.type === "control") teamStats.controlMentions += 1;
      if(evt.type === "possessionHint") teamStats.possessionHints += 1;
      if(evt.type === "loss") teamStats.lossMentions += 1;
      if(evt.type === "foul") teamStats.fouls += 1;
      if(evt.type === "card") teamStats.cards += 1;
      if(evt.type === "redCard") teamStats.redCards += 1;
      if(evt.type === "penalty") teamStats.penalties += 1;
      if(evt.type === "post") teamStats.posts += 1;
      if(evt.type === "injury") teamStats.injuries += 1;
      if(evt.type === "dangerCross" && /remata|disparo|tiro|cabezazo/i.test(evt.text)) teamStats.shots += 0.5;
    });

    return { teams: teamList, events, statsByTeam, windowRange };
  }

  function buildEarlyStatsFromEvents(eventsInput=[], { teamA="", teamB="", windowRange }={}){
    const events = Array.isArray(eventsInput) ? eventsInput : [];
    const teams = [teamA, teamB].filter(Boolean);
    const statsByTeam = new Map();
    const pushTeam = (name)=>{
      if(!name || statsByTeam.has(name)) return;
      statsByTeam.set(name, createEarlyTeamStats());
    };
    teams.forEach(pushTeam);

    events.forEach(evt=>{
      if(!evt?.team) return;
      pushTeam(evt.team);
      const teamStats = statsByTeam.get(evt.team);
      if(!teamStats) return;
      if(evt.type === "goal") teamStats.goals += 1;
      if(evt.type === "shot") teamStats.shots += 1;
      if(evt.type === "shotOnTarget") teamStats.shotsOnTarget += 1;
      if(evt.type === "bigChance") teamStats.bigChances += 1;
      if(evt.type === "corner") teamStats.corners += 1;
      if(evt.type === "dangerCross") teamStats.dangerCross += 1;
      if(evt.type === "dangerAction") teamStats.dangerActions += 1;
      if(evt.type === "finalThird") teamStats.finalThird += 1;
      if(evt.type === "interception") teamStats.interceptions += 1;
      if(evt.type === "save") teamStats.savesForced += 1;
      if(evt.type === "control") teamStats.controlMentions += 1;
      if(evt.type === "possessionHint") teamStats.possessionHints += 1;
      if(evt.type === "loss") teamStats.lossMentions += 1;
      if(evt.type === "foul") teamStats.fouls += 1;
      if(evt.type === "card") teamStats.cards += 1;
      if(evt.type === "redCard") teamStats.redCards += 1;
      if(evt.type === "penalty") teamStats.penalties += 1;
      if(evt.type === "post") teamStats.posts += 1;
      if(evt.type === "injury") teamStats.injuries += 1;
      if(evt.type === "dangerCross" && /remata|disparo|tiro|cabezazo/i.test(String(evt.text || ""))) teamStats.shots += 0.5;
    });

    if(statsByTeam.size < 2) pushTeam(teamB || "Rival");
    const teamList = [...statsByTeam.keys()].slice(0, 2);
    teamList.forEach(name=>{ if(!statsByTeam.has(name)) statsByTeam.set(name, createEarlyTeamStats()); });
    const filteredEvents = events.filter(evt=>teamList.includes(evt.team));
    return { teams: teamList, statsByTeam, events: filteredEvents, windowRange };
  }

  function scoreFromNarrative(events=[], firstTeam="", secondTeam=""){
    const score = { [firstTeam]: 0, [secondTeam]: 0 };
    (Array.isArray(events) ? events : []).forEach(evt=>{
      if(evt?.type === "goal" && (evt.team === firstTeam || evt.team === secondTeam)) score[evt.team] += 1;
    });
    return score;
  }

  function buildEpaLiveSnapshots(events=[], firstTeam="", secondTeam="", windowRange={ start: 0, end: 10 }){
    const safeEvents = (Array.isArray(events) ? events : []).slice().sort((a,b)=> (Number(a?.minute)||0) - (Number(b?.minute)||0));
    const start = Number(windowRange?.start) || 0;
    const end = Math.max(start + 10, Number(windowRange?.end) || 10);
    const slices = [];
    for(let t=start+10; t<=end+0.0001; t+=10){
      const segmentEvents = safeEvents.filter(evt=> (Number(evt?.minute)||0) > t-10 && (Number(evt?.minute)||0) <= t);
      const cumulativeEvents = safeEvents.filter(evt=> (Number(evt?.minute)||0) <= t);
      const cumulativeStats = buildEarlyStatsFromEvents(cumulativeEvents, { teamA: firstTeam, teamB: secondTeam, windowRange: { start, end: t } }).statsByTeam;
      const segmentStats = buildEarlyStatsFromEvents(segmentEvents, { teamA: firstTeam, teamB: secondTeam, windowRange: { start: t-10, end: t } }).statsByTeam;
      const score = scoreFromNarrative(cumulativeEvents, firstTeam, secondTeam);
      slices.push({
        minute: t,
        scoreHome: Number(score[firstTeam] || 0),
        scoreAway: Number(score[secondTeam] || 0),
        statsCumulative: {
          [firstTeam]: cumulativeStats.get(firstTeam) || createEarlyTeamStats(),
          [secondTeam]: cumulativeStats.get(secondTeam) || createEarlyTeamStats()
        },
        statsSegment: {
          [firstTeam]: segmentStats.get(firstTeam) || createEarlyTeamStats(),
          [secondTeam]: segmentStats.get(secondTeam) || createEarlyTeamStats()
        },
        relatoSegment: segmentEvents.map(evt=>String(evt?.text || "")).filter(Boolean)
      });
    }
    return slices;
  }

  function computeLiveOutcomeProbabilities(liveState={}, teamHome="", teamAway=""){
    const minute = clamp(Number(liveState?.minute) || 0, 1, 95);
    const scoreHome = Number(liveState?.scoreHome || 0);
    const scoreAway = Number(liveState?.scoreAway || 0);
    const goalDiff = scoreHome - scoreAway;
    const segment = liveState?.statsSegment || {};
    const homeRecent = segment?.[teamHome] || createEarlyTeamStats();
    const awayRecent = segment?.[teamAway] || createEarlyTeamStats();
    const cards = liveState?.statsCumulative || {};
    const homeCum = cards?.[teamHome] || createEarlyTeamStats();
    const awayCum = cards?.[teamAway] || createEarlyTeamStats();

    const normDiff = (h, a, scale=2)=>clamp((Number(h||0)-Number(a||0))/scale, -1, 1);
    const gamePhase = clamp(minute / 90, 0, 1);
    const A_score = clamp(goalDiff * (0.7 + 1.5*gamePhase), -3.5, 3.5);
    const A_redCards = clamp((Number(awayCum.redCards||0) - Number(homeCum.redCards||0)) * 1.35, -2.7, 2.7);
    const A_recent =
      0.90*normDiff(homeRecent.shotsOnTarget + 0.7*homeRecent.bigChances, awayRecent.shotsOnTarget + 0.7*awayRecent.bigChances, 2.2) +
      0.45*normDiff(homeRecent.corners, awayRecent.corners, 3) +
      0.35*normDiff(homeRecent.dangerActions + homeRecent.dangerCross, awayRecent.dangerActions + awayRecent.dangerCross, 4);
    const A_bigEvents =
      0.65*normDiff(homeRecent.posts + homeRecent.penalties, awayRecent.posts + awayRecent.penalties, 1.5) -
      0.20*normDiff(homeRecent.injuries, awayRecent.injuries, 2);

    const A = A_score + A_redCards + A_recent + A_bigEvents;
    const sigmoid = (x)=>1/(1+Math.exp(-x));
    const homeRaw = sigmoid(1.2*A);
    const awayRaw = sigmoid(-1.2*A);
    const drawBase = clamp(0.58 - 0.30*gamePhase - 0.20*Math.abs(goalDiff), 0.08, 0.65);
    const drawRaw = drawBase * Math.exp(-1.35*Math.abs(A));
    const sum = homeRaw + awayRaw + drawRaw || 1;
    const pHome = homeRaw / sum;
    const pDraw = drawRaw / sum;
    const pAway = awayRaw / sum;

    const reasons = [];
    if(Math.abs(A_score) > 0.8) reasons.push(`Marcador/minuto pesa fuerte (${scoreHome}-${scoreAway}, ${minute}').`);
    if(Math.abs(A_recent) > 0.25) reasons.push(A_recent > 0
      ? `${teamHome} empuja el tramo reciente (tiros a puerta/córners/presión).`
      : `${teamAway} está ganando momentum en el tramo reciente.`);
    if(Math.abs(A_redCards) > 0.2) reasons.push("Impacto disciplinario relevante por expulsión(es).");
    if(Math.abs(A_bigEvents) > 0.2) reasons.push("Eventos grandes detectados (poste/penal/lesión) movieron la balanza.");
    if(!reasons.length) reasons.push("Partido equilibrado: pocas señales diferenciales en este tramo.");

    const leader = pHome >= pAway ? teamHome : teamAway;
    return {
      advantage: A,
      pHome,
      pDraw,
      pAway,
      label: `Ahora mismo: ${teamHome} ${(pHome*100).toFixed(0)}% | Empate ${(pDraw*100).toFixed(0)}% | ${teamAway} ${(pAway*100).toFixed(0)}%`,
      explanation: `${leader} ${leader===teamHome ? "sube" : "presiona"}: ${reasons[0]}`,
      reasons
    };
  }

  function computeEarlyPhaseAnalyzer(text, { teamA="", teamB="", windowKey="0-10", seedProfiles={}, eventsOverride=null }={}){
    const parsed = Array.isArray(eventsOverride)
      ? buildEarlyStatsFromEvents(eventsOverride, { teamA, teamB, windowRange: resolveEarlyWindow(windowKey) })
      : parseEarlyNarrative(text, { teamA, teamB, windowKey });
    const { teams, statsByTeam, events, windowRange } = parsed;
    const [firstTeam, secondTeam] = teams;
    const a = statsByTeam.get(firstTeam) || createEarlyTeamStats();
    const b = statsByTeam.get(secondTeam) || createEarlyTeamStats();

    const total = (k)=>Number(a[k] || 0) + Number(b[k] || 0);
    const normLimit = (windowRange.end - windowRange.start) <= 10 ? 4 : 6;
    const norm = (value, max=normLimit)=>clamp((Number(value) || 0) / max, 0, 1);

    const rawIntensity =
      0.8*total("shots") +
      1.2*total("shotsOnTarget") +
      1.4*total("bigChances") +
      0.6*total("corners") +
      0.7*total("savesForced") +
      0.3*total("fouls");
    const intensity = clamp(rawIntensity / 6, 0, 1);

    const rawIDD = (s)=>
      0.60*s.bigChances +
      0.45*s.shots +
      0.50*s.shotsOnTarget +
      0.25*s.corners +
      0.20*s.controlMentions +
      0.15*s.dangerCross -
      0.20*s.lossMentions -
      0.10*s.fouls;

    const iddDiff = rawIDD(a) - rawIDD(b);
    const iddA = clamp(iddDiff / 4, -1, 1);
    const iddB = -iddA;

    const threatOf = (s)=>clamp((1.7*s.bigChances + 1.2*s.shotsOnTarget + 0.8*s.shots + 0.4*s.finalThird + 0.3*s.savesForced + 0.3*s.posts) / 7, 0, 1);
    const threatA = threatOf(a);
    const threatB = threatOf(b);

    let initiative = "equilibrado";
    if(iddA > 0.12) initiative = firstTeam;
    else if(iddB > 0.12) initiative = secondTeam;

    const controlType = (()=>{
      const cornersTotal = total("corners");
      const shotsTotal = total("shots") + total("bigChances");
      const controlTotal = total("controlMentions");
      const foulsTotal = total("fouls");
      const lossTotal = total("lossMentions");
      const cornerLimit = (windowRange.end - windowRange.start) >= 20 ? 3 : 2;
      const maxThreat = Math.max(threatA, threatB);
      if(cornersTotal >= cornerLimit) return "setpiece_pressure";
      if(foulsTotal >= 4 && lossTotal >= 3 && shotsTotal <= 2) return "scrappy";
      if(controlTotal >= 3 && maxThreat < 0.45) return "territorial_probe";
      if(shotsTotal >= 4 && controlTotal <= 2) return "direct_punch";
      return "balanced";
    })();

    const shockRiskFor = (selfIdd, self, opp)=>clamp(
      0.35*Math.max(0, selfIdd) +
      0.25*norm(self.lossMentions, 4) +
      0.25*norm(opp.shots + opp.shotsOnTarget + opp.bigChances, 6) -
      0.15*norm(opp.interceptions, 5),
      0,
      1
    );
    const shockA = shockRiskFor(iddA, a, b);
    const shockB = shockRiskFor(iddB, b, a);

    const disciplineA = clamp((a.fouls + 2*a.cards) / 6, 0, 1);
    const disciplineB = clamp((b.fouls + 2*b.cards) / 6, 0, 1);
    const intensityBand = intensity < 0.35 ? "low_intensity" : (intensity < 0.7 ? "medium_intensity" : "high_intensity");
    const tags = [
      initiative===firstTeam ? "early_initiative_home" : "",
      initiative===secondTeam ? "early_initiative_away" : "",
      intensityBand,
      controlType === "setpiece_pressure" ? `setpiece_pressure_${threatA>=threatB?"home":"away"}` : "",
      controlType === "scrappy" ? "scrappy_opening" : "",
      shockA > 0.55 ? "shock_risk_home_high" : "",
      shockB > 0.55 ? "shock_risk_away_high" : ""
    ].filter(Boolean);

    const tempoWord = intensity < 0.35 ? "bajo" : (intensity < 0.7 ? "medio" : "alto");
    const dominantTeam = initiative===firstTeam ? firstTeam : (initiative===secondTeam ? secondTeam : null);
    const leaderShock = dominantTeam===firstTeam ? shockA : (dominantTeam===secondTeam ? shockB : Math.max(shockA, shockB));

    const textLines = [
      dominantTeam
        ? `Inicio con iniciativa de ${dominantTeam} y ritmo ${tempoWord}.`
        : `Inicio equilibrado con ritmo ${tempoWord}.`,
      Math.max(threatA, threatB) > 0.6
        ? "Amenaza real: llegadas claras y acciones dentro del área."
        : Math.max(threatA, threatB) >= 0.35
          ? "Amenaza moderada: aproximaciones sin ocasión clarísima."
          : "Poco peligro: más control que profundidad.",
      leaderShock > 0.55
        ? "Riesgo de shock: el rival puede castigar en transición."
        : "Bajo riesgo de transición inmediata."
    ];

    const computePsychFromProfile = (teamName)=>{
      const p = seedProfiles?.[teamName]?.earlyPsychProfile || {};
      return {
        confidence: clamp(Number(p.avgConfidence ?? 0.50), 0, 1),
        composure: clamp(Number(p.avgComposure ?? 0.55), 0, 1),
        frustration: clamp(Math.max(0.10, Number(p.sterileTendency ?? 0.10) * 0.45), 0, 1),
        belief: clamp(Number(p.avgConfidence ?? 0.50), 0, 1),
        tiltRisk: clamp(Math.max(0.20, Number(p.tiltSensitivity ?? 0.20) * 0.5), 0, 1)
      };
    };

    const psychFor = (teamName, self, opp, iddValue, threatValue, oppShockRisk)=>{
      const base = computePsychFromProfile(teamName);
      const dom = clamp((iddValue + 1) / 2, 0, 1);
      const sterilePressure = clamp(0.5*norm(self.controlMentions) + 0.5*norm(self.shots + self.corners) - 0.8*threatValue, 0, 1);
      const friction = clamp((self.fouls + 2*self.cards) / 6, 0, 1);
      const scares = clamp(norm(opp.bigChances + opp.shots + opp.savesForced), 0, 1);
      const shockSignalOpp = clamp(oppShockRisk, 0, 1);

      const confidence = clamp(
        base.confidence*0.35 +
        0.50 + 0.35*dom + 0.30*threatValue - 0.25*scares - 0.15*friction,
        0,
        1
      );
      const composure = clamp(
        base.composure*0.35 +
        0.55 - 0.35*friction - 0.20*intensity - 0.20*scares + 0.15*(1 - sterilePressure),
        0,
        1
      );
      const frustration = clamp(
        base.frustration*0.35 +
        0.10 + 0.55*sterilePressure + 0.25*norm(opp.savesForced) + 0.15*(dom > 0.6 ? 1 : 0),
        0,
        1
      );
      const belief = clamp(
        base.belief*0.35 +
        0.50 + 0.30*dom + 0.15*(1 - scares) - 0.25*shockSignalOpp,
        0,
        1
      );
      const tiltRisk = clamp(
        base.tiltRisk*0.35 +
        0.20 + 0.45*frustration + 0.35*(1 - composure) + 0.20*scares,
        0,
        1
      );
      return { confidence, composure, frustration, belief, tiltRisk, dom, sterilePressure };
    };

    const computePostGoalBehavior = (teamName, oppName)=>{
      const timeline = [...events].sort((x,y)=>(Number(x.minute)||0)-(Number(y.minute)||0));
      let collapseBoost = 0;
      timeline.forEach((evt)=>{
        if(evt?.type !== "goal" || evt.team !== oppName) return;
        const min = Number(evt.minute) || 0;
        const segment = timeline.filter((row)=>{
          const rowMin = Number(row.minute) || 0;
          return rowMin > min && rowMin <= min + 5;
        });
        const attacks = segment.filter((row)=>row.team===teamName && ["shot", "shotOnTarget", "bigChance", "corner", "dangerAction"].includes(row.type)).length;
        const losses = segment.filter((row)=>row.team===teamName && row.type === "loss").length;
        const fouls = segment.filter((row)=>row.team===teamName && row.type === "foul").length;
        const shots = segment.filter((row)=>row.team===teamName && ["shot", "shotOnTarget", "bigChance"].includes(row.type)).length;
        const pressingDrops = attacks <= 1 && losses >= 2;
        const foulsRise = fouls >= 2;
        if(pressingDrops && foulsRise) collapseBoost += 0.15;
        if(shots === 0 && losses >= 2) collapseBoost += 0.05;
      });
      return clamp(collapseBoost, 0, 0.4);
    };

    const psychA = psychFor(firstTeam, a, b, iddA, threatA, shockB);
    const psychB = psychFor(secondTeam, b, a, iddB, threatB, shockA);
    const postGoalCollapseA = computePostGoalBehavior(firstTeam, secondTeam);
    const postGoalCollapseB = computePostGoalBehavior(secondTeam, firstTeam);
    psychA.tiltRisk = clamp(psychA.tiltRisk + postGoalCollapseA, 0, 1);
    psychB.tiltRisk = clamp(psychB.tiltRisk + postGoalCollapseB, 0, 1);

    const tagsPsychFor = (selfPsych, threatValue, oppShockRisk)=>{
      const tags = [];
      if(selfPsych.confidence > 0.65) tags.push("confident_start");
      if(selfPsych.composure < 0.40) tags.push("nervous_start");
      if(selfPsych.frustration > 0.60 && threatValue < 0.45) tags.push("sterile_frustration");
      if(selfPsych.tiltRisk > 0.60) tags.push("tilt_warning");
      if(oppShockRisk > 0.55 && selfPsych.dom > 0.55) tags.push("shock_fear");
      if(selfPsych.dom > 0.55 && selfPsych.composure > 0.60) tags.push("calm_control");
      return tags;
    };

    const psychTags = {
      [firstTeam]: tagsPsychFor(psychA, threatA, shockB),
      [secondTeam]: tagsPsychFor(psychB, threatB, shockA)
    };

    const psychTextFor = (teamName, pTags, selfPsych, threatValue, oppShockRisk)=>{
      const lines = [];
      if(pTags.includes("nervous_start")) lines.push("Inicio ansioso: falta temple y orden.");
      else if(pTags.includes("calm_control")) lines.push("Confianza subiendo, composure estable.");
      else if(pTags.includes("confident_start")) lines.push("Arranque con confianza y control emocional.");
      else lines.push("Inicio contenido, buscando estabilidad emocional.");

      if(pTags.includes("sterile_frustration")) lines.push("Dominio con frustración creciendo: presión sin premio claro.");
      else if(selfPsych.frustration > 0.60) lines.push("Frustración alta: cuidado con decisiones apresuradas.");
      else lines.push(threatValue >= 0.45 ? "Amenaza moderada/alta sin romper del todo el partido." : "Poco peligro directo: ritmo más de control que de daño.");

      if(pTags.includes("shock_fear")) lines.push("Rival huele shock: transición peligrosa si hay pérdida.");
      else if(pTags.includes("tilt_warning")) lines.push("Alerta de tilt: un golpe rival puede desordenar al equipo.");
      else lines.push(oppShockRisk > 0.55 ? "Riesgo de shock presente: vigilar transiciones defensivas." : "Riesgo de shock bajo en este tramo.");
      return lines.slice(0, 3);
    };

    const psychText = {
      [firstTeam]: psychTextFor(firstTeam, psychTags[firstTeam], psychA, threatA, shockB),
      [secondTeam]: psychTextFor(secondTeam, psychTags[secondTeam], psychB, threatB, shockA)
    };

    const eventWeight = { goal: 2.2, shot: 0.9, shotOnTarget: 1.2, bigChance: 1.5, corner: 0.6, save: 0.7, control: 0.4, finalThird: 0.5, foul: 0.25, card: 0.35, redCard: 1.7, penalty: 1.5, post: 1.2, dangerAction: 0.55, dangerCross: 0.4 };
    const bucketCount = 5;
    const bucketSpan = (windowRange.end - windowRange.start) / bucketCount;
    const chartBuckets = Array.from({ length: bucketCount }, (_, idx)=>({
      start: windowRange.start + idx*bucketSpan,
      end: windowRange.start + (idx+1)*bucketSpan,
      total: 0,
      [firstTeam]: 0,
      [secondTeam]: 0
    }));
    events.forEach(evt=>{
      const idx = clamp(Math.floor((evt.minute - windowRange.start - 0.0001) / Math.max(1, bucketSpan)), 0, bucketCount-1);
      const bucket = chartBuckets[idx];
      const w = Number(eventWeight[evt.type] || 0.25);
      bucket.total += w;
      if(evt.team === firstTeam) bucket[firstTeam] += w;
      if(evt.team === secondTeam) bucket[secondTeam] += w;
    });
    const makeEMA = (series=[], alpha=0.4)=>{
      let prev = 0;
      return series.map((v, idx)=>{
        prev = idx===0 ? v : prev*(1-alpha) + v*alpha;
        return prev;
      });
    };
    const movementA = chartBuckets.map(b=>b[firstTeam]);
    const movementB = chartBuckets.map(b=>b[secondTeam]);
    const emaA = makeEMA(movementA, 0.45);
    const emaB = makeEMA(movementB, 0.45);

    const snapshots = buildEpaLiveSnapshots(events, firstTeam, secondTeam, windowRange);
    const latestSnapshot = snapshots[snapshots.length-1] || {
      minute: windowRange.end,
      scoreHome: 0,
      scoreAway: 0,
      statsCumulative: {
        [firstTeam]: a,
        [secondTeam]: b
      },
      statsSegment: {
        [firstTeam]: a,
        [secondTeam]: b
      },
      relatoSegment: []
    };
    const liveProbabilities = computeLiveOutcomeProbabilities(latestSnapshot, firstTeam, secondTeam);

    const features = {
      idd: {
        [firstTeam]: iddA,
        [secondTeam]: iddB
      },
      intensity,
      initiative,
      threat: {
        [firstTeam]: threatA,
        [secondTeam]: threatB
      },
      controlType,
      shockRisk: {
        [firstTeam]: shockA,
        [secondTeam]: shockB
      },
      disciplineRisk: {
        [firstTeam]: disciplineA,
        [secondTeam]: disciplineB
      },
      psychSignals: {
        [firstTeam]: { dom: psychA.dom, sterilePressure: psychA.sterilePressure, postGoalCollapse: postGoalCollapseA },
        [secondTeam]: { dom: psychB.dom, sterilePressure: psychB.sterilePressure, postGoalCollapse: postGoalCollapseB }
      }
    };

    return {
      window: windowRange.label,
      teams: [firstTeam, secondTeam],
      liveState: latestSnapshot,
      snapshots,
      liveProbabilities,
      features,
      tags,
      text: textLines,
      psych: {
        [firstTeam]: {
          confidence: psychA.confidence,
          composure: psychA.composure,
          frustration: psychA.frustration,
          belief: psychA.belief,
          tiltRisk: psychA.tiltRisk
        },
        [secondTeam]: {
          confidence: psychB.confidence,
          composure: psychB.composure,
          frustration: psychB.frustration,
          belief: psychB.belief,
          tiltRisk: psychB.tiltRisk
        }
      },
      psychTags,
      psychText,
      psychChart: {
        buckets: chartBuckets.map((b, idx)=>({
          idx,
          label: `${Math.round(b.start)}-${Math.round(b.end)}`,
          intensity: clamp(b.total / 3, 0, 1),
          [firstTeam]: b[firstTeam],
          [secondTeam]: b[secondTeam],
          ema: {
            [firstTeam]: emaA[idx],
            [secondTeam]: emaB[idx]
          }
        }))
      },
      signatureUpdate: {
        [firstTeam]: {
          early_idd: iddA,
          early_intensity: intensity,
          early_threat: threatA,
          early_shockRisk: shockA,
          openingType: controlType,
          early_psych: { confidence: psychA.confidence, composure: psychA.composure, frustration: psychA.frustration, tiltRisk: psychA.tiltRisk }
        },
        [secondTeam]: {
          early_idd: iddB,
          early_intensity: intensity,
          early_threat: threatB,
          early_shockRisk: shockB,
          openingType: controlType,
          early_psych: { confidence: psychB.confidence, composure: psychB.composure, frustration: psychB.frustration, tiltRisk: psychB.tiltRisk }
        }
      }
    };
  }

  function updateTeamEarlyProfile(teamProfile, teamName, update={}){
    const profile = structuredClone(teamProfile || {});
    const current = profile.earlyProfile || {
      n: 0,
      avgEarlyIDD: 0,
      avgEarlyIntensity: 0,
      avgEarlyThreat: 0,
      avgEarlyShockRisk: 0,
      openingTypes: {
        territorial_probe: 0,
        direct_punch: 0,
        setpiece_pressure: 0,
        scrappy: 0,
        balanced: 0
      }
    };
    const n = Number(current.n) || 0;
    const nextN = n + 1;
    const avg = (oldValue, newValue)=>((Number(oldValue) || 0)*n + (Number(newValue) || 0)) / Math.max(1, nextN);
    const openingTypes = { ...current.openingTypes };
    const seenTypes = ["territorial_probe", "direct_punch", "setpiece_pressure", "scrappy", "balanced"];
    seenTypes.forEach(type=>{
      const prevCount = (Number(openingTypes[type]) || 0) * n;
      const nextCount = prevCount + (update.openingType === type ? 1 : 0);
      openingTypes[type] = nextCount / Math.max(1, nextN);
    });

    profile.team = teamName || profile.team || "";
    profile.version = profile.version || "momentumSignature_v1";
    profile.updatedAt = new Date().toISOString();
    profile.earlyProfile = {
      n: nextN,
      avgEarlyIDD: avg(current.avgEarlyIDD, update.early_idd),
      avgEarlyIntensity: avg(current.avgEarlyIntensity, update.early_intensity),
      avgEarlyThreat: avg(current.avgEarlyThreat, update.early_threat),
      avgEarlyShockRisk: avg(current.avgEarlyShockRisk, update.early_shockRisk),
      openingTypes
    };

    const psychCurrent = profile.earlyPsychProfile || {
      n: 0,
      avgConfidence: 0.50,
      avgComposure: 0.55,
      avgFrustration: 0.10,
      avgTiltRisk: 0.20,
      tiltSensitivity: 0.20,
      sterileTendency: 0.10
    };
    const psychN = Number(psychCurrent.n) || 0;
    const psychNextN = psychN + 1;
    const a = psychN > 20 ? 0.08 : 0.15;
    const ema = (oldValue, newValue, fallback)=>{
      const oldV = Number.isFinite(Number(oldValue)) ? Number(oldValue) : fallback;
      const newV = Number.isFinite(Number(newValue)) ? Number(newValue) : oldV;
      return oldV*(1-a) + newV*a;
    };
    const psychIn = update.early_psych || {};
    profile.earlyPsychProfile = {
      n: psychNextN,
      avgConfidence: ema(psychCurrent.avgConfidence, psychIn.confidence, 0.50),
      avgComposure: ema(psychCurrent.avgComposure, psychIn.composure, 0.55),
      avgFrustration: ema(psychCurrent.avgFrustration, psychIn.frustration, 0.10),
      avgTiltRisk: ema(psychCurrent.avgTiltRisk, psychIn.tiltRisk, 0.20),
      tiltSensitivity: ema(psychCurrent.tiltSensitivity, psychIn.tiltRisk, 0.20),
      sterileTendency: ema(psychCurrent.sterileTendency, psychIn.frustration, 0.10)
    };
    return profile;
  }

  function safeParseJson(raw){
    if(raw && typeof raw === "object") return raw;
    const text = String(raw || "").trim();
    if(!text) return null;
    try{
      const parsed = JSON.parse(text);
      if(typeof parsed === "string"){
        try{
          return JSON.parse(parsed);
        }catch(_e2){
          return null;
        }
      }
      return parsed;
    }catch(_e){
      if((text.startsWith('"{') && text.endsWith('}"')) || (text.startsWith("'{") && text.endsWith("}'"))){
        try{
          return JSON.parse(text.slice(1, -1));
        }catch(_e3){
          return null;
        }
      }
      return null;
    }
  }

  function normalizeIncomingLpePayload(payload={}){
    if(payload?.kind !== "match_stats") return payload;

    const normalizeLabel = (value="")=>String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const parseNum = (candidate)=>{
      const direct = Number(candidate);
      if(Number.isFinite(direct)) return direct;
      const raw = String(candidate ?? "").replace(/%/g, "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
      return raw ? Number(raw[0]) : 0;
    };

    const categoryMap = {
      "remates a puerta": "shotsOn",
      "disparos a puerta": "shotsOn",
      "tiros a puerta": "shotsOn",
      "remates totales": "shots",
      "disparos totales": "shots",
      "tiros totales": "shots",
      "grandes ocasiones": "bigChances",
      "grandes posibilidades": "bigChances",
      "big chances": "bigChances",
      "corneres": "corners",
      "tiros de esquina": "corners",
      "posesion": "possession",
      "posesion del balon": "possession",
      "faltas": "fouls",
      "tarjetas amarillas": "yellows",
      "ataques peligrosos": "dangerAttacks",
      "ataques de peligro": "dangerAttacks",
      "peligrosos ataques": "dangerAttacks",
      "toques en el area contraria": "dangerAttacks",
      "xg": "xg",
      "goles esperados xg": "xg"
    };

    const stats = { home: {}, away: {} };
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    sections.forEach(section=>{
      (section?.stats || []).forEach(stat=>{
        const key = categoryMap[normalizeLabel(stat?.category || "")];
        if(!key) return;
        const homeNum = parseNum(stat?.home?.raw ?? stat?.home?.main ?? stat?.home?.numeric ?? stat?.home);
        const awayNum = parseNum(stat?.away?.raw ?? stat?.away?.main ?? stat?.away?.numeric ?? stat?.away);
        stats.home[key] = homeNum;
        stats.away[key] = awayNum;
      });
    });

    const matchup = String(payload?.team?.name || "");
    const teamMatch = matchup.match(/^(.+?)\s+vs\s+(.+?)(?:\s*\(|$)/i);
    const teams = teamMatch
      ? { home: teamMatch[1].trim(), away: teamMatch[2].trim() }
      : payload?.teams || { home: "Home", away: "Away" };

    const pageUrl = String(payload?.pageUrl || "");
    const midMatch = pageUrl.match(/[?&]mid=([^&]+)/i);
    const fallbackId = `${teams.home || "home"}_vs_${teams.away || "away"}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    return {
      matchId: payload?.matchId || (midMatch ? `mid_${midMatch[1]}` : fallbackId || `TMP-${Date.now()}`),
      teams,
      score: payload?.score || { home: 0, away: 0 },
      stats,
      window: payload?.window || payload?.minuteWindow || payload?.capturedAt || "live",
      source: payload?.source || "match_stats"
    };
  }

  function lpeNormDanger(value){
    return clamp((Number(value) || 0) / 22, 0, 1);
  }

  function lpeNormPossession(value){
    if(value===undefined || value===null || value==="") return 0.5;
    return clamp((Number(value) || 0) / 100, 0, 1);
  }

  function lpeReadStat(stats, teamKey, stat){
    return Number(stats?.[teamKey]?.[stat] || 0);
  }

  function lpeStateModifier(scoreDiff=0, minute=0){
    const gameWeight = clamp((Number(minute) || 0) / 90, 0, 1);
    return clamp(-(Number(scoreDiff) || 0) * 0.05 * (0.6 + gameWeight), -0.15, 0.15);
  }

  function computeLiveProjectionWindow(payload={}, context={}){
    const stats = payload.stats || {};
    const score = payload.score || {};
    const homeShotsOn = lpeReadStat(stats, "home", "shotsOn");
    const awayShotsOn = lpeReadStat(stats, "away", "shotsOn");
    const homeShots = lpeReadStat(stats, "home", "shots");
    const awayShots = lpeReadStat(stats, "away", "shots");
    const homeBig = lpeReadStat(stats, "home", "bigChances");
    const awayBig = lpeReadStat(stats, "away", "bigChances");
    const homeCorners = lpeReadStat(stats, "home", "corners");
    const awayCorners = lpeReadStat(stats, "away", "corners");
    const homeDanger = lpeReadStat(stats, "home", "dangerAttacks");
    const awayDanger = lpeReadStat(stats, "away", "dangerAttacks");
    const homePoss = lpeNormPossession(stats?.home?.possession);
    const awayPoss = lpeNormPossession(stats?.away?.possession);
    const homeFouls = lpeReadStat(stats, "home", "fouls");
    const awayFouls = lpeReadStat(stats, "away", "fouls");
    const homeYellows = lpeReadStat(stats, "home", "yellows");
    const awayYellows = lpeReadStat(stats, "away", "yellows");

    const iddRaw = ({ shotsOn, shots, big, corners, danger, poss, fouls, yellows })=>
      0.55*shotsOn +
      0.40*shots +
      0.35*big +
      0.20*corners +
      0.15*lpeNormDanger(danger) +
      0.10*poss -
      0.10*fouls -
      0.25*yellows;

    const homeIddRaw = iddRaw({ shotsOn: homeShotsOn, shots: homeShots, big: homeBig, corners: homeCorners, danger: homeDanger, poss: homePoss, fouls: homeFouls, yellows: homeYellows });
    const awayIddRaw = iddRaw({ shotsOn: awayShotsOn, shots: awayShots, big: awayBig, corners: awayCorners, danger: awayDanger, poss: awayPoss, fouls: awayFouls, yellows: awayYellows });
    const iddDiff = awayIddRaw - homeIddRaw;
    const iddAway = clamp(iddDiff / 4, -1, 1);
    const iddHome = -iddAway;

    const shotsTotal = homeShots + awayShots + homeShotsOn + awayShotsOn;
    const cornersTotal = homeCorners + awayCorners;
    const bigTotal = homeBig + awayBig;
    const foulsTotal = homeFouls + awayFouls;
    const intensity = clamp((shotsTotal + cornersTotal + bigTotal + foulsTotal*0.3) / 10, 0, 1);
    const threatHome = clamp((homeBig*1.6 + homeShotsOn*1.2 + homeShots*0.5 + homeCorners*0.25) / 6, 0, 1);
    const threatAway = clamp((awayBig*1.6 + awayShotsOn*1.2 + awayShots*0.5 + awayCorners*0.25) / 6, 0, 1);
    const dangerTotalNorm = lpeNormDanger(homeDanger + awayDanger);
    const pace = clamp((shotsTotal + foulsTotal + cornersTotal + dangerTotalNorm) / 14, 0, 1);

    const prevFast = Number(context?.fastEma?.idd?.away || 0);
    const prevSlow = Number(context?.ema?.idd?.away || 0);
    const prevFastThreat = Number(context?.fastEma?.threat?.edge || 0);
    const prevSlowThreat = Number(context?.ema?.threat?.edge || 0);
    const fastAlpha = 0.55;
    const slowAlpha = 0.18;

    const fastAway = prevFast*(1-fastAlpha) + iddAway*fastAlpha;
    const slowAway = prevSlow*(1-slowAlpha) + iddAway*slowAlpha;
    const threatEdge = threatAway - threatHome;
    const fastThreat = prevFastThreat*(1-fastAlpha) + threatEdge*fastAlpha;
    const slowThreat = prevSlowThreat*(1-slowAlpha) + threatEdge*slowAlpha;

    const regimeDeltaIdd = Math.abs(fastAway - slowAway);
    const regimeDeltaThreat = Math.abs(fastThreat - slowThreat);
    const regimeDelta = Math.max(regimeDeltaIdd, regimeDeltaThreat);

    const lastUncertaintyIdd = Number(context?.uncertainty?.idd || 0.18);
    const lastUncertaintyThreat = Number(context?.uncertainty?.threat || 0.22);
    const uncertaintyIdd = clamp(0.85*lastUncertaintyIdd + 0.15*Math.abs(iddAway - slowAway), 0.05, 0.6);
    const uncertaintyThreat = clamp(0.85*lastUncertaintyThreat + 0.15*Math.abs(threatEdge - slowThreat), 0.05, 0.6);
    const zIdd = (iddAway - slowAway) / (uncertaintyIdd + 0.05);

    const previousStreak = Number(context?.zStreak || 0);
    const zStreak = Math.abs(zIdd) > 1.6 ? previousStreak + 1 : 0;
    const minuteLabel = String(payload.window || payload.minuteWindow || payload.minute || "live");
    const windowEnd = Number(String(minuteLabel).split("-").slice(-1)[0]) || 0;
    const scoreDiff = (Number(score.away) || 0) - (Number(score.home) || 0);
    const iddNext = clamp(0.55*fastAway + 0.45*slowAway + lpeStateModifier(scoreDiff, windowEnd), -1, 1);
    const epi = clamp(
      0.45*intensity +
      0.35*pace +
      0.30*Math.max(threatHome, threatAway) +
      0.25*regimeDelta,
      0,
      1
    );

    const alerts = [];
    const dominantTeam = iddAway > 0 ? "away" : "home";
    if(Math.abs(zIdd) > 2.2){
      alerts.push({ type: "SHIFT", minuteWindow: minuteLabel, team: dominantTeam, why: `z=${zIdd.toFixed(2)}, regimeDelta=${regimeDelta.toFixed(2)}` });
    }
    if(regimeDelta > 0.22){
      alerts.push({ type: "TREND_BREAK", minuteWindow: minuteLabel, team: dominantTeam, why: `regimeDelta=${regimeDelta.toFixed(2)}` });
    }
    if(zStreak >= 2){
      alerts.push({ type: "SUSTAINED_CHANGE", minuteWindow: minuteLabel, team: dominantTeam, why: `abs(z)>1.6 por ${zStreak} ventanas` });
    }
    if(epi > 0.75){
      alerts.push({ type: "EPI_SPIKE", minuteWindow: minuteLabel, level: Number(epi.toFixed(2)) });
    }

    const epaPsych = context?.epaPsych || null;
    const frustrationA = Number(epaPsych?.home?.frustration ?? epaPsych?.away?.frustration ?? NaN);
    const frustrationB = Number(epaPsych?.away?.frustration ?? NaN);
    if(alerts.some(a=>a.type==="SHIFT") && Number.isFinite(frustrationA) && Number.isFinite(frustrationB)){
      const frustrationDelta = Math.abs(frustrationA - frustrationB);
      if(frustrationDelta < 0.08){
        alerts.push({ type: "TACTICAL_SHIFT", minuteWindow: minuteLabel, why: "Cambio táctico/ritmo no reflejado emocionalmente" });
      }
    }

    const state = {
      idd: { home: iddHome, away: iddAway },
      intensity,
      threat: { home: threatHome, away: threatAway },
      pace,
      projection: {
        iddNext,
        dominance: iddNext > 0 ? `Away +${Math.abs(iddNext).toFixed(2)}` : `Home +${Math.abs(iddNext).toFixed(2)}`,
        shockRisk: epi > 0.75 ? "alto" : epi > 0.55 ? "medio" : "bajo",
        eventTension: epi
      }
    };

    return {
      state,
      ema: {
        idd: { home: -slowAway, away: slowAway },
        threat: { home: -slowThreat, away: slowThreat, edge: slowThreat }
      },
      fastEma: {
        idd: { home: -fastAway, away: fastAway },
        threat: { home: -fastThreat, away: fastThreat, edge: fastThreat }
      },
      uncertainty: { idd: uncertaintyIdd, threat: uncertaintyThreat },
      regimeDelta,
      zScore: zIdd,
      zStreak,
      alerts,
      window: minuteLabel,
      score: { home: Number(score.home) || 0, away: Number(score.away) || 0 }
    };
  }

  function updateLiveProjectionState(prevState={}, payload={}, context={}){
    const previous = prevState || {};
    const k = Number(previous.k || 0) + 1;
    const update = computeLiveProjectionWindow(payload, {
      fastEma: previous.fastEma,
      ema: previous.ema,
      uncertainty: previous.uncertainty,
      zStreak: previous.zStreak,
      epaPsych: context.epaPsych
    });
    return {
      matchId: payload.matchId || previous.matchId || uid("lpe"),
      teams: payload.teams || previous.teams || { home: "Home", away: "Away" },
      k,
      state: update.state,
      ema: update.ema,
      fastEma: update.fastEma,
      uncertainty: update.uncertainty,
      regimeDelta: update.regimeDelta,
      zScore: update.zScore,
      zStreak: update.zStreak,
      projections: update.state.projection,
      score: update.score,
      lastWindow: update.window,
      history: [...(previous.history || []), {
        k,
        window: update.window,
        iddAway: update.state.idd.away,
        fastAway: update.fastEma.idd.away,
        slowAway: update.ema.idd.away,
        epi: update.state.projection.eventTension
      }].slice(-24),
      alerts: [...(previous.alerts || []), ...update.alerts].slice(-40),
      updatedAt: new Date().toISOString()
    };
  }

  function extractNarratedEvents(rawText, teams){
    const lines = String(rawText || "").split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const events = [];
    const counters = {
      home: { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, savesNarrated: 0, cards: 0, reds: 0, interceptions: 0 },
      away: { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, savesNarrated: 0, cards: 0, reds: 0, interceptions: 0 }
    };
    const teamNameMap = [
      { key: "home", name: String(teams?.home || "").toLowerCase() },
      { key: "away", name: String(teams?.away || "").toLowerCase() }
    ];
    let pendingMinute = null;

    lines.forEach(line=>{
      const minuteFound = line.match(/(\d{1,3}\s*\+\s*\d{1,2}|\d{1,3})\s*'/);
      if(minuteFound) pendingMinute = parseMinuteToken(minuteFound[1]);
      if(/^\d{1,3}\s*\+\s*\d{1,2}\s*'$/.test(line) || /^\d{1,3}\s*'$/.test(line)) return;

      let type = null;
      if(/¡?gol!?/i.test(line)) type = "goal";
      else if(/tarjeta roja|expulsad/i.test(line)) type = "red";
      else if(/tarjeta amarilla|amonestad/i.test(line)) type = "yellow";
      else if(/sustituci[oó]n|\bcambio\.?/i.test(line)) type = "sub";
      else if(/c[oó]rner/i.test(line)) type = "corner";
      else if(/fuera de juego/i.test(line)) type = "offside";
      else if(/falta|infracci[oó]n/i.test(line)) type = "foul";
      else if(/parada|atajada/i.test(line)) type = "save";
      if(!type) return;

      const playerTeam = line.match(/([A-Za-zÀ-ÿ' .-]+)\s*\(([^)]+)\)/);
      const player = playerTeam ? playerTeam[1].trim() : undefined;
      const teamFromPlayer = playerTeam ? playerTeam[2].trim() : "";
      const lineLower = line.toLowerCase();
      const teamGuess = teamNameMap.find(t=>t.name && (lineLower.includes(t.name) || teamFromPlayer.toLowerCase().includes(t.name)));
      const team = teamGuess ? teams[teamGuess.key] : (teamFromPlayer || undefined);

      const event = { min: pendingMinute ?? null, type, team };
      if(player) event.player = player;
      events.push(event);

      const side = team===teams?.home ? "home" : team===teams?.away ? "away" : null;
      if(side){
        if(type==="corner") counters[side].corners += 1;
        if(type==="yellow") counters[side].cards += 1;
        if(type==="red") counters[side].reds += 1;
        if(type==="save") counters[side].savesNarrated += 1;
        if(/dispara|cabecea|centra peligroso|remata/i.test(line)) counters[side].attacksNarrated += 1;
        if(/ocasi[oó]n clar[ií]sima|casi marca|remata dentro del [aá]rea/i.test(line)) counters[side].bigChancesNarrated += 1;
        if(/interceptad|despejad/i.test(line)) counters[side].interceptions += 1;
      }
    });

    return { events, counters, lines };
  }

  function normalizeStat(value, scale=8){
    return clamp((Number(value) || 0) / scale, 0, 1);
  }

  function buildNarrativeDiagnostic({ match, teams, parsed }){
    const goalsHome = Number(match.homeGoals) || 0;
    const goalsAway = Number(match.awayGoals) || 0;
    const losingSide = goalsHome===goalsAway ? null : (goalsHome<goalsAway ? "home" : "away");
    const winnerSide = goalsHome===goalsAway ? null : (goalsHome>goalsAway ? "home" : "away");
    const breakMinute = parsed.events.find(e=>e.type==="goal")?.min ?? null;
    const losingC = losingSide ? parsed.counters[losingSide] : { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, cards: 0, interceptions: 0 };
    const winnerC = winnerSide ? parsed.counters[winnerSide] : { savesNarrated: 0 };
    const loserGoals = losingSide==="home" ? goalsHome : losingSide==="away" ? goalsAway : 0;

    const control_without_conversion = clamp(
      0.5*normalizeStat(losingC.attacksNarrated, 12) +
      0.3*normalizeStat(losingC.corners, 7) +
      0.4*normalizeStat(losingC.bigChancesNarrated, 5) -
      0.7*normalizeStat(loserGoals, 3),
      0,
      1
    );
    const transition_punished = breakMinute ? 0.4 : 0;
    const low_block_resistance = clamp(
      0.4*normalizeStat(losingC.corners, 8) +
      0.4*normalizeStat(losingC.interceptions, 8) +
      0.3*normalizeStat(winnerC.savesNarrated, 8),
      0,
      1
    );
    const late_push = parsed.events.filter(e=>Number(e.min)>=75 && losingSide && e.team===teams[losingSide] && ["corner", "foul", "goal"].includes(e.type)).length;
    const late_goal_by_winner = parsed.events.some(e=>e.type==="goal" && Number(e.min)>=90 && winnerSide && e.team===teams[winnerSide]);
    const late_risk_exposure = clamp(normalizeStat(late_push, 5) + (late_goal_by_winner ? 0.35 : 0), 0, 1);
    const earlyYellows = parsed.events.filter(e=>e.type==="yellow" && Number(e.min)>0 && Number(e.min)<35);
    const discipline_impact = clamp(normalizeStat(earlyYellows.length, 3) + normalizeStat(losingC.cards, 6) * 0.6, 0, 1);

    const labels = { control_without_conversion, transition_punished, low_block_resistance, discipline_impact, late_risk_exposure };
    const summary = [
      control_without_conversion>0.55 ? `${teams[losingSide] || "Un equipo"} generó volumen sin convertir.` : "Partido equilibrado sin gran brecha de conversión.",
      breakMinute ? `El minuto quiebre fue el ${breakMinute}', cambiando el guion.` : "Sin minuto de quiebre claro en el relato.",
      late_risk_exposure>0.55 ? "El cierre mostró exposición al riesgo en tramo final." : "Tramo final relativamente controlado."
    ];
    return { breakMinute, labels, summary };
  }

  function applyDiagnosticToProfiles(db, { match, diagnostic }){
    const home = db.teams.find(t=>t.id===match.homeId);
    const away = db.teams.find(t=>t.id===match.awayId);
    const homeP = getOrCreateDiagProfile(db, match.homeId, home?.name || "Local");
    const awayP = getOrCreateDiagProfile(db, match.awayId, away?.name || "Visitante");
    const alphaHome = homeP.matchesCount<5 ? 0.2 : 0.12;
    const alphaAway = awayP.matchesCount<5 ? 0.2 : 0.12;
    const labels = diagnostic.labels || {};
    const homeWon = (Number(match.homeGoals)||0) > (Number(match.awayGoals)||0);
    const awayWon = (Number(match.awayGoals)||0) > (Number(match.homeGoals)||0);

    const homeSignals = {
      territorial_strength: homeWon ? 0.62 : 0.55,
      finishing_quality: homeWon ? 0.65 : 1 - (labels.control_without_conversion || 0.5),
      transition_attack: homeWon ? 0.55 + (labels.transition_punished || 0.4)*0.35 : 0.48,
      transition_defense: clamp(0.7 - (labels.transition_punished || 0.4)*0.5, 0, 1),
      low_block_execution: homeWon ? 0.55 + (labels.low_block_resistance || 0.5)*0.3 : 0.5,
      chance_creation: clamp(0.52 + (labels.control_without_conversion || 0.5)*0.25, 0, 1),
      discipline_risk: labels.discipline_impact || 0.4,
      late_game_management: clamp(0.65 - (labels.late_risk_exposure || 0.4)*0.3 + (homeWon ? 0.1 : -0.05), 0, 1)
    };
    const awaySignals = {
      territorial_strength: awayWon ? 0.62 : 0.55,
      finishing_quality: awayWon ? 0.65 : 1 - (labels.control_without_conversion || 0.5),
      transition_attack: awayWon ? 0.55 + (labels.transition_punished || 0.4)*0.35 : 0.48,
      transition_defense: clamp(0.7 - (labels.transition_punished || 0.4)*0.5, 0, 1),
      low_block_execution: awayWon ? 0.55 + (labels.low_block_resistance || 0.5)*0.3 : 0.5,
      chance_creation: clamp(0.52 + (labels.control_without_conversion || 0.5)*0.25, 0, 1),
      discipline_risk: labels.discipline_impact || 0.4,
      late_game_management: clamp(0.65 - (labels.late_risk_exposure || 0.4)*0.3 + (awayWon ? 0.1 : -0.05), 0, 1)
    };

    Object.keys(homeP.traits).forEach(key=>{
      homeP.traits[key] = clamp(homeP.traits[key] * (1-alphaHome) + (homeSignals[key] ?? 0.5) * alphaHome, 0, 1);
      awayP.traits[key] = clamp(awayP.traits[key] * (1-alphaAway) + (awaySignals[key] ?? 0.5) * alphaAway, 0, 1);
    });
    homeP.matchesCount += 1;
    awayP.matchesCount += 1;
    homeP.lastUpdated = new Date().toISOString();
    awayP.lastUpdated = new Date().toISOString();
  }

  function ensureLearningState(db){
    db.learning ||= structuredClone(defaultDb.learning);
    db.learning.schemaVersion = Number(db.learning.schemaVersion) || 2;
    db.learning.leagueScale ||= {};
    db.learning.teamBias ||= {};
    db.learning.temperatureByLeague ||= {};
    db.learning.trainingSet ||= [];
    db.learning.metrics ||= { global: null, byLeague: {} };
    db.learning.metrics.byLeague ||= {};
    db.predictions ||= [];
  }

  function applyTemperatureTo1x2(probPack, temperature=1){
    const t = clamp(Number(temperature) || 1, 0.7, 1.6);
    const toLogit = (p)=>Math.log(Math.max(1e-8, p));
    const exps = [Math.exp(toLogit(probPack.pH)/t), Math.exp(toLogit(probPack.pD)/t), Math.exp(toLogit(probPack.pA)/t)];
    const z = exps[0] + exps[1] + exps[2] || 1;
    return { pH: exps[0]/z, pD: exps[1]/z, pA: exps[2]/z };
  }

  function getLeagueTemperature(db, leagueId){
    ensureLearningState(db);
    return clamp(Number(db.learning.temperatureByLeague[leagueId]) || 1, 0.7, 1.6);
  }

  function calcPredictionDivergence(prediction){
    const pModel = prediction?.pModel;
    const pMarket = prediction?.pMarket;
    if(!pModel || !pMarket) return 0;
    return (Math.abs((pModel.pH || 0) - (pMarket.pH || 0))
      + Math.abs((pModel.pD || 0) - (pMarket.pD || 0))
      + Math.abs((pModel.pA || 0) - (pMarket.pA || 0))) / 3;
  }

  function recentWindowMetrics(db, limit=10){
    const resolved = db.predictions.filter(p=>p.resolved && p.actual).slice(-limit);
    if(!resolved.length) return { n: 0, brier: null, lambdaError: null };
    let brier = 0;
    let lambdaError = 0;
    resolved.forEach((p)=>{
      if(Number.isFinite(p.brierScore)) brier += p.brierScore;
      lambdaError += (Math.abs((p.actual.homeGoals || 0) - (p.lambdaHome || 0)) + Math.abs((p.actual.awayGoals || 0) - (p.lambdaAway || 0))) / 2;
    });
    return {
      n: resolved.length,
      brier: brier / resolved.length,
      lambdaError: lambdaError / resolved.length
    };
  }

  function modelHealthEmoji(recentBrier){
    if(!Number.isFinite(recentBrier)) return "🟡";
    if(recentBrier < 0.2) return "🟢";
    if(recentBrier < 0.26) return "🟡";
    return "🔴";
  }

  function createMetricState(){
    return {
      nMatches: 0,
      avgLogLoss: 0,
      brierScore: 0,
      avgGoalErrorHome: 0,
      avgGoalErrorAway: 0
    };
  }

  function rollingAverage(prevAvg, n, value){
    return ((prevAvg * n) + value) / (n + 1);
  }

  function updateMetricState(target, { logLoss, brier, errHome, errAway }){
    const state = target || createMetricState();
    const n = Number(state.nMatches) || 0;
    state.avgLogLoss = rollingAverage(Number(state.avgLogLoss) || 0, n, logLoss);
    state.brierScore = rollingAverage(Number(state.brierScore) || 0, n, brier);
    state.avgGoalErrorHome = rollingAverage(Number(state.avgGoalErrorHome) || 0, n, Math.abs(errHome));
    state.avgGoalErrorAway = rollingAverage(Number(state.avgGoalErrorAway) || 0, n, Math.abs(errAway));
    state.nMatches = n + 1;
    return state;
  }

  function getLeagueScale(db, leagueId){
    ensureLearningState(db);
    const raw = db.learning.leagueScale[leagueId] || {};
    return {
      home: clamp(Number(raw.home) || 1, 0.75, 1.35),
      away: clamp(Number(raw.away) || 1, 0.75, 1.35)
    };
  }

  function getTeamBias(db, teamId){
    ensureLearningState(db);
    const raw = db.learning.teamBias[teamId] || {};
    return {
      attack: clamp(Number(raw.attack) || 0, -0.35, 0.35),
      defense: clamp(Number(raw.defense) || 0, -0.35, 0.35)
    };
  }

  function topScoreCells(matrix, topN=3){
    const cells = [];
    for(let h=0;h<matrix.length;h++){
      for(let a=0;a<matrix[h].length;a++) cells.push({ h, a, p: matrix[h][a] });
    }
    return cells.sort((a,b)=>b.p-a.p).slice(0, topN);
  }

  function bttsProbability(matrix){
    let sum = 0;
    for(let h=1;h<matrix.length;h++){
      for(let a=1;a<matrix[h].length;a++) sum += matrix[h][a];
    }
    return sum;
  }

  function updateLearningFromResult(db, prediction, result){
    ensureLearningState(db);
    const leagueId = prediction.leagueId || "global";
    const lrLeague = clamp(Number(db.learning.lrLeague) || 0.12, 0.01, 0.35);
    const lrTeam = clamp(Number(db.learning.lrTeam) || 0.08, 0.01, 0.25);
    const leagueScaleBefore = getLeagueScale(db, leagueId);
    const temperatureBefore = getLeagueTemperature(db, leagueId);
    const leagueScale = { ...leagueScaleBefore };

    const confidence = Math.max(Number(prediction.pHome) || 0, Number(prediction.pDraw) || 0, Number(prediction.pAway) || 0);
    const recencyDays = Math.max(0, (Date.now() - new Date(prediction.createdAt || prediction.updatedAt || Date.now()).getTime()) / 86400000);
    const recencyWeight = clamp(Math.exp(-recencyDays / 240), 0.45, 1);

    const xgHome = pickFirstNumber(result.xgHome, result.homeXg, result.expectedHomeGoals);
    const xgAway = pickFirstNumber(result.xgAway, result.awayXg, result.expectedAwayGoals);
    const targetHome = xgHome ?? result.homeGoals;
    const targetAway = xgAway ?? result.awayGoals;
    const xgDistance = (xgHome===null || xgAway===null)
      ? 0
      : (Math.abs(result.homeGoals - xgHome) + Math.abs(result.awayGoals - xgAway)) / 2;
    const xgTrust = xgHome===null || xgAway===null ? 1 : clamp(1 - xgDistance*0.12, 0.65, 1.05);

    const lrEffectiveLeague = lrLeague * (0.5 + confidence) * recencyWeight * xgTrust;
    const lrEffectiveTeam = lrTeam * (0.5 + confidence) * recencyWeight * xgTrust;

    const ratioHome = clamp((targetHome + 0.25) / Math.max(0.25, prediction.lambdaHome), 0.75, 1.25);
    const ratioAway = clamp((targetAway + 0.25) / Math.max(0.25, prediction.lambdaAway), 0.75, 1.25);
    leagueScale.home = clamp(leagueScale.home * (1 - lrEffectiveLeague + lrEffectiveLeague * ratioHome), 0.75, 1.35);
    leagueScale.away = clamp(leagueScale.away * (1 - lrEffectiveLeague + lrEffectiveLeague * ratioAway), 0.75, 1.35);
    db.learning.leagueScale[leagueId] = leagueScale;

    const actual = result.homeGoals===result.awayGoals ? "draw" : result.homeGoals>result.awayGoals ? "home" : "away";
    const predictedWinner = prediction.pHome>=prediction.pDraw && prediction.pHome>=prediction.pAway
      ? "home"
      : prediction.pDraw>=prediction.pAway
        ? "draw"
        : "away";
    const missExtreme = (actual!==predictedWinner) && Math.max(prediction.pHome, prediction.pDraw, prediction.pAway) > 0.58;
    const hitFlat = (actual===predictedWinner) && Math.max(prediction.pHome, prediction.pDraw, prediction.pAway) < 0.44;
    const temperatureAfter = clamp(
      temperatureBefore
      + (missExtreme ? 0.03 : 0)
      - (hitFlat ? 0.02 : 0),
      0.7,
      1.6
    );
    db.learning.temperatureByLeague[leagueId] = temperatureAfter;

    const homeBiasBefore = getTeamBias(db, prediction.homeId);
    const awayBiasBefore = getTeamBias(db, prediction.awayId);
    const homeBias = { ...homeBiasBefore };
    const awayBias = { ...awayBiasBefore };
    const homeErr = clamp(targetHome - prediction.lambdaHome, -1.6, 1.6);
    const awayErr = clamp(targetAway - prediction.lambdaAway, -1.6, 1.6);

    homeBias.attack = clamp(homeBias.attack + homeErr * lrEffectiveTeam * 0.09, -0.35, 0.35);
    homeBias.defense = clamp(homeBias.defense - awayErr * lrEffectiveTeam * 0.06, -0.35, 0.35);
    awayBias.attack = clamp(awayBias.attack + awayErr * lrEffectiveTeam * 0.09, -0.35, 0.35);
    awayBias.defense = clamp(awayBias.defense - homeErr * lrEffectiveTeam * 0.06, -0.35, 0.35);

    db.learning.teamBias[prediction.homeId] = homeBias;
    db.learning.teamBias[prediction.awayId] = awayBias;

    const pActual = actual==="home" ? prediction.pHome : actual==="draw" ? prediction.pDraw : prediction.pAway;
    const logLoss = -Math.log(Math.max(1e-9, pActual));
    const brier = ((prediction.pHome - (actual==="home" ? 1 : 0))**2
      + (prediction.pDraw - (actual==="draw" ? 1 : 0))**2
      + (prediction.pAway - (actual==="away" ? 1 : 0))**2) / 3;

    db.learning.metrics.global = updateMetricState(db.learning.metrics.global, {
      logLoss,
      brier,
      errHome: result.homeGoals - prediction.lambdaHome,
      errAway: result.awayGoals - prediction.lambdaAway
    });
    db.learning.metrics.byLeague[leagueId] = updateMetricState(db.learning.metrics.byLeague[leagueId], {
      logLoss,
      brier,
      errHome: result.homeGoals - prediction.lambdaHome,
      errAway: result.awayGoals - prediction.lambdaAway
    });

    db.learning.trainingSet.push({
      id: prediction.id,
      matchId: prediction.matchKey || prediction.id,
      timestamp: new Date().toISOString(),
      teams: { homeId: prediction.homeId, awayId: prediction.awayId },
      leagueId,
      features: {
        leagueBase: prediction.breakdown?.leagueBase || null,
        homeAdv: prediction.features?.homeAdv ?? null,
        xGdiff: (prediction.lambdaHome || 0) - (prediction.lambdaAway || 0),
        momentum5: prediction.features?.formMomentum || null,
        marketProbs: prediction.pMarket || null,
        notesFlags: result.flags || null
      },
      pred: {
        pModel: prediction.pModel || null,
        pFinal: prediction.pFinal || { pH: prediction.pHome, pD: prediction.pDraw, pA: prediction.pAway },
        lambdaHome: prediction.lambdaHome,
        lambdaAway: prediction.lambdaAway
      },
      label: {
        outcome: actual,
        score: { homeGoals: result.homeGoals, awayGoals: result.awayGoals },
        reading: result.reading || null
      }
    });
    if(db.learning.trainingSet.length > 400) db.learning.trainingSet = db.learning.trainingSet.slice(-400);

    return {
      homeErr,
      awayErr,
      logLoss,
      brier,
      confidence,
      lrEffectiveLeague,
      lrEffectiveTeam,
      leagueScale,
      leagueScaleBefore,
      temperatureBefore,
      temperatureAfter,
      homeBias,
      awayBias,
      homeBiasBefore,
      awayBiasBefore,
      metricsGlobal: db.learning.metrics.global,
      metricsLeague: db.learning.metrics.byLeague[leagueId]
    };
  }

  function calibrateToMarket(base, marketProb, modelProb){
    if(!Number.isFinite(marketProb) || !Number.isFinite(modelProb) || !modelProb || !base) return base;
    const ratio = clamp(marketProb/modelProb, 0.82, 1.22);
    return base * ratio;
  }

  function probsFromLambdas(lHome, lAway, maxGoals=5){
    const matrix = [];
    let pHome=0,pDraw=0,pAway=0,pTotal=0;
    let best = { h:0, a:0, p:0 };
    for(let h=0;h<=maxGoals;h++){
      const row = [];
      for(let a=0;a<=maxGoals;a++){
        const p = poisson(lHome,h) * poisson(lAway,a);
        row.push(p);
        pTotal += p;
        if(h>a) pHome += p;
        if(h===a) pDraw += p;
        if(h<a) pAway += p;
        if(p>best.p) best = { h, a, p };
      }
      matrix.push(row);
    }
    if(pTotal>0){
      pHome /= pTotal;
      pDraw /= pTotal;
      pAway /= pTotal;
      best.p /= pTotal;
      for(let h=0;h<=maxGoals;h++){
        for(let a=0;a<=maxGoals;a++) matrix[h][a] /= pTotal;
      }
    }
    return { matrix, pHome, pDraw, pAway, maxGoals, best };
  }

  function computeB3TeamRatings(db, teamId, leagueId, side="home", limit=20){
    const leagueCtx = leagueContextFromTracker(db, leagueId);
    const data = teamAnalytics(db, teamId, leagueId, limit);
    const games = db.tracker
      .filter(g=>(g.homeId===teamId || g.awayId===teamId) && (!leagueId || g.leagueId===leagueId))
      .slice(-limit);

    const statAvg = (keys, mode="for")=>{
      const values = games.map(g=>{
        const isHome = g.homeId===teamId;
        const ownSide = isHome ? "home" : "away";
        const oppSide = isHome ? "away" : "home";
        return metricFromStats(g.stats, keys, mode==="for" ? ownSide : oppSide);
      }).filter(v=>Number.isFinite(v));
      if(!values.length) return null;
      return values.reduce((a,b)=>a+b,0)/values.length;
    };

    const xgFor = side==="home" ? data.xgHome.for : data.xgAway.for;
    const xgAgainst = side==="home" ? data.xgHome.against : data.xgAway.against;
    const goalsForBase = side==="home" ? data.goalsHome.for : data.goalsAway.for;
    const goalsAgainstBase = side==="home" ? data.goalsHome.against : data.goalsAway.against;
    const leagueFor = side==="home" ? leagueCtx.avgGoalsHome : leagueCtx.avgGoalsAway;
    const leagueAgainst = side==="home" ? leagueCtx.avgGoalsAway : leagueCtx.avgGoalsHome;

    const sotFor = statAvg(["shots on target", "tiros a puerta", "remates a puerta"], "for");
    const sotAgainst = statAvg(["shots on target", "tiros a puerta", "remates a puerta"], "against");
    const boxTouches = statAvg(["touches in opposition box", "toques en area rival", "penalty area entries", "attacks in box"], "for");
    const errorsAgainst = statAvg(["errors leading to shot", "errors leading to goal", "errores conducentes", "errores que terminan"], "for");

    const atkXg = clamp((xgFor || goalsForBase || leagueFor) / Math.max(0.35, leagueFor), 0.7, 1.3);
    const atkSot = Number.isFinite(sotFor) ? clamp(sotFor / 4.6, 0.7, 1.3) : 1;
    const atkTouches = Number.isFinite(boxTouches) ? clamp(boxTouches / 24, 0.7, 1.3) : 1;
    const defXg = clamp((xgAgainst || goalsAgainstBase || leagueAgainst) / Math.max(0.35, leagueAgainst), 0.7, 1.3);
    const defSot = Number.isFinite(sotAgainst) ? clamp(sotAgainst / 4.4, 0.7, 1.3) : 1;
    const defErrors = Number.isFinite(errorsAgainst) ? clamp(0.9 + errorsAgainst * 0.18, 0.7, 1.3) : 1;

    const attack = clamp(0.55*atkXg + 0.25*atkSot + 0.20*atkTouches, 0.7, 1.3);
    const defenseWeakness = clamp(0.60*defXg + 0.30*defSot + 0.10*defErrors, 0.7, 1.3);
    const availableSignals = [xgFor, xgAgainst, sotFor, sotAgainst, boxTouches].filter(v=>Number.isFinite(v)).length;
    const completeness = clamp(availableSignals / 5, 0, 1);
    const form = data.form5 || { played: 0, points: 0 };
    const consistency = clamp(0.45 + ((form.points / Math.max(1, form.played*3)) * 0.55), 0, 1);
    return { attack, defenseWeakness, completeness, consistency, samples: data.sample || 0 };
  }

  function computeTrainingStats(teamMatches=[]){
    const matches = Array.isArray(teamMatches) ? teamMatches : [];
    const totalMatches = matches.length;

    const hasStats = (m)=>{
      if(Array.isArray(m?.stats)) return m.stats.length > 0;
      return !!m?.stats && m.stats.kind === "match_stats";
    };
    const hasXgInSections = (sections=[])=>{
      if(!Array.isArray(sections)) return false;
      return sections.some(sec=>(sec?.stats || []).some(st=>String(st?.category || st?.key || "").toLowerCase().includes("xg")));
    };
    const hasXgMetric = (m)=>{
      const fromTop = [m?.homeXg, m?.awayXg, m?.xgHome, m?.xgAway].some(v=>Number.isFinite(Number(v)));
      if(fromTop) return true;
      if(Array.isArray(m?.stats)){
        return m.stats.some(st=>String(st?.key || st?.category || "").toLowerCase().includes("xg"));
      }
      return hasXgInSections(m?.stats?.sections);
    };

    const withStats = matches.filter(hasStats).length;
    const withXG = matches.filter(hasXgMetric).length;
    const withNarrative = matches.filter(m=>typeof m?.storyRaw === "string" && m.storyRaw.trim().length > 50).length;

    const completeness = clamp01(
      0.55 * (withStats / Math.max(1, totalMatches))
      + 0.35 * (withXG / Math.max(1, totalMatches))
      + 0.10 * (withNarrative / Math.max(1, totalMatches))
    );

    return {
      totalMatches,
      withStats,
      withXG,
      withNarrative,
      completeness
    };
  }

  function dynamicConfMax(samples){
    if(samples < 30) return 0.55;
    if(samples < 80) return 0.70;
    return 0.85;
  }

  function computeMomentumAdj(intel={}, oppIntel={}){
    const self = clamp((Number(intel?.metrics?.momentum5) || 0.5) - 0.5, -0.5, 0.5);
    const opp = clamp((Number(oppIntel?.metrics?.momentum5) || 0.5) - 0.5, -0.5, 0.5);
    return clamp((self - opp) * 0.16, -0.08, 0.08);
  }

  function computeB3Confidence({ samples=0, completeness=0, consistency01=0 }={}){
    let confSamples;
    if(samples < 5) confSamples = 0.25;
    else if(samples < 10) confSamples = 0.35;
    else if(samples < 20) confSamples = 0.45;
    else if(samples < 35) confSamples = 0.55;
    else if(samples < 60) confSamples = 0.65;
    else confSamples = 0.75;

    const confData = 0.65 + 0.35 * clamp01(completeness);
    const confCons = 0.70 + 0.30 * clamp01(consistency01);
    let conf = confSamples * confData * confCons;
    conf = Math.min(conf, dynamicConfMax(samples));
    conf = Math.max(conf, 0.20);
    return conf;
  }

  function computeGlobalTrainingSize(allTeams=[], tracker=[]){
    const teamIds = new Set((allTeams || []).map(t=>t.id));
    const matches = Array.isArray(tracker)
      ? tracker.filter(m=>teamIds.has(m?.homeId) || teamIds.has(m?.awayId))
      : [];
    const stats = computeTrainingStats(matches);
    return { matches: stats.totalMatches, withStats: stats.withStats, withXG: stats.withXG };
  }

  function blend1x2Probs(model, market, confidence){
    if(!market) return { ...model };
    return {
      pH: confidence*model.pH + (1-confidence)*market.pH,
      pD: confidence*model.pD + (1-confidence)*market.pD,
      pA: confidence*model.pA + (1-confidence)*market.pA
    };
  }

  function applyDrawBoostToLambdas(lHome, lAway, drawBoost=0){
    const boost = clamp(Number(drawBoost) || 0, -0.04, 0.04);
    if(Math.abs(boost) < 1e-6) return { lHome, lAway };
    const avg = (lHome + lAway) / 2;
    const closeness = boost >= 0 ? (1 - boost*1.25) : (1 + Math.abs(boost)*1.1);
    return {
      lHome: clamp(avg + (lHome - avg) * closeness, 0.05, 4.5),
      lAway: clamp(avg + (lAway - avg) * closeness, 0.05, 4.5)
    };
  }

  function adjustLambdasToMatchProbs(baseLambdas, target, maxGoals=5){
    let lHome = clamp(baseLambdas.lHome, 0.05, 4.5);
    let lAway = clamp(baseLambdas.lAway, 0.05, 4.5);
    for(let i=0;i<16;i++){
      const p = probsFromLambdas(lHome, lAway, maxGoals);
      const sideErr = ((target.pH - target.pA) - (p.pHome - p.pAway));
      const drawErr = (target.pD - p.pDraw);
      const tilt = Math.exp(clamp(sideErr * 0.65, -0.25, 0.25));
      lHome = clamp(lHome * tilt, 0.05, 4.5);
      lAway = clamp(lAway / tilt, 0.05, 4.5);
      const total = (lHome + lAway) * Math.exp(clamp(-drawErr * 0.55, -0.18, 0.18));
      const shareHome = lHome / Math.max(0.1, lHome + lAway);
      lHome = clamp(total * shareHome, 0.05, 4.5);
      lAway = clamp(total * (1-shareHome), 0.05, 4.5);
      const closeness = 1 - clamp(drawErr * 0.5, -0.16, 0.16);
      const avg = (lHome + lAway)/2;
      lHome = clamp(avg + (lHome - avg)*closeness, 0.05, 4.5);
      lAway = clamp(avg + (lAway - avg)*closeness, 0.05, 4.5);
    }
    return { lHome, lAway };
  }

  function applyVolatilityToMatrix(matrix, volatility=1){
    const vol = clamp(Number(volatility) || 1, 0.9, 1.2);
    if(Math.abs(vol - 1) < 0.01) return matrix;
    const gamma = clamp(1 / vol, 0.78, 1.15);
    let sum = 0;
    const transformed = matrix.map(row=>row.map(cell=>{
      const v = Math.pow(Math.max(1e-9, cell), gamma);
      sum += v;
      return v;
    }));
    if(sum<=0) return matrix;
    return transformed.map(row=>row.map(cell=>cell/sum));
  }

  function getTeamDnaSnapshotBlend(db, teamId, horizon=6){
    const matches = (db.tracker || [])
      .filter((m)=>(m.homeId===teamId || m.awayId===teamId))
      .slice()
      .sort(compareByDateAsc)
      .slice(-clamp(Number(horizon) || 6, 3, 20));
    const rows = matches
      .map((m)=>normalizeFeatureSchema(m?.featureSnapshots?.[teamId] || {}))
      .filter((f)=>f && (f.pulse>0 || f.aggression>0 || f.resilience>0 || Math.abs(f.momentum)>0));
    if(!rows.length){
      const brainRows = getTeamBrainFeatures(teamId).map((row)=>normalizeFeatureSchema(row?.features || {}));
      if(brainRows.length) rows.push(...brainRows);
    }
    const avg = (arr, fallback)=>arr.length ? arr.reduce((acc,v)=>acc + v, 0) / arr.length : fallback;
    return {
      pulse: avg(rows.map((f)=>f.pulse), 50),
      aggression: avg(rows.map((f)=>f.aggression), 50),
      resilience: avg(rows.map((f)=>f.resilience), 50),
      volatility: avg(rows.map((f)=>f.volatility), 50),
      momentum: avg(rows.map((f)=>f.momentum), 0),
      sample: rows.length
    };
  }

  function dnaStrengthFromSnapshot(dna){
    const pulseN = clamp((Number(dna?.pulse) || 50) / 100, 0, 1);
    const aggressionN = clamp((Number(dna?.aggression) || 50) / 100, 0, 1);
    const momentumN = clamp(((Number(dna?.momentum) || 0) + 1) / 2, 0, 1);
    const resilienceN = clamp((Number(dna?.resilience) || 50) / 100, 0, 1);
    const volatilityN = clamp((Number(dna?.volatility) || 50) / 100, 0, 1);
    const attackStrength = clamp(0.7 + (0.4*pulseN + 0.3*aggressionN + 0.3*momentumN) * 0.75, 0.72, 1.45);
    const defenseStrength = clamp(0.7 + (resilienceN - volatilityN*0.55 + 0.35) * 0.55, 0.65, 1.35);
    const defenseWeakness = clamp(2.02 - defenseStrength, 0.72, 1.5);
    return { attackStrength, defenseStrength, defenseWeakness };
  }

  function applyChaosToMatrix(matrix, chaos=0){
    const chaosN = clamp(Number(chaos) || 0, 0, 1);
    if(chaosN < 0.42) return matrix;
    const targetsBoost = new Set(["3-2", "2-3", "3-3"]);
    const targetsCut = new Set(["1-0", "0-1"]);
    let sum = 0;
    const adjusted = matrix.map((row,h)=>row.map((cell,a)=>{
      const key = `${h}-${a}`;
      let w = 1;
      if(targetsBoost.has(key)) w += chaosN * 0.48;
      if(targetsCut.has(key)) w -= chaosN * 0.26;
      if((h+a)>=5) w += chaosN * 0.1;
      const v = Math.max(1e-9, cell * clamp(w, 0.55, 1.8));
      sum += v;
      return v;
    }));
    return sum>0 ? adjusted.map(row=>row.map(cell=>cell/sum)) : matrix;
  }

  function versusModel(db, homeId, awayId, opts={}){
    ensureLearningState(db);
    db.versus ||= {};
    db.versus.tableContext ||= {};
    const homeTeam = db.teams.find(t=>t.id===homeId);
    const awayTeam = db.teams.find(t=>t.id===awayId);
    const leagueId = opts.leagueId || homeTeam?.leagueId || awayTeam?.leagueId || "";
    const marketOdds = opts.marketOdds || null;
    const virtualMatch = { id: `sim_${homeId}_${awayId}`, homeId, awayId, leagueId, date: opts.matchDate || new Date().toISOString().slice(0,10), oddsHome: marketOdds?.oddH, oddsDraw: marketOdds?.oddD, oddsAway: marketOdds?.oddA };
    const marketStrengthProbs = marketOdds ? clean1x2Probs(marketOdds.oddH, marketOdds.oddD, marketOdds.oddA) : null;
    const homeOppStrength = buildOpponentStrengthSnapshot({ db, match: virtualMatch, teamId: homeId, venue: "H", marketOdds: marketStrengthProbs, matchDate: virtualMatch.date });
    const awayOppStrength = buildOpponentStrengthSnapshot({ db, match: virtualMatch, teamId: awayId, venue: "A", marketOdds: marketStrengthProbs, matchDate: virtualMatch.date });

    const leagueCtx = leagueContextFromTracker(db, leagueId);
    const homeForm = teamFormFromTracker(db, homeId);
    const awayForm = teamFormFromTracker(db, awayId);
    const homeData = teamAnalytics(db, homeId, leagueId, Number(db.versus.sampleSize)||20);
    const awayData = teamAnalytics(db, awayId, leagueId, Number(db.versus.sampleSize)||20);

    const homeStrength = teamStrength(db, homeId);
    const awayStrength = teamStrength(db, awayId);
    const homeAdv = Number(db.versus.homeAdvantage)||1.1;
    const pace = clamp(Number(db.versus.paceFactor)||1, 0.82, 1.35);
    const leagueScale = getLeagueScale(db, leagueId);
    const homeBias = getTeamBias(db, homeId);
    const awayBias = getTeamBias(db, awayId);

    const baseHomeFor = homeData.xgHome.for>0 ? homeData.xgHome.for : homeData.goalsHome.for;
    const baseHomeAgainst = homeData.xgHome.against>0 ? homeData.xgHome.against : homeData.goalsHome.against;
    const baseAwayFor = awayData.xgAway.for>0 ? awayData.xgAway.for : awayData.goalsAway.for;
    const baseAwayAgainst = awayData.xgAway.against>0 ? awayData.xgAway.against : awayData.goalsAway.against;

    const attackHome = clamp((baseHomeFor || leagueCtx.avgGoalsHome) / Math.max(0.35, leagueCtx.avgGoalsHome), 0.55, 1.9);
    const defenseAwayWeakness = clamp((baseAwayAgainst || leagueCtx.avgGoalsHome) / Math.max(0.35, leagueCtx.avgGoalsHome), 0.55, 1.9);
    const attackAway = clamp((baseAwayFor || leagueCtx.avgGoalsAway) / Math.max(0.35, leagueCtx.avgGoalsAway), 0.55, 1.9);
    const defenseHomeWeakness = clamp((baseHomeAgainst || leagueCtx.avgGoalsAway) / Math.max(0.35, leagueCtx.avgGoalsAway), 0.55, 1.9);

    const homeDna = getTeamDnaSnapshotBlend(db, homeId, Number(db.versus.sampleSize)||20);
    const awayDna = getTeamDnaSnapshotBlend(db, awayId, Number(db.versus.sampleSize)||20);
    const dnaHomeStrength = dnaStrengthFromSnapshot(homeDna);
    const dnaAwayStrength = dnaStrengthFromSnapshot(awayDna);
    const tempoFactor = clamp(pace * (0.94 + ((homeDna.momentum + awayDna.momentum + 2) / 4) * 0.16), 0.78, 1.35);
    const awayAdjustment = clamp(1 - ((homeAdv - 1) * 0.32), 0.88, 1.04);

    let lHome = leagueCtx.avgGoalsHome * attackHome * defenseAwayWeakness * dnaHomeStrength.attackStrength * dnaAwayStrength.defenseWeakness * homeAdv * tempoFactor;
    let lAway = leagueCtx.avgGoalsAway * attackAway * defenseHomeWeakness * dnaAwayStrength.attackStrength * dnaHomeStrength.defenseWeakness * awayAdjustment * tempoFactor;

    lHome *= leagueScale.home * (1 + homeBias.attack) * (1 - awayBias.defense);
    lAway *= leagueScale.away * (1 + awayBias.attack) * (1 - homeBias.defense);

    const statsHome = homeData.statsImpact || { attack: 1, defenseWeakness: 1, sample: 0 };
    const statsAway = awayData.statsImpact || { attack: 1, defenseWeakness: 1, sample: 0 };

    lHome *= homeStrength * homeForm.momentum;
    lAway *= awayStrength * awayForm.momentum;

    lHome *= statsHome.attack * statsAway.defenseWeakness;
    lAway *= statsAway.attack * statsHome.defenseWeakness;

    const qualityDiff = clamp((awayOppStrength?.blend?.strength01 || 0.5) - (homeOppStrength?.blend?.strength01 || 0.5), -0.5, 0.5);
    const qualityTilt = Math.exp(qualityDiff * 0.55);
    lHome *= qualityTilt;
    lAway /= qualityTilt;

    ensureDiagProfileState(db);
    const homeProfile = db.diagProfiles?.[homeId];
    const awayProfile = db.diagProfiles?.[awayId];
    if(homeProfile && awayProfile){
      const ht = homeProfile.traits || {};
      const at = awayProfile.traits || {};
      const attackPowerHome = 0.45*(Number(ht.territorial_strength)||0.5) + 0.35*(Number(ht.chance_creation)||0.5) + 0.2*(Number(ht.finishing_quality)||0.5);
      const attackPowerAway = 0.45*(Number(at.territorial_strength)||0.5) + 0.35*(Number(at.chance_creation)||0.5) + 0.2*(Number(at.finishing_quality)||0.5);
      const defensePowerHome = 0.55*(Number(ht.transition_defense)||0.5) + 0.45*(Number(ht.low_block_execution)||0.5);
      const defensePowerAway = 0.55*(Number(at.transition_defense)||0.5) + 0.45*(Number(at.low_block_execution)||0.5);
      const matchupHome = clamp(0.85 + attackPowerHome*0.4 - defensePowerAway*0.25, 0.7, 1.3);
      const matchupAway = clamp(0.85 + attackPowerAway*0.4 - defensePowerHome*0.25, 0.7, 1.3);
      const transitionShockHome = clamp((Number(ht.transition_attack)||0.5) - (Number(at.transition_defense)||0.5), -0.35, 0.35);
      const transitionShockAway = clamp((Number(at.transition_attack)||0.5) - (Number(ht.transition_defense)||0.5), -0.35, 0.35);
      lHome *= matchupHome * (1 + transitionShockHome*0.2);
      lAway *= matchupAway * (1 + transitionShockAway*0.2);
    }

    const homeMomentumProfileRaw = homeTeam?.name ? localStorage.getItem(`team_profile_${homeTeam.name}`) : null;
    const awayMomentumProfileRaw = awayTeam?.name ? localStorage.getItem(`team_profile_${awayTeam.name}`) : null;
    let homeMomentum = null;
    let awayMomentum = null;
    try{ homeMomentum = homeMomentumProfileRaw ? JSON.parse(homeMomentumProfileRaw) : null; }catch(_e){ homeMomentum = null; }
    try{ awayMomentum = awayMomentumProfileRaw ? JSON.parse(awayMomentumProfileRaw) : null; }catch(_e){ awayMomentum = null; }
    if(homeMomentum?.simulation && awayMomentum?.simulation){
      const homeAttack = clamp(Number(homeMomentum.simulation.attack_power) || 0.5, 0, 1.5);
      const awayAttack = clamp(Number(awayMomentum.simulation.attack_power) || 0.5, 0, 1.5);
      const homeDefense = clamp(Number(homeMomentum.simulation.defense_power) || 0.5, 0, 1.2);
      const awayDefense = clamp(Number(awayMomentum.simulation.defense_power) || 0.5, 0, 1.2);
      const homeShock = clamp(Number(homeMomentum.momentumSignature?.shock_goals) || 0, 0, 1);
      const awayShock = clamp(Number(awayMomentum.momentumSignature?.shock_goals) || 0, 0, 1);
      lHome *= clamp(0.85 + homeAttack*(1-awayDefense), 0.78, 1.3) * (1 + homeShock*0.08);
      lAway *= clamp(0.85 + awayAttack*(1-homeDefense), 0.78, 1.3) * (1 + awayShock*0.08);
    }

    const homeIntel = computeTeamIntelligencePanel(db, homeId);
    const awayIntel = computeTeamIntelligencePanel(db, awayId);
    const attackVsDefenseHome = clamp((homeIntel.prediction.offenseRating - awayIntel.prediction.defenseRating) / 100, -0.35, 0.35);
    const attackVsDefenseAway = clamp((awayIntel.prediction.offenseRating - homeIntel.prediction.defenseRating) / 100, -0.35, 0.35);
    const psychBoostHome = clamp((homeIntel.prediction.psychIndex - awayIntel.prediction.psychIndex) / 260, -0.22, 0.22);
    const psychBoostAway = clamp((awayIntel.prediction.psychIndex - homeIntel.prediction.psychIndex) / 260, -0.22, 0.22);
    const momentumWeightHome = clamp(((homeIntel.metrics.momentum5 || 0.5) - (awayIntel.metrics.momentum5 || 0.5)) * 0.22, -0.16, 0.16);
    const momentumWeightAway = clamp(((awayIntel.metrics.momentum5 || 0.5) - (homeIntel.metrics.momentum5 || 0.5)) * 0.22, -0.16, 0.16);
    const homeBoost = clamp((Number(engineForTeam(db, homeId)?.haTraits?.homeBoost) || 0) * 0.08, -0.12, 0.16);
    const awayTravelPenalty = clamp((Number(engineForTeam(db, awayId)?.haTraits?.travelTilt) || 0) * 0.06, -0.12, 0.14);

    lHome *= clamp(1 + attackVsDefenseHome + psychBoostHome + momentumWeightHome + homeBoost - awayTravelPenalty, 0.7, 1.42);
    lAway *= clamp(1 + attackVsDefenseAway + psychBoostAway + momentumWeightAway, 0.7, 1.35);

    lHome = clamp(lHome, 0.05, 4.5);
    lAway = clamp(lAway, 0.05, 4.5);

    const tableContextRaw = db.versus.tableContext || {};
    const matchday = clamp(Number(opts.matchday ?? db.versus.matchday ?? 20) || 20, 1, 50);
    const homeContext = tableContextForTeam({ teamContext: tableContextRaw[homeId], matchday, isHome: true });
    const awayContext = tableContextForTeam({ teamContext: tableContextRaw[awayId], matchday, isHome: false });
    const trust = clamp(Number(opts.tableContextTrust ?? db.versus.tableContextTrust ?? 0.45) || 0.45, 0, 1);
    const drawBoostBase = ((homeContext.pressure + awayContext.pressure) / 2) * 0.14
      + (Math.max(0, -homeContext.riskMode) + Math.max(0, -awayContext.riskMode)) * 0.08;
    const drawBoost = clamp(drawBoostBase * trust, 0, 0.25);

    const matchChaos = clamp((homeIntel.psych.volatility + awayIntel.psych.volatility + homeIntel.psych.aggressiveness + awayIntel.psych.aggressiveness) / 400, 0, 1);
    const dist = probsFromLambdas(lHome, lAway, 5);
    dist.matrix = applyDrawBoostToMatrix(dist.matrix, drawBoost);
    dist.matrix = applyChaosToMatrix(dist.matrix, matchChaos);
    const distSummary = summarizeMatrix(dist.matrix);
    dist.pHome = distSummary.pHome;
    dist.pDraw = distSummary.pDraw;
    dist.pAway = distSummary.pAway;
    dist.best = distSummary.best;

    const cardsExpected = clamp((homeData.cardsRate + awayData.cardsRate + leagueCtx.avgCardsTotal)/2, 1.8, 8.8);
    const cornersExpected = clamp(
      (homeData.cornersFor + awayData.cornersAgainst + homeData.cornersAgainst + awayData.cornersFor + leagueCtx.avgCornersTotal) / 3,
      5.5,
      15.5
    );

    return {
      lHome,
      lAway,
      pHome: dist.pHome,
      pDraw: dist.pDraw,
      pAway: dist.pAway,
      matrix: dist.matrix,
      maxGoals: dist.maxGoals,
      best: dist.best,
      cardsExpected,
      cornersExpected,
      leagueCtx,
      teams: { homeData, awayData },
      factors: {
        homeForm,
        awayForm,
        pace,
        homeAdv,
        attackHome,
        attackAway,
        defenseAwayWeakness,
        defenseHomeWeakness,
        leagueScale,
        teamBias: { homeBias, awayBias },
        breakdown: {
          leagueBase: { home: leagueCtx.avgGoalsHome, away: leagueCtx.avgGoalsAway },
          homeAttackBoost: attackHome,
          awayDefenseWeakness: defenseAwayWeakness,
          awayAttackPenalty: attackAway,
          marketMultiplier: 1,
          homeDefenseStrength: defenseHomeWeakness,
          homeFormMomentum: homeForm.momentum,
          awayFormMomentum: awayForm.momentum,
          statsAttackHome: statsHome.attack,
          statsAttackAway: statsAway.attack,
          statsSample: { home: statsHome.sample, away: statsAway.sample },
          tableFactorGoals: {
            homeRisk: homeContext.riskMode,
            awayRisk: awayContext.riskMode,
            homePressure: homeContext.pressure,
            awayPressure: awayContext.pressure,
            matchday
          },
          drawBoost,
          tableContextTrust: trust,
          leagueScale,
          teamBias: { home: homeBias, away: awayBias },
          intelligenceBlend: {
            home: homeIntel.prediction,
            away: awayIntel.prediction,
            attackVsDefenseHome,
            attackVsDefenseAway,
            psychBoostHome,
            psychBoostAway,
            momentumWeightHome,
            momentumWeightAway,
            matchChaos
          },
          opponentStrength: {
            homeOpponent: homeOppStrength,
            awayOpponent: awayOppStrength,
            qualityDiff,
            qualityTilt
          },
          dna: {
            home: { ...homeDna, ...dnaHomeStrength },
            away: { ...awayDna, ...dnaAwayStrength },
            tempoFactor,
            awayAdjustment
          }
        }
      },
      tableContext: { home: homeContext, away: awayContext, drawBoost, matchday, trust },
      chaos: matchChaos
    };
  }

  function sanitizeFiniteNumber(value, fallback){
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeLearning(rawLearning){
    const learning = rawLearning && typeof rawLearning === "object" ? structuredClone(rawLearning) : {};
    learning.schemaVersion = Number(learning.schemaVersion) || 2;
    learning.leagueScale ||= {};
    learning.teamBias ||= {};
    learning.temperatureByLeague ||= {};
    learning.trainingSet ||= [];
    learning.metrics ||= { global: null, byLeague: {} };
    learning.metrics.byLeague ||= {};
    learning.marketTrust = clamp(sanitizeFiniteNumber(learning.marketTrust, 0.35), 0, 0.85);
    learning.lrLeague = clamp(sanitizeFiniteNumber(learning.lrLeague, 0.12), 0.01, 0.35);
    learning.lrTeam = clamp(sanitizeFiniteNumber(learning.lrTeam, 0.08), 0.01, 0.25);
    Object.keys(learning.leagueScale).forEach((leagueId)=>{
      const item = learning.leagueScale[leagueId] || {};
      learning.leagueScale[leagueId] = {
        home: clamp(sanitizeFiniteNumber(item.home, 1), 0.75, 1.35),
        away: clamp(sanitizeFiniteNumber(item.away, 1), 0.75, 1.35)
      };
    });
    Object.keys(learning.teamBias).forEach((teamId)=>{
      const item = learning.teamBias[teamId] || {};
      learning.teamBias[teamId] = {
        attack: clamp(sanitizeFiniteNumber(item.attack, 0), -0.35, 0.35),
        defense: clamp(sanitizeFiniteNumber(item.defense, 0), -0.35, 0.35)
      };
    });
    Object.keys(learning.temperatureByLeague).forEach((leagueId)=>{
      learning.temperatureByLeague[leagueId] = clamp(sanitizeFiniteNumber(learning.temperatureByLeague[leagueId], 1), 0.7, 1.6);
    });
    if(Array.isArray(learning.trainingSet)) learning.trainingSet = learning.trainingSet.slice(-400);
    return learning;
  }

  function normalizeImport(raw){
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const root = data?.liga ? data : data?.league ? { liga: data.league, ...data } : data;
    const league = root?.liga || root?.league;
    if(!league) throw new Error("JSON inválido: falta liga/league");

    const leagueName = league.name || league.nombre || "Liga importada";
    const leagueCode = league.code || league.codigo || "";
    const leagueId = league.id ? String(league.id) : uid("lg");
    const leagueType = normalizeCompetitionType(league.type || league.tipo || "league");

    const teamsSrc = league.equipos || league.teams || [];
    const teams = teamsSrc.map(t=>([
      {
        id: t.id ? String(t.id) : uid("tm"),
        name: t.name || t.nombre || "Equipo",
        apiTeamId: t.apiTeamId ? String(t.apiTeamId) : "",
        leagueId
      },
      (t.jugadores || t.players || []).map(p=>({
        id: p.id ? String(p.id) : uid("pl"),
        name: p.name || p.nombre || "Jugador",
        teamId: t.id ? String(t.id) : null,
        pos: p.pos || p.position || "",
        rating: clamp(sanitizeFiniteNumber(p.rating, 5), 1, 10)
      }))
    ]));

    const flatTeams = teams.map(x=>x[0]);
    const players = teams.flatMap(x=>x[1].map(p=>({ ...p, teamId: p.teamId || x[0].id })));
    const predictions = Array.isArray(root.predictions) ? root.predictions.filter(Boolean).map((pred)=>({
      ...pred,
      id: pred.id || uid("pred"),
      createdAt: pred.createdAt || new Date().toISOString(),
      lambdaHome: clamp(sanitizeFiniteNumber(pred.lambdaHome, 1.2), 0.05, 4.5),
      lambdaAway: clamp(sanitizeFiniteNumber(pred.lambdaAway, 1), 0.05, 4.5),
      pHome: clamp(sanitizeFiniteNumber(pred.pHome, 0.33), 0, 1),
      pDraw: clamp(sanitizeFiniteNumber(pred.pDraw, 0.34), 0, 1),
      pAway: clamp(sanitizeFiniteNumber(pred.pAway, 0.33), 0, 1),
      resolved: Boolean(pred.resolved)
    })) : [];

    return {
      league: { id: leagueId, name: leagueName, code: leagueCode, type: leagueType },
      teams: flatTeams,
      players,
      tracker: Array.isArray(root.tracker) ? root.tracker : [],
      versus: root.versus || null,
      predictions,
      learning: normalizeLearning(root.learning)
    };
  }


  function sectionToPos(section){
    const sec = String(section||"").toLowerCase();
    if(sec.includes("portero")) return "GK";
    if(sec.includes("defensa")) return "DF";
    if(sec.includes("centrocamp") || sec.includes("medio")) return "MF";
    if(sec.includes("delanter")) return "FW";
    return "OT";
  }

  function normalizePlayerPos(pos){
    const token = String(pos||"").trim().toLowerCase();
    if(!token) return "OT";
    if(["gk","por","pt"].includes(token) || token.includes("portero") || token.includes("goalkeeper")) return "GK";
    if(["df","def"].includes(token) || token.includes("defensa") || token.includes("defender")) return "DF";
    if(["mf","mid"].includes(token) || token.includes("centrocamp") || token.includes("medio") || token.includes("midfielder")) return "MF";
    if(["fw","att","st","cf"].includes(token) || token.includes("delanter") || token.includes("forward") || token.includes("striker")) return "FW";
    return "OT";
  }

  function parseImportedSquadRow(row, fallbackPos){
    const flag = pickFirstString(row.flag, row.flagEmoji, row.countryFlag, row.nationalityFlag, row.country?.flag, row.nationality?.flag);
    return {
      name: String(row.name||"").trim(),
      pos: fallbackPos,
      rating: 5,
      number: pickFirstNumber(row.number, row.shirtNumber, row.shirt, row.jersey, row.dorsal, row["#"]),
      age: pickFirstNumber(row.age, row.edad),
      appearances: pickFirstNumber(row.appearances, row.apps, row.matches, row.matchesPlayed, row.partidos, row.titularidades),
      minutes: pickFirstNumber(row.minutes, row.min, row.minutos, row.playedMinutes),
      goals: pickFirstNumber(row.goals, row.goles),
      assists: pickFirstNumber(row.assists, row.asistencias),
      yellowCards: pickFirstNumber(row.yellowCards, row.yellow, row.amarillas, row.bookings),
      redCards: pickFirstNumber(row.redCards, row.red, row.rojas),
      flag
    };
  }

  function parseManualSquadText(raw){
    const tokens = String(raw||"")
      .split(/\r?\n/)
      .map((line)=>line.trim())
      .filter(Boolean);

    const isNumericToken = (value)=>/^-?\d+(?:[.,]\d+)?$/.test(String(value||"").trim());
    const toNumber = (value)=>{
      const n = Number(String(value).replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const isHeaderToken = (value)=>{
      const token = String(value||"").trim().toLowerCase();
      return ["#","name","nombre","edad","age","min","mins","minutos","pj","apps","goals","goles","a","asistencias","amarillas","rojas"].includes(token);
    };
    const isSectionToken = (value)=>{
      const token = String(value||"").trim().toLowerCase();
      return token.includes("portero") || token.includes("defensa") || token.includes("centrocamp") || token.includes("medio") || token.includes("delanter") || token.includes("otros");
    };
    const looksLikeName = (value)=>{
      const token = String(value||"").trim();
      if(!token || isHeaderToken(token) || isSectionToken(token) || isNumericToken(token)) return false;
      return /[\p{L}]/u.test(token);
    };

    const rows = [];
    let i = 0;
    let currentPos = "OT";
    while(i < tokens.length){
      const token = tokens[i];
      if(isSectionToken(token)){
        currentPos = sectionToPos(token);
        i += 1;
        continue;
      }
      if(isHeaderToken(token)){
        i += 1;
        continue;
      }

      let number = null;
      let name = "";
      if(isNumericToken(token) && looksLikeName(tokens[i+1])){
        number = toNumber(token);
        name = tokens[i+1];
        i += 2;
      }else if(looksLikeName(token)){
        name = token;
        i += 1;
      }else{
        i += 1;
        continue;
      }

      const numericFields = [];
      while(i < tokens.length && isNumericToken(tokens[i]) && numericFields.length < 7){
        const n = toNumber(tokens[i]);
        if(Number.isFinite(n)) numericFields.push(n);
        i += 1;
      }

      rows.push({
        name,
        pos: currentPos,
        rating: 5,
        number,
        age: numericFields[0] ?? null,
        appearances: numericFields[1] ?? null,
        minutes: numericFields[2] ?? null,
        goals: numericFields[3] ?? null,
        assists: numericFields[4] ?? null,
        yellowCards: numericFields[5] ?? null,
        redCards: numericFields[6] ?? null,
        flag: ""
      });
    }

    return rows.filter((row)=>row.name);
  }

  function renderSquadSection(title, players, playerHeatMap={}){
    const rows = players.map(pl=>`
      <div class="fl-squad-row">
        <div class="fl-squad-cell-center">${pl.number ?? "-"}</div>
        <div class="fl-squad-name">${pl.flag ? `<span class="fl-flag">${pl.flag}</span>` : ""}<span>${pl.name}</span></div>
        <div class="fl-squad-cell-center">
          <select class="fl-squad-pos-select" data-player-pos="${pl.id}">
            ${[["GK","Portero"],["DF","Defensa"],["MF","Centrocampista"],["FW","Delantero"],["OT","Otro"]].map(([key,label])=>`<option value="${key}" ${normalizePlayerPos(pl.pos)===key?"selected":""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="fl-squad-heat">
          <div class="fl-squad-heat-track"><div class="fl-squad-heat-fill" style="width:${clamp(Number(playerHeatMap[normalizePersonName(pl.name)]) || 50, 0, 100)}%;background:${psychHeatColor(playerHeatMap[normalizePersonName(pl.name)])};"></div></div>
          <div class="fl-mini" style="text-align:center">${Math.round(clamp(Number(playerHeatMap[normalizePersonName(pl.name)]) || 50, 0, 100))}</div>
        </div>
        <div class="fl-squad-cell-center">${pl.age ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.appearances ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.minutes ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.goals ?? 0}</div>
        <div class="fl-squad-cell-center">${pl.assists ?? 0}</div>
        <div class="fl-squad-cell-center">${pl.yellowCards ? pl.yellowCards : 0}</div>
        <div class="fl-squad-cell-center">${pl.redCards ? pl.redCards : 0}</div>
      </div>
    `).join("");

    return `
      <div class="fl-card">
        <div class="fl-squad-section-title">${title}</div>
        <div class="fl-squad-table">
          <div class="fl-squad-head">
            <div class="fl-squad-cell-center">#</div>
            <div>Nombre</div>
            <div class="fl-squad-cell-center">Pos</div>
            <div class="fl-squad-cell-center">Pulse</div>
            <div class="fl-squad-cell-center">Edad</div>
            <div class="fl-squad-cell-center">👕</div>
            <div class="fl-squad-cell-center">Min</div>
            <div class="fl-squad-cell-center">⚽</div>
            <div class="fl-squad-cell-center">A</div>
            <div class="fl-squad-cell-center"><span class="fl-card-yellow" title="Amarillas"></span></div>
            <div class="fl-squad-cell-center"><span class="fl-card-red" title="Rojas"></span></div>
          </div>
          ${rows || `<div class="fl-muted">Sin jugadores</div>`}
        </div>
      </div>
    `;
  }

  function render(view="home", payload={}){
    ensureStyles();
    const app = document.getElementById("app");
    if(!app) return;
    const db = loadDb();

    const tabs = ["home","liga","tracker","versus","brainv2","momentum","bitacora","market"];
    const nav = tabs.map(t=>`<button class="fl-btn ${view===t?"active":""}" data-tab="${t}">${t.toUpperCase()}</button>`).join("");

    app.innerHTML = `
      <div class="fl-wrap">
        <div class="fl-row fl-card">
          <div class="fl-title">⚽ Football Lab limpio</div>
          ${nav}
        </div>
        <div id="fl-content"></div>
      </div>
    `;

    app.querySelectorAll("[data-tab]").forEach(btn=>{
      btn.onclick = ()=>render(btn.dataset.tab);
    });

    const content = document.getElementById("fl-content");

    if(view==="home"){
      content.innerHTML = `
        <div class="fl-card">
          <div><b>Arquitectura:</b> Liga → Equipos → Jugadores + Tracker + Versus.</div>
          <div class="fl-muted">Importa/pega JSON y sincroniza IDs reales desde football-data.org.</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Backup completo de Football Lab</div>
          <div class="fl-muted">Exporta e importa <b>todos</b> los datos guardados en footballDB para recuperar tu estado completo.</div>
          <textarea id="jsonBackup" class="fl-text" placeholder='{"settings":{},"leagues":[],"teams":[],"players":[],"tracker":[]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="fillBackup">Cargar backup actual</button>
            <button class="fl-btn" id="downloadBackup">Descargar .json</button>
            <button class="fl-btn" id="runBackupImport">Importar backup completo</button>
            <span id="backupStatus" class="fl-muted"></span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Importar JSON</div>
          <textarea id="jsonImport" class="fl-text" placeholder='{"liga":{"name":"Premier League","equipos":[...]}}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="runImport">Importar</button>
            <span id="importStatus" class="fl-muted"></span>
          </div>
        </div>
      `;
      const backupEl = document.getElementById("jsonBackup");
      const backupStatusEl = document.getElementById("backupStatus");
      const setBackupStatus = (msg)=>{ backupStatusEl.textContent = msg; };

      const fillBackupTextarea = ()=>{
        backupEl.value = JSON.stringify(loadDb(), null, 2);
        setBackupStatus("✅ Backup completo cargado en el cuadro.");
      };

      document.getElementById("fillBackup").onclick = ()=>{
        fillBackupTextarea();
      };

      document.getElementById("downloadBackup").onclick = ()=>{
        try{
          const snapshot = JSON.stringify(loadDb(), null, 2);
          backupEl.value = snapshot;
          const blob = new Blob([snapshot], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const now = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
          a.href = url;
          a.download = `footballlab-backup-${now}.json`;
          a.click();
          URL.revokeObjectURL(url);
          setBackupStatus("✅ Backup descargado.");
        }catch(err){
          setBackupStatus(`❌ ${String(err.message || err)}`);
        }
      };

      document.getElementById("runBackupImport").onclick = ()=>{
        try{
          const raw = backupEl.value.trim();
          if(!raw) throw new Error("Pega un JSON de backup completo.");
          const parsed = JSON.parse(raw);
          if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)){
            throw new Error("El backup debe ser un objeto JSON válido.");
          }
          saveDb(parsed);
          const normalized = loadDb();
          saveDb(normalized);
          backupEl.value = JSON.stringify(normalized, null, 2);
          setBackupStatus("✅ Backup importado. Football Lab quedó restaurado.");
        }catch(err){
          setBackupStatus(`❌ ${String(err.message || err)}`);
        }
      };

      fillBackupTextarea();

      document.getElementById("runImport").onclick = ()=>{
        try{
          const parsed = normalizeImport(document.getElementById("jsonImport").value.trim());
          db.leagues = [parsed.league, ...db.leagues.filter(l=>l.id!==parsed.league.id)];
          parsed.teams.forEach((incomingTeam)=>{
            const team = getOrCreateTeamByName(db, incomingTeam.name, incomingTeam);
            if(!team.apiTeamId && incomingTeam.apiTeamId) team.apiTeamId = incomingTeam.apiTeamId;
            team.meta = { ...(team.meta||{}), ...(incomingTeam.meta||{}) };
            ensureTeamInLeague(db, team.id, parsed.league.id);
          });
          db.players = [...db.players.filter(p=>!parsed.players.some(ip=>ip.id===p.id)), ...parsed.players];
          if(Array.isArray(parsed.tracker) && parsed.tracker.length) db.tracker = [...db.tracker, ...parsed.tracker];
          if(parsed.versus) db.versus = { ...db.versus, ...parsed.versus };
          if(Array.isArray(parsed.predictions) && parsed.predictions.length) db.predictions = [...db.predictions, ...parsed.predictions];
          if(parsed.learning){
            db.learning = normalizeLearning({
              ...db.learning,
              ...parsed.learning,
              leagueScale: { ...(db.learning?.leagueScale||{}), ...(parsed.learning.leagueScale||{}) },
              teamBias: { ...(db.learning?.teamBias||{}), ...(parsed.learning.teamBias||{}) },
              metrics: {
                global: parsed.learning.metrics?.global || db.learning?.metrics?.global || null,
                byLeague: { ...(db.learning?.metrics?.byLeague||{}), ...(parsed.learning.metrics?.byLeague||{}) }
              }
            });
          }
          db.settings.selectedLeagueId = parsed.league.id;
          saveDb(db);
          document.getElementById("importStatus").textContent = "✅ JSON importado";
        }catch(err){
          document.getElementById("importStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      return;
    }

    if(view==="liga"){
      if(!db.settings.selectedLeagueId && db.leagues[0]) db.settings.selectedLeagueId = db.leagues[0].id;
      const leagueCards = db.leagues.map(l=>{
        const teams = getTeamsForLeague(db, l.id);
        const open = db.settings.selectedLeagueId===l.id;
        const names = teams.map(t=>`<div class="fl-row" style="justify-content:space-between;"><span>${t.name}</span><button class="fl-btn" data-open-team="${t.id}">Abrir</button></div>`).join("");
        const typeLabel = ({ league:"Liga", cup:"Copa", continental:"Continental", friendly:"Amistoso" })[normalizeCompetitionType(l.type)] || "Liga";
        return `<div class="fl-card"><button class="fl-btn" data-select-league="${l.id}" style="width:100%;text-align:left;">${open?"▾":"▸"} ${l.name}</button><div class="fl-muted" style="margin-top:6px;">${typeLabel} · ${teams.length} equipos</div><div style="display:${open?"block":"none"};margin-top:8px;">${names||"<div class='fl-muted'>Sin equipos</div>"}</div></div>`;
      }).join("");

      content.innerHTML = `
        <div class="fl-card fl-grid two">
          <div>
            <div class="fl-muted">Alta manual de liga</div>
            <div class="fl-row">
              <input id="leagueName" class="fl-input" placeholder="Nombre" />
              <input id="leagueCode" class="fl-input" placeholder="Code" />
              <select id="leagueType" class="fl-select">
                <option value="league">Liga</option>
                <option value="cup">Copa</option>
                <option value="continental">Continental</option>
                <option value="friendly">Amistoso</option>
              </select>
              <button id="addLeague" class="fl-btn">Agregar</button>
            </div>
          </div>
          <div>
            <div class="fl-muted">Agregar equipo a la liga seleccionada</div>
            <div class="fl-row">
              <input id="teamName" class="fl-input" placeholder="Equipo" />
              <button class="fl-btn" id="addTeamLiga">Agregar</button>
            </div>
          </div>
        </div>
        ${leagueCards || '<div class="fl-card"><div class="fl-muted">Sin ligas</div></div>'}
      `;

      document.getElementById("addLeague").onclick = ()=>{
        const name = document.getElementById("leagueName").value.trim();
        if(!name) return;
        const lg = {
          id: uid("lg"),
          name,
          code: document.getElementById("leagueCode").value.trim(),
          type: normalizeCompetitionType(document.getElementById("leagueType").value)
        };
        db.leagues.push(lg);
        db.settings.selectedLeagueId = lg.id;
        saveDb(db);
        render("liga");
      };
      document.getElementById("addTeamLiga").onclick = ()=>{
        const name = document.getElementById("teamName").value.trim();
        if(!name || !db.settings.selectedLeagueId) return;
        const team = getOrCreateTeamByName(db, name, { meta: { stadium:"", city:"", capacity:"" } });
        ensureTeamInLeague(db, team.id, db.settings.selectedLeagueId);
        saveDb(db);
        render("liga");
      };
      content.querySelectorAll("[data-select-league]").forEach(btn=>btn.onclick = ()=>{
        db.settings.selectedLeagueId = btn.getAttribute("data-select-league");
        saveDb(db);
        render("liga");
      });
      content.querySelectorAll("[data-open-team]").forEach(btn=>btn.onclick = ()=> render("equipo", { teamId: btn.getAttribute("data-open-team") }));
      return;
    }

    if(view==="equipos"){
      const options = db.leagues.map(l=>`<option value="${l.id}" ${db.settings.selectedLeagueId===l.id?"selected":""}>${l.name}</option>`).join("");
      const leagueTeams = getTeamsForLeague(db, db.settings.selectedLeagueId);
      const rows = leagueTeams.map(t=>`<tr><td><input class="fl-input" data-edit-team-name="${t.id}" value="${t.name}"></td><td><input class="fl-input" data-edit-team-api="${t.id}" value="${t.apiTeamId||""}"></td><td><button class="fl-btn" data-save-team="${t.id}">Guardar</button></td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-row">
            <select id="selLeague" class="fl-select"><option value="">Liga</option>${options}</select>
            <input id="teamName" class="fl-input" placeholder="Equipo" />
            <input id="teamApi" class="fl-input" placeholder="API Team ID" />
            <button class="fl-btn" id="addTeam">Agregar</button>
            <button class="fl-btn" id="syncTeams">Sync /competitions/{id}/teams</button>
            <span id="tmStatus" class="fl-muted"></span>
          </div>
        </div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Equipo (editable)</th><th>API ID</th><th></th></tr></thead><tbody>${rows||"<tr><td colspan='3'>Sin equipos</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("selLeague").onchange = (e)=>{ db.settings.selectedLeagueId = e.target.value; saveDb(db); render("equipos"); };
      document.getElementById("addTeam").onclick = ()=>{
        const name = document.getElementById("teamName").value.trim();
        if(!name || !db.settings.selectedLeagueId) return;
        const team = getOrCreateTeamByName(db, name, { apiTeamId: document.getElementById("teamApi").value.trim() });
        if(!team.apiTeamId) team.apiTeamId = document.getElementById("teamApi").value.trim();
        ensureTeamInLeague(db, team.id, db.settings.selectedLeagueId);
        saveDb(db);
        render("equipos");
      };
      document.getElementById("syncTeams").onclick = async ()=>{
        const status = document.getElementById("tmStatus");
        try{
          status.textContent = "Sincronizando equipos...";
          if(!db.settings.selectedLeagueId) throw new Error("Selecciona liga");
          if(!db.settings.apiToken) throw new Error("Falta token");
          const data = await apiFetch(`/competitions/${db.settings.selectedLeagueId}/teams?season=${db.settings.season}`, db.settings.apiToken);
          const incoming = (data.teams||[]).map(t=>({ name: t.name, apiTeamId: String(t.id) }));
          incoming.forEach((teamRaw)=>{
            const team = getOrCreateTeamByName(db, teamRaw.name, { apiTeamId: teamRaw.apiTeamId });
            if(!team.apiTeamId) team.apiTeamId = teamRaw.apiTeamId;
            ensureTeamInLeague(db, team.id, db.settings.selectedLeagueId);
          });
          localStorage.setItem(`${TEAMS_CACHE_PREFIX}${db.settings.selectedLeagueId}`, JSON.stringify(incoming));
          saveDb(db);
          render("equipos");
        }catch(err){ status.textContent = `Error: ${String(err.message||err)}`; }
      };
      content.querySelectorAll("[data-save-team]").forEach(btn=>btn.onclick = ()=>{
        const teamId = btn.getAttribute("data-save-team");
        const team = db.teams.find((t)=>t.id===teamId);
        if(!team) return;
        const name = content.querySelector(`[data-edit-team-name="${teamId}"]`)?.value.trim();
        const apiTeamId = content.querySelector(`[data-edit-team-api="${teamId}"]`)?.value.trim();
        if(name) team.name = name;
        team.apiTeamId = apiTeamId || "";
        saveDb(db);
        render("equipos");
      });
      return;
    }

    if(view==="jugadores"){
      const teamOptions = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const rows = db.players.map(p=>`<tr><td>${p.name}</td><td>${db.teams.find(t=>t.id===p.teamId)?.name||"-"}</td><td>${p.pos||"-"}</td><td>${p.rating}</td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card"><div class="fl-row">
          <input id="playerName" class="fl-input" placeholder="Jugador" />
          <select id="playerTeam" class="fl-select"><option value="">Equipo</option>${teamOptions}</select>
          <input id="playerPos" class="fl-input" placeholder="Pos" />
          <input id="playerRating" class="fl-input" type="number" min="1" max="10" step="0.1" value="5" />
          <button id="addPlayer" class="fl-btn">Agregar</button>
        </div></div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Jugador</th><th>Equipo</th><th>Pos</th><th>Rating</th></tr></thead><tbody>${rows||"<tr><td colspan='4'>Sin jugadores</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("addPlayer").onclick = ()=>{ db.players.push({ id: uid("pl"), name: document.getElementById("playerName").value.trim(), teamId: document.getElementById("playerTeam").value, pos: normalizePlayerPos(document.getElementById("playerPos").value.trim()), rating: Number(document.getElementById("playerRating").value)||5 }); saveDb(db); render("jugadores"); };
      return;
    }

    if(view==="equipo"){
      const teamId = payload.teamId || payload?.id;
      const team = db.teams.find((t)=>t.id===teamId);
      if(!team){
        content.innerHTML = `<div class="fl-card">Equipo no encontrado.</div>`;
        return;
      }
      ensureTeamIntState(team);
      team.meta ||= { stadium:"", city:"", capacity:"" };
      const contexto = team.contextoEstrategico || { rachaLocal:"", ausenciasClave:[], patrones:[], factorDia:{} };
      const players = db.players.filter(p=>p.teamId===team.id);
      const byPos = { GK:[], DF:[], MF:[], FW:[], OT:[] };
      players.forEach(p=>{ const pos = normalizePlayerPos(p.pos); (byPos[pos]||byPos.OT).push(p); });
      Object.values(byPos).forEach(list=>list.sort((a,b)=>{
        const aNum = Number.isFinite(Number(a.number)) ? Number(a.number) : 999;
        const bNum = Number.isFinite(Number(b.number)) ? Number(b.number) : 999;
        if(aNum!==bNum) return aNum - bNum;
        return String(a.name||"").localeCompare(String(b.name||""), "es", { sensitivity:"base" });
      }));
      const teamMatches = db.tracker
        .filter(m=>m.homeId===team.id || m.awayId===team.id)
        .sort((a,b)=>{
          const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : null;
          const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : null;
          if(aOrder!==null || bOrder!==null){
            if(aOrder===null) return 1;
            if(bOrder===null) return -1;
            if(aOrder!==bOrder) return aOrder - bOrder;
          }
          return compareByDateAsc(b, a);
        });
      const behavior = buildTeamBehaviorSeries(db, team.id);
      const engine = recomputeTeamGlobalEngine(db, team.id) || getOrCreateDiagProfile(db, team.id, team.name).engineV1;
      const intel = computeTeamIntelligencePanel(db, team.id);
      const gaugeAngle = Math.round(clamp(Number(intel.metrics.powerIndex) || 0, 0, 100) * 3.6);
      const sections = [["Porteros","GK"],["Defensas","DF"],["Centrocampistas","MF"],["Delanteros","FW"],["Otros","OT"]]
        .map(([title,key])=>renderSquadSection(title, byPos[key]||[], intel.playerHeat?.byName || {})).join("");
      const teamCompetitions = getTeamCompetitions(db, team.id);
      const teamCompetitionIds = new Set(teamCompetitions.map(c=>c.id));
      const availableCompetitions = db.leagues
        .filter((league)=>!teamCompetitionIds.has(league.id))
        .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      const linkCompetitionOptions = availableCompetitions
        .map((league)=>`<option value="${league.id}">${league.name} (${league.type || "league"})</option>`)
        .join("");
      const competitionSummary = teamCompetitions.length
        ? teamCompetitions.map(c=>`${c.name} (${c.type || "league"})`).join(" • ")
        : "Sin competencias vinculadas";
      const futureMatches = (team.futureMatches || [])
        .filter(m=>{
          const d = diffDaysFromToday(m.date);
          return Number.isFinite(d) && d>=0 && d<=21;
        })
        .sort((a,b)=>compareByDateAsc(a,b));
      const intRows = futureMatches.map(match=>{
        const rival = db.teams.find(t=>t.id===match.rivalTeamId);
        const out = calculateInterestSignals({ team, rival, match, allFutureMatches: team.futureMatches || [], db });
        const rivalOut = rival ? calculateInterestSignals({ team: rival, rival: team, match:{ ...match, rivalryBoost:false }, allFutureMatches: rival.futureMatches || [], db }) : { interest: 50 };
        return { match, rival, out, rivalOut, gap: Math.round(out.interest - rivalOut.interest) };
      });
      const agendaCards = intRows.map(({ match, rival, out })=>`
        <div class="fl-card" style="margin-bottom:8px;background:#111722;">
          <div class="fl-row" style="justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:800;">${team.name} vs ${rival?.name || "Rival"}</div>
              <div class="fl-mini">${match.competition || "Liga"} • ${match.date || "-"} • ${match.isHome ? "Local" : "Visitante"}</div>
            </div>
            <span class="fl-chip ${out.interest>=70?"ok":out.interest>=45?"warn":"bad"}">${out.interest>=75?"Must-win":out.rotationProbable==="Alta"?"Gestión":out.interest<45?"Trámite":"Volátil"}</span>
          </div>
          <div class="fl-row" style="margin-top:8px;gap:14px;">
            <div class="fl-mini">Interés ${Math.round(out.interest)}</div>
            <div style="flex:1;min-width:140px;height:8px;border-radius:999px;background:#0d1117;border:1px solid #30363d;overflow:hidden;"><div style="width:${Math.round(out.interest)}%;height:100%;background:linear-gradient(90deg,#2ea043,#f2cc60,#f85149);"></div></div>
            <div class="fl-mini">Confianza ${Math.round(out.confidence)}</div>
            <div class="fl-mini">Rotación ${out.rotationProbable}</div>
            <div class="fl-mini">Mercado ${out.marketMood}</div>
            <div class="fl-mini">${(out.reasonTags||[]).join(" · ") || "Sin razones aún"}</div>
            <button class="fl-btn" data-open-dual-intel="${match.id}">Abrir Intel (Dual)</button>
            <button class="fl-btn" data-edit-future-match="${match.id}">Editar partido</button>
          </div>
        </div>
      `).join("");
      const intMatrixRows = intRows.map(({ match, rival, out, rivalOut, gap })=>{
        const heat = out.interest >= 70 ? "rgba(46,160,67,.25)" : out.interest >=45 ? "rgba(210,153,34,.2)" : "rgba(110,118,129,.25)";
        return `<tr style="background:${heat};"><td>${match.date || "-"}<br><span class="fl-mini">vs ${rival?.name || "Rival"}</span></td><td>${Math.round(out.stakes)}</td><td>${Math.round(out.teamContext)}</td><td>${Math.round(out.windowInfo.congestionScore)}</td><td>${Math.round(out.rotationPressure/10)}</td><td>${Math.round(out.interest)}</td><td>${Math.round(rivalOut.interest)}</td><td>${gap>0?"+":""}${gap}</td><td>${Math.round(out.confidence)} ${match.marketMood==="raro"?"📉":""}</td></tr>`;
      }).join("");
      const next14 = (team.futureMatches || []).filter(m=>{ const d = diffDaysFromToday(m.date); return Number.isFinite(d) && d>=0 && d<=14; }).sort((a,b)=>compareByDateAsc(a,b));
      const backToBack = next14.filter((m,i,arr)=>{
        if(i===0) return false;
        const d1 = parseSortableDate(arr[i-1].date);
        const d2 = parseSortableDate(m.date);
        return Number.isFinite(d1) && Number.isFinite(d2) && ((d2-d1)/86400000)<=3;
      }).length;
      const scheduleHardness = Math.round(next14.reduce((acc,m)=>acc + competitionWeight(db, m)*0.45 + stakesByTag(m.importanceTag, stakesModeFromMatch(db, m))*0.55 + stageWeight(m.stage), 0));
      const pressureRef = intRows[0]?.out?.windowInfo?.windowPressure || { congestionLevel:"🟢" };
      const globalRotation = pressureRef.congestionLevel==="🔴" || backToBack>=2 || next14.length>=4 ? "Alta" : next14.length>=2 ? "Media" : "Baja";
      const patterns = buildTeamIntPatterns(db, team);
      const narrativeMetrics = computeTeamNarrativeMetrics(teamMatches);
      const brainV2TeamState = loadBrainV2();
      const resultsSync = getResultsSyncSummary({ db, brainV2: brainV2TeamState, team });
      const matchRows = teamMatches.map((m, idx)=>{
        const isHome = m.homeId===team.id;
        const rival = resolveRivalForTeamMatch({ db, match: m, team, brainV2: brainV2TeamState });
        const league = db.leagues.find(l=>l.id===m.leagueId);
        const home = db.teams.find(t=>t.id===m.homeId)?.name || "-";
        const away = db.teams.find(t=>t.id===m.awayId)?.name || "-";
        const moveUpDisabled = idx===0 ? "disabled" : "";
        const moveDownDisabled = idx===teamMatches.length-1 ? "disabled" : "";
        const calcState = m?.featureSnapshotStatus?.[team.id]?.status || "pendiente";
        const snap = m?.featureSnapshots?.[team.id];
        const tooltip = snap?.features
          ? `Pulse ${Math.round(snap.features.pulse||0)} | Fatiga ${Math.round(snap.features.fatiga||0)} | Res ${Math.round(snap.features.resiliencia||0)} | Mom ${Number(snap.features.momentum||0).toFixed(2)}`
          : "Sin cálculo";
        const calcLabel = calcState==="ok" ? "ok ✅" : calcState==="calculando" ? "calculando..." : calcState==="error" ? "error ❌" : "pendiente";
        const lineup = parseLineupList(isHome ? m.homeLineup : m.awayLineup);
        const lineupPreview = lineup.length ? lineup.slice(0, 5).join(", ") + (lineup.length>5 ? "…" : "") : "Sin XI cargado";
        return `<tr>
          <td>${m.date||"-"}</td>
          <td>${league?.name || "Liga"}</td>
          <td>${home} ${m.homeGoals}-${m.awayGoals} ${away}</td>
          <td>${rival?.name || "-"}<div class="fl-mini" style="margin-top:4px;">XI: ${lineupPreview}</div></td>
          <td class="fl-row" style="gap:6px;">
            <button class="fl-btn" data-move-match="${m.id}" data-move-delta="-1" ${moveUpDisabled}>⬆️</button>
            <button class="fl-btn" data-move-match="${m.id}" data-move-delta="1" ${moveDownDisabled}>⬇️</button>
            <button class="fl-btn" data-open-stats-modal="${m.id}">Estadísticas</button>
            <button class="fl-btn" data-open-engine-modal="${m.id}">EPA/EMA/HAE</button>
            <button class="fl-btn" data-calc-match="${m.id}">📊 Calcular métricas</button>
            <span class="fl-mini" title="${tooltip}">${calcState==="ok"?"✅ Calculado":calcLabel}</span>
            <button class="fl-btn" data-edit-match="${m.id}">Editar</button>
            <button class="fl-btn" data-delete-match="${m.id}">Borrar</button>
          </td>
        </tr>`;
      }).join("");
      const resultTeamOptions = getTeamsForLeague(db, db.settings.selectedLeagueId || "")
        .map(t=>`<option value="${t.id}" ${t.id===team.id?"selected":""}>${t.name}</option>`)
        .join("");

      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-row" style="justify-content:space-between;align-items:center;gap:10px;">
            <div style="font-size:30px;font-weight:900;">${team.name}</div>
            <div class="fl-row">
              <button class="fl-btn" id="linkLeagueBtn">Vincular liga</button>
              <button class="fl-btn" id="editTeamName">Editar nombre</button>
              <button class="fl-btn" id="deleteTeamBtn" style="border-color:#da3633;color:#ff7b72;">Eliminar equipo</button>
            </div>
          </div>
          <div>Estadio: <b>${team.meta.stadium || '-'}</b> ${team.meta.city?`(${team.meta.city})`:''}</div>
          <div>Capacidad: <b>${team.meta.capacity || '-'}</b></div>
          <div class="fl-mini" style="margin-top:4px;">Competiciones vinculadas: <b>${teamCompetitions.length}</b> · ${competitionSummary}</div>
          <div id="linkLeaguePanel" class="fl-row" style="margin-top:8px;display:none;">
            <select id="linkLeagueSelect" class="fl-select">
              <option value="">Selecciona competencia</option>
              ${linkCompetitionOptions}
            </select>
            <button class="fl-btn" id="confirmLinkLeague">Guardar vínculo</button>
            <span class="fl-mini" id="linkLeagueStatus"></span>
          </div>
          <div class="fl-row" style="margin-top:8px;">${["RESUMEN","NOTICIAS","RESULTADOS","PARTIDOS","CLASIFICACIÓN","TRASPASOS","PLANTILLA"].map(t=>`<span class="fl-muted" style="padding:4px 6px;border-bottom:${t==='PLANTILLA'?'2px solid #ff3b69':'2px solid transparent'};">${t}</span>`).join("")}</div>
        </div>
        <div class="fl-card fl-row">
          <input id="teamStadium" class="fl-input" placeholder="Estadio" value="${team.meta.stadium || ''}">
          <input id="teamCity" class="fl-input" placeholder="Ciudad" value="${team.meta.city || ''}">
          <input id="teamCapacity" class="fl-input" placeholder="Capacidad" value="${team.meta.capacity || ''}">
          <button class="fl-btn" id="saveMeta">Guardar equipo</button>
          <button class="fl-btn" id="backLiga">Volver a ligas</button>
        </div>
        <div class="fl-card">
          <div class="fl-row" style="justify-content:space-between;align-items:center;gap:8px;">
            <div style="font-weight:900;font-size:18px;">📦 TeamPack v1 · ${team.name}</div>
            <div class="fl-row" style="gap:6px;">
              <button class="fl-btn active" id="teamPackTabExport">Perfil del equipo</button>
              <button class="fl-btn" id="teamPackTabTrainer">🧠 TeamPack Trainer</button>
            </div>
          </div>
          <div id="teamPackExportPanel" style="margin-top:10px;">
            <div class="fl-row" style="gap:8px;flex-wrap:wrap;">
              <label class="fl-mini">Últimos
                <select id="teamPackWindow" class="fl-select" style="margin-left:4px;">
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20" selected>20</option>
                  <option value="50">50</option>
                  <option value="season">temporada</option>
                </select>
              </label>
              <label class="fl-mini"><input id="teamPackRecalc" type="checkbox" /> Recalcular snapshots antes de exportar</label>
              <label class="fl-mini"><input id="teamPackCompactNarrative" type="checkbox" /> Compactar narrativeRaw (2k chars)</label>
              <label class="fl-mini"><input id="teamPackIncludeRawFeatures" type="checkbox" checked /> Incluir featuresRaw</label>
              <button class="fl-btn" id="teamPackExportBtn">📦 Exportar TeamPack</button>
              <span id="teamPackExportStatus" class="fl-mini"></span>
            </div>
          </div>
          <div id="teamPackTrainerPanel" style="margin-top:10px;display:none;">
            <div class="fl-row" style="gap:8px;flex-wrap:wrap;">
              <input id="teamPackFileInput" type="file" accept="application/json,.json" style="display:none;" />
              <button class="fl-btn" id="teamPackImportBtn">📥 Importar TeamPack</button>
              <label class="fl-mini"><input id="teamPackImportRecalcSnapshots" type="checkbox" checked /> Recalcular snapshots si faltan</label>
              <span id="teamPackImportStatus" class="fl-mini"></span>
            </div>
            <div id="teamPackImportedMeta" class="fl-mini" style="margin-top:8px;">Sin pack importado.</div>
            <div id="teamPackStrength" class="fl-mini" style="margin-top:8px;">Conozco al equipo: --%</div>
            <div class="fl-row" style="gap:8px;flex-wrap:wrap;margin-top:8px;">
              <label class="fl-mini">Ventana
                <select id="teamPackTrainWindow" class="fl-select" style="margin-left:4px;"><option value="5" selected>last5</option><option value="10">last10</option></select>
              </label>
              <label class="fl-mini">Epochs
                <select id="teamPackTrainEpochs" class="fl-select" style="margin-left:4px;"><option value="5" selected>5</option><option value="10">10</option></select>
              </label>
              <label class="fl-mini">Batch size
                <select id="teamPackTrainBatch" class="fl-select" style="margin-left:4px;"><option value="16" selected>16</option><option value="32">32</option></select>
              </label>
              <button class="fl-btn" id="teamPackTrainBtn">🧠 Entrenar Cerebro con este pack</button>
            </div>
            <div id="teamPackTrainOutput" class="fl-mini" style="margin-top:8px;">Sin entrenamiento ejecutado.</div>
            <div id="teamPackPowerDashboard" class="fl-card" style="margin-top:10px;display:none;"></div>
          </div>
        </div>
        <div class="fl-card context-box">
          <div class="fl-title" style="font-size:14px;">🧠 Contexto Estratégico</div>
          <div class="fl-grid two">
            <div class="fl-field">
              <label>Racha/Tendencia Actual</label>
              <input type="text" class="fl-input" id="ctx-racha" placeholder="Ej: 5 partidos sin ganar en casa" value="${contexto.rachaLocal || ''}">
            </div>
            <div class="fl-field">
              <label>Bajas Sensibles</label>
              <input type="text" class="fl-input" id="ctx-bajas" placeholder="Jugadores lesionados" value="${(contexto.ausenciasClave || []).join(', ')}">
            </div>
          </div>
          <div class="fl-field" style="margin-top:10px;">
            <label>Patrones Detectados (Insight)</label>
            <textarea class="fl-text" id="ctx-insights" style="min-height:60px;" placeholder="Ej: Solo 1 de los últimos 12 tuvo +1 gol en el 1T">${(contexto.patrones || []).join(', ')}</textarea>
          </div>
          <div class="fl-field" style="margin-top:10px;">
            <label>Factor por día (JSON opcional)</label>
            <input type="text" class="fl-input" id="ctx-factor-dia" placeholder='{"Tuesday": -0.2}' value='${JSON.stringify(contexto.factorDia || {})}'>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">Importar plantilla (JSON o texto pegado)</div>
          <textarea id="squadImport" class="fl-text" placeholder='Pega JSON o texto copiado (#, Name, Age, MIN...)'></textarea>
          <div class="fl-row" style="margin-top:8px;"><button class="fl-btn" id="runSquadImport">Importar plantilla</button><span id="squadStatus" class="fl-muted"></span></div>
        </div>
        <div class="fl-card">
          <div style="font-weight:900;font-size:18px;margin-bottom:8px;">🧠 Team Intelligence Panel v2</div>
          <div class="fl-row" style="align-items:center;gap:16px;flex-wrap:wrap;">
            <div style="width:180px;height:180px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#1f6feb ${gaugeAngle}deg,#2d333b ${gaugeAngle}deg);padding:10px;">
              <div style="width:100%;height:100%;border-radius:50%;background:#0f141b;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div class="fl-mini">TEAM POWER INDEX</div>
                <div style="font-size:38px;font-weight:900;line-height:1;">${Math.round(intel.metrics.powerIndex)}</div>
                <div class="fl-mini">/100</div>
              </div>
            </div>
            <div style="flex:1;min-width:300px;">
              <div class="fl-kpi" style="margin-bottom:8px;">
                <div><span class="fl-mini">Tendencia</span><b>${intel.metrics.trend}</b></div>
                <div><span class="fl-mini">Consistencia</span><b>${Math.round(intel.metrics.consistencyScore)}%</b></div>
                <div><span class="fl-mini">Momentum 5</span><b>${Math.round((intel.metrics.momentum5||0)*100)}%</b></div>
                <div><span class="fl-mini">ELO dinámico</span><b>${intel.prediction.eloDynamic}</b></div>
                <div><span class="fl-mini">Off/Def</span><b>${Math.round(intel.prediction.offenseRating)} / ${Math.round(intel.prediction.defenseRating)}</b></div>
                <div><span class="fl-mini">SOS (Elo-style)</span><b>${intel.sos?.sos>=0?"+":""}${intel.sos?.sos || 0}</b></div>
              </div>
              <div style="height:140px;"><canvas id="teamPowerHistoryChart"></canvas></div>
            </div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">📈 Momentum dinámico (xG vs resultado real vs esperado)</div>
          <div style="height:220px;"><canvas id="teamMomentumTripleChart"></canvas></div>
        </div>
        <div class="fl-row" style="gap:10px;align-items:stretch;">
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">🧠 Estado psicológico</div>
            <div class="fl-kpi" style="margin-bottom:8px;">
              <div><span class="fl-mini">Agresividad</span><b>${Math.round(intel.psych.aggressiveness)}</b></div>
              <div><span class="fl-mini">Resiliencia</span><b>${Math.round(intel.psych.resilience)}</b></div>
              <div><span class="fl-mini">Volatilidad</span><b>${Math.round(intel.psych.volatility)}</b></div>
              <div><span class="fl-mini">Fatiga</span><b>${Math.round(intel.psych.fatigue)}</b></div>
              <div><span class="fl-mini">Pulse plantilla</span><b>${Math.round(intel.psych.playerPulse || intel.playerHeat?.summary?.teamPsychPulse || 50)}</b></div>
              <div><span class="fl-mini">Eventos narrados</span><b>${Math.round(intel.playerHeat?.summary?.narrativeEvents || 0)}</b></div>
            </div>
            <div style="height:230px;"><canvas id="teamPsychRadar"></canvas></div>
          </div>
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">🧬 Tactical DNA Map</div>
            <div style="height:280px;"><canvas id="teamTacticalRadar"></canvas></div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">🗺️ Football Lab · Narraciones guardadas</div>
          <div class="fl-kpi" style="margin-bottom:8px;">
            <div><span class="fl-mini">Partidos con relato</span><b>${narrativeMetrics.games}</b></div>
            <div><span class="fl-mini">Agresividad media</span><b>${(narrativeMetrics.avgAgresividad*100).toFixed(0)}%</b></div>
            <div><span class="fl-mini">Peligro medio</span><b>${(narrativeMetrics.avgPeligro*100).toFixed(0)}%</b></div>
            <div><span class="fl-mini">Ventana media</span><b>${Math.round(narrativeMetrics.avgWindow)}'</b></div>
          </div>
          <div class="fl-mini">
            Cálculo automático desde <b>narrativeModule.rawText</b> de cada partido del equipo.
            Se aplica el diccionario de paso (agresividad/peligro) y luego normalización por ventana:
            <b>scoreFinal = scoreExtraido / (minutoMax/90)</b>.
          </div>
          <div class="fl-mini" style="margin-top:6px;">
            ${narrativeMetrics.topAgresividad ? `Pico de agresividad: <b>${(narrativeMetrics.topAgresividad.metrics.agresividad*100).toFixed(0)}%</b> (${narrativeMetrics.topAgresividad.match.date || "sin fecha"}).` : "Sin relatos guardados para calcular picos."}
          </div>
          <div class="fl-mini" style="margin-top:4px;">
            ${narrativeMetrics.topPeligro ? `Pico de peligro: <b>${(narrativeMetrics.topPeligro.metrics.peligro*100).toFixed(0)}%</b> (${narrativeMetrics.topPeligro.match.date || "sin fecha"}).` : ""}
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">🔮 Motor de predicción integrado</div>
          <div class="fl-kpi">
            <div><span class="fl-mini">Rating ofensivo</span><b>${Math.round(intel.prediction.offenseRating)}</b></div>
            <div><span class="fl-mini">Rating defensivo</span><b>${Math.round(intel.prediction.defenseRating)}</b></div>
            <div><span class="fl-mini">Índice psicológico</span><b>${Math.round(intel.prediction.psychIndex)}</b></div>
            <div><span class="fl-mini">Índice consistencia</span><b>${Math.round(intel.prediction.consistencyIndex)}</b></div>
            <div><span class="fl-mini">Home Boost (engine)</span><b>${(Number(engine?.haTraits?.homeBoost)||0).toFixed(2)}</b></div>
            <div><span class="fl-mini">Travel Tilt</span><b>${(Number(engine?.haTraits?.travelTilt)||0).toFixed(2)}</b></div>
          </div>
        </div>
        
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">📐 Base estructural temporada (manual)</div>
          <div class="fl-mini" style="margin-bottom:8px;">Define PJ, G, E, P, GF, GC, DG y PTS como referencia estructural del equipo.</div>
          <div class="fl-row" style="gap:8px;flex-wrap:wrap;">
            <input id="teamSeasonBasePj" class="fl-input" type="number" min="0" placeholder="PJ" style="width:86px;" value="${team?.intProfile?.seasonBase?.pj ?? ''}" />
            <input id="teamSeasonBaseG" class="fl-input" type="number" min="0" placeholder="G" style="width:72px;" value="${team?.intProfile?.seasonBase?.g ?? ''}" />
            <input id="teamSeasonBaseE" class="fl-input" type="number" min="0" placeholder="E" style="width:72px;" value="${team?.intProfile?.seasonBase?.e ?? ''}" />
            <input id="teamSeasonBaseP" class="fl-input" type="number" min="0" placeholder="P" style="width:72px;" value="${team?.intProfile?.seasonBase?.p ?? ''}" />
            <input id="teamSeasonBaseGf" class="fl-input" type="number" min="0" placeholder="GF" style="width:72px;" value="${team?.intProfile?.seasonBase?.gf ?? ''}" />
            <input id="teamSeasonBaseGc" class="fl-input" type="number" min="0" placeholder="GC" style="width:72px;" value="${team?.intProfile?.seasonBase?.gc ?? ''}" />
            <input id="teamSeasonBaseDg" class="fl-input" type="number" placeholder="DG" style="width:72px;" value="${team?.intProfile?.seasonBase?.dg ?? ''}" />
            <input id="teamSeasonBasePts" class="fl-input" type="number" min="0" placeholder="PTS" style="width:80px;" value="${team?.intProfile?.seasonBase?.pts ?? ''}" />
            <input id="teamSeasonBasePos" class="fl-input" type="number" min="1" placeholder="Pos" style="width:72px;" value="${team?.intProfile?.seasonBase?.position ?? ''}" />
          </div>
          <div class="fl-row" style="margin-top:8px;gap:8px;align-items:center;">
            <button class="fl-btn" id="saveTeamSeasonBaseBtn">Guardar base temporada</button>
            <div id="teamSeasonBaseStatus" class="fl-mini"></div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">RESULTADOS (clic para estadísticas)</div>
          <div class="fl-mini" style="margin-bottom:6px;">Hay <b>${resultsSync.totalInMemory}</b> partidos guardados en memoria para <b>${team.name}</b>.</div>
          <div class="fl-mini" style="margin-bottom:8px;">Y ya hay <b>${resultsSync.alreadySynced}</b> sincronizados en esta tabla.${resultsSync.pendingToSync>0 ? ` Faltan <b>${resultsSync.pendingToSync}</b>.` : " <b>Todo sincronizado.</b>"}</div>
          <div class="fl-row" style="margin-bottom:10px;">
            <button class="fl-btn" id="syncResultsFromMemory" ${resultsSync.pendingToSync>0 ? '' : 'disabled'}>Sincronizar</button>
            <input id="resDate" type="date" class="fl-input" />
            <select id="resHome" class="fl-select"><option value="">Local</option>${resultTeamOptions}</select>
            <input id="resHG" type="number" class="fl-input" placeholder="GL" style="width:74px" />
            <input id="resAG" type="number" class="fl-input" placeholder="GV" style="width:74px" />
            <select id="resAway" class="fl-select"><option value="">Visitante</option>${resultTeamOptions}</select>
            <button class="fl-btn" id="addResult">Guardar partido</button>
            <button class="fl-btn" id="calcLast5Btn">Calcular últimos 5</button>
            <button class="fl-btn" id="calcAllBtn">Calcular todos</button>
            <span id="resultStatus" class="fl-muted"></span>
          </div>
          <table class="fl-table">
            <thead><tr><th>Fecha</th><th>Liga</th><th>Partido</th><th>Rival</th><th>Acciones</th></tr></thead>
            <tbody>${matchRows || "<tr><td colspan='5'>Sin partidos todavía</td></tr>"}</tbody>
          </table>
        </div>
        <div class="fl-card">
          <div class="fl-row" style="justify-content:space-between;align-items:center;">
            <div style="font-weight:900;font-size:18px;">🎯 Interés & Prioridades (INT)</div>
            <div class="fl-row">
              <button class="fl-btn" id="teamIntConfigBtn">⚙️ Config INT del Equipo</button>
              <button class="fl-btn" id="addFutureMatchBtn">+ Próximo partido</button>
              <select id="intModeLens" class="fl-select"><option value="empresa" ${team.intProfile.modeLens==="empresa"?"selected":""}>Modo Empresa</option><option value="guerra" ${team.intProfile.modeLens==="guerra"?"selected":""}>Modo Guerra</option></select>
            </div>
          </div>
          <div class="fl-mini" style="margin-top:6px;">${team.intProfile.modeLens==="guerra"?"Modo Guerra: lectura agresiva (presión y rivalidad).":"Modo Empresa: lectura de gestión (rotación y control de riesgo)."}</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">1) Agenda Próxima (7–21 días)</div>
          ${agendaCards || "<div class='fl-muted'>Sin partidos futuros en ventana 21 días.</div>"}
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">2) Matriz por partido (heatmap)</div>
          <table class="fl-table"><thead><tr><th>Partido</th><th>Stakes</th><th>Contexto</th><th>Ventana</th><th>Rotación</th><th>Interés Eq.</th><th>Interés Rival</th><th>Gap</th><th>Confianza</th></tr></thead><tbody>${intMatrixRows || "<tr><td colspan='9'>Sin datos de agenda.</td></tr>"}</tbody></table>
        </div>
        <div class="fl-row" style="gap:10px;align-items:stretch;">
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">3) Window Pressure (14 días)</div>
            <div class="fl-kpi">
              <div><span class="fl-mini">Partidos 7d</span><b>${(intRows[0]?.out?.windowInfo?.windowPressure?.matches7d ?? 0)}</b></div>
              <div><span class="fl-mini">Partidos 14d</span><b>${next14.length}</b></div>
              <div><span class="fl-mini">Dureza acumulada</span><b>${scheduleHardness}</b></div>
              <div><span class="fl-mini">Congestión</span><b>${pressureRef.congestionLevel}</b></div>
              <div><span class="fl-mini">Rotación global</span><b>${globalRotation}</b></div>
            </div>
          </div>
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">4) Historial “Modo Trámite”</div>
            <div class="fl-row" style="margin-bottom:8px;">${patterns.badges.map(b=>`<span class='fl-chip'>${b}</span>`).join(" ")}</div>
            <div class="fl-mini">Drop low-stakes: ${patterns.drop} • Varianza: ${patterns.variance} • Pre-big dip: ${patterns.preBigDrop}</div>
          </div>
        </div>
        ${sections}
      `;
      const saveSeasonBaseBtn = document.getElementById("saveTeamSeasonBaseBtn");
      if(saveSeasonBaseBtn) saveSeasonBaseBtn.onclick = ()=>{
        team.intProfile ||= {};
        const read = (id)=>{
          const raw = document.getElementById(id)?.value;
          if(raw === '' || raw === null || typeof raw === 'undefined') return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        };
        const seasonBase = {
          pj: read('teamSeasonBasePj'),
          g: read('teamSeasonBaseG'),
          e: read('teamSeasonBaseE'),
          p: read('teamSeasonBaseP'),
          gf: read('teamSeasonBaseGf'),
          gc: read('teamSeasonBaseGc'),
          dg: read('teamSeasonBaseDg'),
          pts: read('teamSeasonBasePts'),
          position: read('teamSeasonBasePos')
        };
        if(Number.isFinite(seasonBase.gf) && Number.isFinite(seasonBase.gc) && !Number.isFinite(seasonBase.dg)){
          seasonBase.dg = seasonBase.gf - seasonBase.gc;
        }
        team.intProfile.seasonBase = seasonBase;
        saveDb(db);
        const statusEl = document.getElementById('teamSeasonBaseStatus');
        if(statusEl) statusEl.textContent = '✅ Base estructural guardada.';
      };

      document.getElementById("teamIntConfigBtn").onclick = ()=>{
        const profile = team.intProfile || {};
        const priorityCompetition = prompt("Competición prioridad A (Liga/UCL/Copa)", profile.priorityCompetition || "Liga");
        if(priorityCompetition===null) return;
        const seasonGoal = prompt("Objetivo temporada (titulo/top4/descenso/nada)", profile.seasonGoal || profile.seasonObjective || "top4");
        const squadDepth = prompt("Profundidad de plantilla (1-5)", String(profile.squadDepth || 3));
        const coachRotation = prompt("Rotación del entrenador (1-5)", String(profile.coachRotation || profile.coachRotationPolicy || 3));
        const styleTags = prompt("Style tags (coma): conservador, agresivo, empate...", Array.isArray(profile.styleTags) ? profile.styleTags.join(", ") : "");
        const derbyRivals = prompt("Derby rivals (nombre o ID, coma)", Array.isArray(profile.derbyRivals) ? profile.derbyRivals.join(", ") : "");
        profile.priorityCompetition = String(priorityCompetition || "Liga").trim() || "Liga";
        profile.seasonGoal = String(seasonGoal || "top4").trim() || "top4";
        profile.seasonObjective = profile.seasonGoal;
        profile.squadDepth = clamp(Number(squadDepth) || 3, 1, 5);
        profile.coachRotation = clamp(Number(coachRotation) || 3, 1, 5);
        profile.coachRotationPolicy = profile.coachRotation;
        profile.styleTags = String(styleTags || "").split(",").map(s=>s.trim()).filter(Boolean);
        profile.psychTags = [...profile.styleTags];
        profile.derbyRivals = String(derbyRivals || "").split(",").map(s=>s.trim()).filter(Boolean);
        profile.rivalries = [...profile.derbyRivals];
        team.intProfile = profile;
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      document.getElementById("addFutureMatchBtn").onclick = ()=>{
        openFutureMatchModal({
          db,
          team,
          onSave: ()=>render("equipo", { teamId: team.id })
        });
      };
      document.getElementById("intModeLens").onchange = (e)=>{
        team.intProfile.modeLens = e.target.value === "guerra" ? "guerra" : "empresa";
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      content.querySelectorAll("[data-open-dual-intel]").forEach(btn=>btn.onclick = ()=>{
        const match = (team.futureMatches || []).find(m=>m.id===btn.getAttribute("data-open-dual-intel"));
        if(!match) return;
        const rival = db.teams.find(t=>t.id===match.rivalTeamId);
        const own = calculateInterestSignals({ team, rival, match, allFutureMatches: team.futureMatches || [], db });
        const opp = rival ? calculateInterestSignals({ team: rival, rival: team, match, allFutureMatches: rival.futureMatches || [], db }) : { interest: 50, confidence: 40 };
        const gap = Math.round(own.interest - opp.interest);
        const windowGap = Math.round((own.windowInfo?.congestionScore || 0) - (opp.windowInfo?.congestionScore || 0));
        const conclusion = gap >= 20 ? "Ventaja motivacional de tu equipo." : gap <= -20 ? "Rival más activado en esta ventana." : "Gap motivacional pequeño, revisar gestión.";
        alert([
          `Dual Match Intel`,
          `${team.name}: interés ${Math.round(own.interest)} | rotación ${own.rotationProbable} | confianza ${Math.round(own.confidence)}`,
          `${rival?.name || "Rival"}: interés ${Math.round(opp.interest)} | rotación ${opp.rotationProbable || "Media"} | confianza ${Math.round(opp.confidence || 50)}`,
          `Interest Gap: ${gap>0?"+":""}${gap}`,
          `Gap de Ventana: ${windowGap>0?"+":""}${windowGap}`,
          `Mercado: early ${Math.round(own.market?.earlyDrift || 0)}% / vol ${Math.round(own.market?.volatilityIndex || 0)}`,
          `Conclusión: ${conclusion}`
        ].join("\n"));
      });
      content.querySelectorAll("[data-edit-future-match]").forEach(btn=>btn.onclick = ()=>{
        openFutureMatchModal({
          db,
          team,
          matchId: btn.getAttribute("data-edit-future-match") || "",
          onSave: ()=>render("equipo", { teamId: team.id })
        });
      });
      document.getElementById("editTeamName").onclick = ()=>{
        const name = prompt("Nuevo nombre del equipo", team.name);
        const nextName = String(name||"").trim();
        if(!nextName) return;
        team.name = nextName;
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      document.getElementById("linkLeagueBtn").onclick = ()=>{
        const panel = document.getElementById("linkLeaguePanel");
        if(!panel) return;
        panel.style.display = panel.style.display === "none" ? "flex" : "none";
      };
      document.getElementById("confirmLinkLeague").onclick = ()=>{
        const leagueId = String(document.getElementById("linkLeagueSelect")?.value || "").trim();
        const status = document.getElementById("linkLeagueStatus");
        if(!leagueId){
          if(status) status.textContent = "Selecciona una competencia.";
          return;
        }
        ensureTeamInLeague(db, team.id, leagueId);
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      document.getElementById("deleteTeamBtn").onclick = ()=>{
        if(!confirm(`¿Eliminar equipo ${team.name}? Se borrarán jugadores, partidos y vínculos.`)) return;
        db.teams = db.teams.filter(t=>t.id!==team.id);
        db.players = db.players.filter(p=>p.teamId!==team.id);
        db.tracker = db.tracker.filter(m=>m.homeId!==team.id && m.awayId!==team.id);
        db.teamCompetitions = (db.teamCompetitions || []).filter(tc=>tc.teamId!==team.id);
        db.teams.forEach(other=>{
          ensureTeamIntState(other);
          other.futureMatches = (other.futureMatches || []).filter(m=>m.rivalTeamId!==team.id);
        });
        saveDb(db);
        render("liga");
      };
      document.getElementById("backLiga").onclick = ()=>render("liga");
      const teamPackTabExportBtn = document.getElementById("teamPackTabExport");
      const teamPackTabTrainerBtn = document.getElementById("teamPackTabTrainer");
      const teamPackExportPanel = document.getElementById("teamPackExportPanel");
      const teamPackTrainerPanel = document.getElementById("teamPackTrainerPanel");
      let importedPack = null;

      const setTeamPackTab = (tab)=>{
        const exportActive = tab!=="trainer";
        if(teamPackExportPanel) teamPackExportPanel.style.display = exportActive ? "block" : "none";
        if(teamPackTrainerPanel) teamPackTrainerPanel.style.display = exportActive ? "none" : "block";
        if(teamPackTabExportBtn) teamPackTabExportBtn.classList.toggle("active", exportActive);
        if(teamPackTabTrainerBtn) teamPackTabTrainerBtn.classList.toggle("active", !exportActive);
      };
      teamPackTabExportBtn.onclick = ()=>setTeamPackTab("export");
      teamPackTabTrainerBtn.onclick = ()=>setTeamPackTab("trainer");

      const openTeamPackMatchModal = (row)=>{
        if(!row) return;
        const backdrop = document.createElement("div");
        backdrop.className = "fl-modal-backdrop";
        const topReasons = (row.reasons || []).slice(0, 8);
        const causes = topReasons.filter((r)=>String(r?.group || "core") !== "modifier").map((r)=>`<span class="fl-chip">${r.label || r.tagId} ${(Number(r.strength||0)*100).toFixed(0)}%</span>`).join(" ");
        const modifiers = topReasons.filter((r)=>String(r?.group || "") === "modifier").map((r)=>`<span class="fl-chip">${r.label || r.tagId} ${(Number(r.strength||0)*100).toFixed(0)}%</span>`).join(" ");
        const statsList = Array.isArray(row?.source?.statsRaw?.stats) ? row.source.statsRaw.stats : [];
        backdrop.innerHTML = `
          <div class="fl-modal" style="max-width:920px;">
            <div class="fl-row" style="justify-content:space-between;align-items:center;">
              <div><div class="fl-modal-title">${row.date} · vs ${row.opponent} (${row.venue})</div><div class="fl-mini">Marcador ${row.gf}-${row.ga} · Outcome ${row.outcome}</div></div>
              <button class="fl-btn" data-close>Cerrar</button>
            </div>
            <div class="fl-card" style="margin-top:8px;"><b>Relato</b><div class="fl-mini" style="white-space:pre-wrap;max-height:180px;overflow:auto;margin-top:6px;">${(row.narrativeRaw || "Sin relato").replace(/</g,"&lt;")}</div></div>
            <div class="fl-card" style="margin-top:8px;"><b>Causas</b><div class="fl-row" style="margin-top:6px;flex-wrap:wrap;">${causes || "Sin causas detectadas."}</div><b style="display:block;margin-top:8px;">Modificadores</b><div class="fl-row" style="margin-top:6px;flex-wrap:wrap;">${modifiers || "Sin modificadores."}</div></div>
            <div class="fl-card" style="margin-top:8px;"><b>Stats pegadas</b><div class="fl-mini" style="max-height:160px;overflow:auto;margin-top:6px;">${statsList.length ? statsList.slice(0,20).map((st)=>`${st.key}: ${st.home} - ${st.away}`).join("<br>") : "Sin stats base"}</div></div>
            <div class="fl-grid two" style="margin-top:8px;">
              <div class="fl-card"><div class="fl-mini">Shots timeline (proxy tags/min)</div><div style="height:160px;"><canvas id="tpModalTimeline"></canvas></div></div>
              <div class="fl-card"><div class="fl-mini">Corners/xG</div><div style="height:160px;"><canvas id="tpModalMini"></canvas></div></div>
            </div>
          </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('[data-close]').onclick = ()=>backdrop.remove();
        backdrop.onclick = (e)=>{ if(e.target===backdrop) backdrop.remove(); };
        const mins = Array.from({ length: 6 }, (_,i)=>i*15);
        const bucket = mins.map((m)=> (row.reasons || []).reduce((acc,r)=>acc + (r.mins || []).filter((x)=>Number(x)>=m && Number(x)<m+15).length, 0));
        renderSimpleLineChart(backdrop.querySelector('#tpModalTimeline'), ["0-15","15-30","30-45","45-60","60-75","75-90"], [{ label:"Eventos tags", data: bucket.map((v)=>clamp(v*20,0,100)), borderColor:"#58a6ff", backgroundColor:"rgba(88,166,255,.2)", tension:0.25 }]);
        if(typeof Chart === "function"){
          const mini = backdrop.querySelector('#tpModalMini');
          if(mini){
            mini._chart = new Chart(mini.getContext("2d"), {
              type: "bar",
              data: { labels:["Shots","ShotsOT","Corners","xG"], datasets:[{ label:"For", data:[row.stats.shotsAll.own,row.stats.shots.own,row.stats.corners.own,row.stats.xg.own*10], backgroundColor:"rgba(31,111,235,.7)" },{ label:"Against", data:[row.stats.shotsAll.opp,row.stats.shots.opp,row.stats.corners.opp,row.stats.xg.opp*10], backgroundColor:"rgba(248,81,73,.7)" }] },
              options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:"#c9d1d9" } } }, scales:{ x:{ ticks:{ color:"#9ca3af" } }, y:{ ticks:{ color:"#9ca3af" }, grid:{ color:"rgba(255,255,255,.06)" } } } }
            });
          }
        }
      };

      const renderTeamPackDashboard = (pack)=>{
        const node = document.getElementById('teamPackPowerDashboard');
        if(!node) return;
        const agg = buildTeamAggregate(pack);
        if(agg.sampleSize < 5){ node.style.display = 'none'; return; }
        node.style.display = 'block';
      const confidenceLabel = agg.confidence >= 0.8 ? 'alto' : agg.confidence >= 0.55 ? 'medio' : 'bajo';
      const dnaRows = agg.teamDNA.slice(0,5).map((tag)=>`<div class="fl-row" style="justify-content:space-between;"><span>${tag.label}</span><b>${tag.intensityPct.toFixed(0)}%</b></div>`).join('');
      const defeatRows = agg.defeatCauses.slice(0,5).map((tag)=>`<tr><td>${tag.tagId}</td><td>${tag.count}</td></tr>`).join('');
      const insightLines = [];
      if(agg.kpis.attackProduction >= 65 && agg.kpis.attackConversion <= 52){
        insightLines.push('El equipo genera volumen ofensivo alto, pero su conversión es baja.');
      }
      if(agg.kpis.defense <= 40){
        insightLines.push('La estabilidad defensiva es débil y concede escenarios de gol con frecuencia.');
      }
      const latePressure = agg.teamDNA.find((t)=>t.tagId === 'late_pressure');
      if((latePressure?.intensityPct || 0) >= 55){
        insightLines.push('Hay presión ofensiva tardía recurrente: los cierres de partido pesan en el resultado.');
      }
      if(!insightLines.length){
        insightLines.push('Perfil equilibrado sin un sesgo extremo detectado en los últimos partidos.');
      }
      const timelineRows = agg.matches.slice().reverse().map((m)=>{
          const tags = m.reasons.slice(0,3).map((r)=>`${r.label || r.tagId} ${(Number(r.strength||0)*100).toFixed(0)}% (${(r.mins||[]).slice(0,2).join(',') || '-'})`).join(' · ');
          const dot = m.completeness.score >= 0.8 ? '🟢' : m.completeness.score >= 0.55 ? '🟡' : '🔴';
          return `<tr data-pack-match="${m.matchId}" style="cursor:pointer;"><td>${m.date}</td><td>${m.opponent}</td><td>${m.venue}</td><td>${m.gf}-${m.ga}</td><td>${m.outcome}</td><td class="fl-mini">${tags || 'Sin tags'}</td><td title="${m.completeness.level}">${dot} ${(m.completeness.score*100).toFixed(0)}%</td></tr>`;
        }).join('');
        const panelTitle = agg.panelLevel === 'avanzado' ? 'Power Dashboard avanzado' : agg.panelLevel === 'completo' ? 'Power Dashboard completo' : 'Power Dashboard básico';
        node.innerHTML = `
          <div style="font-weight:900;font-size:18px;">⚡ ${panelTitle}</div>
          <div class="fl-mini" style="margin-top:4px;">N=${agg.sampleSize} · Confidence ${confidenceLabel} (${(agg.confidence*100).toFixed(0)}%)</div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span class="fl-mini">Attack Power</span><b>${agg.kpis.attack.toFixed(0)}</b></div>
            <div><span class="fl-mini">Defense Power</span><b>${agg.kpis.defense.toFixed(0)}</b></div>
            <div><span class="fl-mini">Control Power</span><b>${agg.kpis.control.toFixed(0)}</b></div>
            <div><span class="fl-mini">Efficiency Power</span><b>${agg.kpis.efficiency.toFixed(0)}</b></div>
          </div>
          <div class="fl-card" style="margin-top:8px;"><b>Timeline de partidos</b><table class="fl-table" style="margin-top:6px;"><thead><tr><th>Fecha</th><th>Rival</th><th>H/A</th><th>Marcador</th><th>Outcome</th><th>Top tags</th><th>Data</th></tr></thead><tbody>${timelineRows}</tbody></table></div>
          <div class="fl-row" style="margin-top:8px;gap:6px;flex-wrap:wrap;">
            <button class="fl-btn active" data-pw-tab="overview">Overview</button>
            <button class="fl-btn" data-pw-tab="homeaway">Home/Away</button>
            <button class="fl-btn" data-pw-tab="reasons">Reasons</button>
            <button class="fl-btn" data-pw-tab="minutes">Minutes</button>
            <button class="fl-btn" data-pw-tab="quality">Data Quality</button>
          </div>
          <div id="pwTab-overview" style="display:block;margin-top:8px;">
            <div class="fl-grid two"><div class="fl-card"><div class="fl-mini">Radar Home/Away</div><div style="height:250px;"><canvas id="tpRadar"></canvas></div></div><div class="fl-card"><div class="fl-mini">Tendencia por fecha</div><div style="height:250px;"><canvas id="tpTrend"></canvas></div></div></div><div class="fl-card" style="margin-top:8px;"><div class="fl-mini">Comparador vs fuerza rival (strong/medium/weak)</div><div style="height:220px;"><canvas id="tpBucket"></canvas></div></div>
          </div>
          <div id="pwTab-homeaway" style="display:none;margin-top:8px;"><div class="fl-card"><div style="height:260px;"><canvas id="tpMatrix"></canvas></div></div></div>
          <div id="pwTab-reasons" style="display:none;margin-top:8px;"><div class="fl-card"><div style="height:260px;"><canvas id="tpReasons"></canvas></div></div></div>
          <div id="pwTab-minutes" style="display:none;margin-top:8px;"><div class="fl-card"><div id="tpHeatmap"></div></div></div>
          <div id="pwTab-quality" style="display:none;margin-top:8px;"><div class="fl-card"><div id="tpQuality"></div></div></div>
        `;

        const tabs = node.querySelectorAll('[data-pw-tab]');
        tabs.forEach((btn)=>btn.onclick = ()=>{
          tabs.forEach((b)=>b.classList.remove('active'));
          btn.classList.add('active');
          ['overview','homeaway','reasons','minutes','quality'].forEach((id)=>{
            const el = node.querySelector(`#pwTab-${id}`); if(el) el.style.display = id===btn.getAttribute('data-pw-tab') ? 'block' : 'none';
          });
        });
        node.querySelectorAll('[data-pack-match]').forEach((tr)=>tr.onclick = ()=>{
          const row = agg.matches.find((m)=>m.matchId===tr.getAttribute('data-pack-match'));
          openTeamPackMatchModal(row);
        });

        if(typeof Chart === 'function'){
          const radarCanvas = node.querySelector('#tpRadar');
          if(radarCanvas){
            if(radarCanvas._chart){ try{ radarCanvas._chart.destroy(); }catch(_e){} }
            radarCanvas._chart = new Chart(radarCanvas.getContext('2d'), {
              type:'radar',
              data:{ labels:['Ataque','Defensa','Control','Eficiencia'], datasets:[{ label:'Home', data:[agg.radar.home.attack,agg.radar.home.defense,agg.radar.home.control,agg.radar.home.efficiency], borderColor:'#1f6feb', backgroundColor:'rgba(31,111,235,.2)' },{ label:'Away', data:[agg.radar.away.attack,agg.radar.away.defense,agg.radar.away.control,agg.radar.away.efficiency], borderColor:'#f2cc60', backgroundColor:'rgba(242,204,96,.2)' }] },
              options:{ responsive:true, maintainAspectRatio:false, scales:{ r:{ suggestedMin:0, suggestedMax:100, ticks:{ color:'#9ca3af', backdropColor:'transparent' }, pointLabels:{ color:'#9ca3af' }, grid:{ color:'rgba(255,255,255,.08)' } } }, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } } }
            });
          }
          renderSimpleLineChart(node.querySelector('#tpTrend'), agg.matches.map((m)=>m.date.slice(5)), [
            { label:'Puntos', data:agg.matches.map((m)=>m.points*33.33), borderColor:'#3fb950', backgroundColor:'rgba(63,185,80,.2)', tension:0.2 },
            { label:'Dif goles', data:agg.matches.map((m)=>clamp(50 + m.goalDiff*15, 0, 100)), borderColor:'#ff7b72', backgroundColor:'rgba(255,123,114,.2)', tension:0.2 },
            { label:'Efficiency idx', data:agg.matches.map((m)=>clamp(m.efficiency*100,0,100)), borderColor:'#a371f7', backgroundColor:'rgba(163,113,247,.2)', tension:0.2 }
          ]);

          const bucketCanvas = node.querySelector('#tpBucket');
          if(bucketCanvas){
            const bucketOf = (m)=>{
              const opp = m?.source?.opponent || {};
              const pos = Number(opp?.position ?? opp?.tablePosition);
              const elo = Number(opp?.elo);
              if(Number.isFinite(pos)) return pos<=6 ? 'Strong' : pos<=14 ? 'Medium' : 'Weak';
              if(Number.isFinite(elo)) return elo>=1650 ? 'Strong' : elo>=1500 ? 'Medium' : 'Weak';
              return 'Medium';
            };
            const labels = ['Strong','Medium','Weak'];
            const calc = (rows)=>({
              attack: rows.length ? rows.reduce((a,m)=>a + clamp(45 + m.stats.shotsAll.own*4 + m.stats.shots.own*5,0,100),0)/rows.length : 0,
              defense: rows.length ? rows.reduce((a,m)=>a + clamp(70 - m.stats.shotsAll.opp*4,0,100),0)/rows.length : 0,
              control: rows.length ? rows.reduce((a,m)=>a + clamp(35 + (m.stats.possession.own-45)*1.2,0,100),0)/rows.length : 0,
              efficiency: rows.length ? rows.reduce((a,m)=>a + clamp(m.efficiency*100,0,100),0)/rows.length : 0
            });
            const bucketData = Object.fromEntries(labels.map((label)=>[label, calc(agg.matches.filter((m)=>bucketOf(m)===label))]));
            if(bucketCanvas._chart){ try{ bucketCanvas._chart.destroy(); }catch(_e){} }
            bucketCanvas._chart = new Chart(bucketCanvas.getContext('2d'), {
              type:'bar',
              data:{ labels, datasets:[
                { label:'Attack', data:labels.map((l)=>bucketData[l].attack), backgroundColor:'rgba(31,111,235,.7)' },
                { label:'Defense', data:labels.map((l)=>bucketData[l].defense), backgroundColor:'rgba(63,185,80,.7)' },
                { label:'Control', data:labels.map((l)=>bucketData[l].control), backgroundColor:'rgba(242,204,96,.7)' },
                { label:'Efficiency', data:labels.map((l)=>bucketData[l].efficiency), backgroundColor:'rgba(163,113,247,.7)' }
              ] },
              options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } }, scales:{ x:{ ticks:{ color:'#9ca3af' } }, y:{ min:0, max:100, ticks:{ color:'#9ca3af' } } } }
            });
          }
          const matrix = node.querySelector('#tpMatrix');
          if(matrix){
            if(matrix._chart){ try{ matrix._chart.destroy(); }catch(_e){} }
            const avgSide = (rows, fn)=>rows.length ? rows.reduce((a,r)=>a+fn(r),0)/rows.length : 0;
            matrix._chart = new Chart(matrix.getContext('2d'), { type:'bar', data:{ labels:['Goles','Tiros','Corners','Cards'], datasets:[
              { label:'Home For', data:[avgSide(agg.byVenue.home,r=>r.gf),avgSide(agg.byVenue.home,r=>r.stats.shotsAll.own),avgSide(agg.byVenue.home,r=>r.stats.corners.own),avgSide(agg.byVenue.home,r=>r.stats.cards.own)], backgroundColor:'rgba(31,111,235,.7)' },
              { label:'Home Against', data:[avgSide(agg.byVenue.home,r=>r.ga),avgSide(agg.byVenue.home,r=>r.stats.shotsAll.opp),avgSide(agg.byVenue.home,r=>r.stats.corners.opp),avgSide(agg.byVenue.home,r=>r.stats.cards.opp)], backgroundColor:'rgba(248,81,73,.6)' },
              { label:'Away For', data:[avgSide(agg.byVenue.away,r=>r.gf),avgSide(agg.byVenue.away,r=>r.stats.shotsAll.own),avgSide(agg.byVenue.away,r=>r.stats.corners.own),avgSide(agg.byVenue.away,r=>r.stats.cards.own)], backgroundColor:'rgba(242,204,96,.7)' },
              { label:'Away Against', data:[avgSide(agg.byVenue.away,r=>r.ga),avgSide(agg.byVenue.away,r=>r.stats.shotsAll.opp),avgSide(agg.byVenue.away,r=>r.stats.corners.opp),avgSide(agg.byVenue.away,r=>r.stats.cards.opp)], backgroundColor:'rgba(163,113,247,.6)' }
            ] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } }, scales:{ x:{ ticks:{ color:'#9ca3af' }, stacked:false }, y:{ ticks:{ color:'#9ca3af' }, grid:{ color:'rgba(255,255,255,.06)' } } } } });
          }
          const reasonCanvas = node.querySelector('#tpReasons');
          if(reasonCanvas){
            const tags = ['finishing_failure','momentum_control','counter_strike','wasted_setpieces','discipline_issues'];
            if(reasonCanvas._chart){ try{ reasonCanvas._chart.destroy(); }catch(_e){} }
            reasonCanvas._chart = new Chart(reasonCanvas.getContext('2d'), { type:'bar', data:{ labels:agg.matches.map((m)=>m.date.slice(5)), datasets:tags.map((tag,idx)=>({ label:tag, data:agg.matches.map((m)=>clamp((Number(m.tagMap[tag]?.strength)||0)*100,0,100)), backgroundColor:["#1f6feb","#3fb950","#f2cc60","#ff7b72","#a371f7"][idx] })) }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } }, scales:{ x:{ stacked:true, ticks:{ color:'#9ca3af' } }, y:{ stacked:true, min:0, max:100, ticks:{ color:'#9ca3af' } } } } });
          }
        }
        const heat = node.querySelector('#tpHeatmap');
        if(heat){
          const buckets = [0,15,30,45,60,75];
          const vals = buckets.map((b)=>agg.matches.reduce((acc,m)=>acc + (m.reasons || []).reduce((rAcc,r)=>rAcc + (r.mins || []).filter((x)=>Number(x)>=b && Number(x)<b+15).length,0),0));
          const maxV = Math.max(1, ...vals);
          heat.innerHTML = `<div class="fl-row" style="gap:6px;flex-wrap:wrap;">${vals.map((v,i)=>`<div style="width:94px;padding:10px;border-radius:8px;background:rgba(31,111,235,${(v/maxV).toFixed(2)});border:1px solid rgba(255,255,255,.08);"><div class="fl-mini">${buckets[i]}-${buckets[i]+15}</div><b>${v}</b></div>`).join('')}</div><div class="fl-mini" style="margin-top:6px;">ADN temporal: mayor actividad/tag en bloques más oscuros.</div>`;
        }
        const quality = node.querySelector('#tpQuality');
        if(quality){
          const avgComp = agg.confidence;
          const missPoss = agg.matches.filter((m)=>(m.stats.possession.own + m.stats.possession.opp)===0).length;
          const missShotsOT = agg.matches.filter((m)=>(m.stats.shots.own + m.stats.shots.opp)===0).length;
          quality.innerHTML = `<div class="fl-mini">Checklist mínimo: resultado/H-A/relato/stats base + opcionales (posesión/xG).</div><div style="margin-top:6px;">Completeness promedio: <b>${(avgComp*100).toFixed(1)}%</b> · Confidence: <b>${confidenceLabel}</b></div><div class="fl-mini" style="margin-top:6px;">Falta posesión en <b>${missPoss}</b> partidos · faltan tiros a puerta en <b>${missShotsOT}</b>.</div>`;
        }
      };

      document.getElementById("teamPackExportBtn").onclick = async ()=>{
        const status = document.getElementById("teamPackExportStatus");
        const win = String(document.getElementById("teamPackWindow")?.value || "20");
        const recalcSnapshots = !!document.getElementById("teamPackRecalc")?.checked;
        const compactNarrative = !!document.getElementById("teamPackCompactNarrative")?.checked;
        const includeFeaturesRaw = !!document.getElementById("teamPackIncludeRawFeatures")?.checked;
        const sorted = [...teamMatches].sort(compareByDateAsc);
        const selectedMatches = win === "season"
          ? sorted
          : sorted.slice(-clamp(Number(win) || 20, 1, 200));
        if(!selectedMatches.length){
          if(status) status.textContent = "⚠️ Sin partidos para exportar.";
          return;
        }
        if(status) status.textContent = "⏳ Generando TeamPack...";
        try{
          const pack = await buildTeamPack({
            db,
            team,
            matches: selectedMatches,
            includeStats: true,
            includeNarrative: true,
            includeSnapshots: true,
            recalcSnapshots,
            narrativeMaxChars: compactNarrative ? 2000 : 0,
            includeFeaturesRaw
          });
          if(!pack || !pack.team || !pack.team.id) throw new Error("No se pudo generar un TeamPack válido.");
          await saveTeamPackRecord(team.id, {
            manifest: {
              schemaVersion: pack.schemaVersion,
              createdAt: pack.createdAt,
              team: pack.team,
              range: pack.range,
              cutoffDate: pack.cutoffDate,
              matches: pack.matches.length,
              snapshots: pack.snapshots.length,
              compactNarrative,
              includeFeaturesRaw
            },
            matches: pack.matches,
            snapshots: pack.snapshots
          });
          const json = JSON.stringify(pack, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `teampack_${team.id}_${pack.range.from || "na"}_${pack.range.to || "na"}.json`;
          a.click();
          URL.revokeObjectURL(url);
          if(status) status.textContent = `✅ Exportado (${pack.matches.length} partidos, ${pack.snapshots.length} snapshots).`;
        }catch(err){
          if(status) status.textContent = `❌ ${err?.message || "No se pudo exportar"}`;
        }
      };

      const renderTeamPackStrength = (pack)=>{
        const strengthEl = document.getElementById("teamPackStrength");
        const metaEl = document.getElementById("teamPackImportedMeta");
        if(!pack){
          if(metaEl) metaEl.textContent = "Sin pack importado.";
          if(strengthEl) strengthEl.textContent = "Conozco al equipo: --%";
          const dashboard = document.getElementById('teamPackPowerDashboard');
          if(dashboard) dashboard.style.display = 'none';
          return;
        }
        const s = computeTeamPackDataStrength(pack);
        if(metaEl) metaEl.innerHTML = [
          `Equipo: <b>${pack?.team?.name || "-"}</b>`,
          `Rango: <b>${pack?.range?.from || "-"}</b> → <b>${pack?.range?.to || "-"}</b>`,
          `Cutoff: <b>${pack?.cutoffDate || pack?.range?.to || "-"}</b>`,
          `Partidos: <b>${s.matches}</b> · Stats: <b>${Math.round(s.pctStats*100)}%</b> · Relato: <b>${Math.round(s.pctNarrative*100)}%</b> · Snapshots: <b>${Math.round(s.pctSnapshots*100)}%</b>`
        ].join("<br>");
        if(strengthEl) strengthEl.innerHTML = [
          `<b>Conozco al ${pack?.team?.name || "equipo"}: ${s.score}%</b>`,
          "Estoy usando los datos desde el perfil del equipo.",
          `Cobertura: ${s.coverage.toFixed(2)} · Recencia: ${s.recency.toFixed(2)} (hace ${s.daysSinceLast} días) · Completitud: ${s.completeness.toFixed(2)} · Consistencia: ${s.consistency.toFixed(2)}`,
          `Checks críticos → missingCriticalRate: ${s.missingCriticalRate.toFixed(2)} · duplicateMatchIdRate: ${s.duplicateMatchIdRate.toFixed(2)} · unorderedDateRate: ${s.unorderedDateRate.toFixed(2)}`
        ].join("<br>");
        renderTeamPackDashboard(pack);
      };

      document.getElementById("teamPackImportBtn").onclick = ()=>document.getElementById("teamPackFileInput")?.click();
      document.getElementById("teamPackFileInput").onchange = async (e)=>{
        const status = document.getElementById("teamPackImportStatus");
        const file = e.target.files?.[0];
        if(!file) return;
        try{
          const text = await file.text();
          const parsed = safeParseJSON(text, null);
          if(!parsed || parsed.schemaVersion !== "FL_TEAMPACK_v1") throw new Error("Pack viejo, necesita migración");
          const shouldRecalcSnapshots = !!document.getElementById("teamPackImportRecalcSnapshots")?.checked;
          if((!Array.isArray(parsed.snapshots) || !parsed.snapshots.length) && shouldRecalcSnapshots){
            const teamId = parsed?.team?.id;
            const sourceMatches = (db.tracker || []).filter((m)=>m.homeId===teamId || m.awayId===teamId);
            parsed.snapshots = [];
            for(const m of sourceMatches){
              let snapshot = m?.featureSnapshots?.[teamId] || null;
              if(!snapshot){
                try{ snapshot = await calculateSnapshotForMatch({ db, team, match: m }); }catch(_e){ snapshot = null; }
              }
              if(!snapshot) continue;
              parsed.snapshots.push({
                matchId: String(m.id),
                matchDate: m.date || "",
                featureSchema: "F9_v1",
                features: normalizeFeatureSchema(snapshot),
                featuresRaw: snapshot?.features || null,
                audit: snapshot?.featureAudit || {}
              });
            }
            parsed.snapshots.sort((a,b)=>parseSortableDate(a.matchDate)-parseSortableDate(b.matchDate));
          }
          importedPack = parsed;
          await saveTeamPackRecord(parsed?.team?.id || "unknown", {
            manifest: {
              schemaVersion: parsed.schemaVersion,
              createdAt: parsed.createdAt,
              team: parsed.team,
              range: parsed.range,
              cutoffDate: parsed.cutoffDate || parsed?.range?.to || "",
              matches: parsed.matches?.length || 0,
              snapshots: parsed.snapshots?.length || 0
            },
            matches: parsed.matches || [],
            snapshots: parsed.snapshots || []
          });
          saveTeamBrainFeatures(parsed?.team?.id || "", parsed?.snapshots || []);
          renderTeamPackStrength(importedPack);
          if(status) status.textContent = "✅ TeamPack importado.";
        }catch(err){
          if(status) status.textContent = `❌ ${err?.message || "No se pudo importar"}`;
        }
      };

      document.getElementById("teamPackTrainBtn").onclick = ()=>{
        const out = document.getElementById("teamPackTrainOutput");
        if(!importedPack){
          if(out) out.textContent = "⚠️ Importa un TeamPack antes de entrenar.";
          return;
        }
        const windowSize = clamp(Number(document.getElementById("teamPackTrainWindow")?.value) || 5, 5, 10);
        const epochs = clamp(Number(document.getElementById("teamPackTrainEpochs")?.value) || 5, 1, 20);
        const batchSize = clamp(Number(document.getElementById("teamPackTrainBatch")?.value) || 16, 8, 64);
        const snapshots = Array.isArray(importedPack.snapshots) ? [...importedPack.snapshots].sort((a,b)=>parseSortableDate(a.matchDate)-parseSortableDate(b.matchDate)) : [];
        const matches = Array.isArray(importedPack.matches) ? importedPack.matches : [];
        const examples = matches.map((m)=>{
          const mTs = parseSortableDate(m.matchDate);
          const seqTeam = snapshots.filter((s)=>parseSortableDate(s.matchDate) < mTs).slice(-windowSize);
          const isHome = String(m.homeAway || "").toLowerCase()==="home";
          const gf = Number(isHome ? m?.scoreFT?.home : m?.scoreFT?.away) || 0;
          const ga = Number(isHome ? m?.scoreFT?.away : m?.scoreFT?.home) || 0;
          const label = gf>ga ? 1 : gf===ga ? 0 : -1;
          return { seqTeam, unknownOpp: true, label };
        });
        const usable = examples.filter((x)=>x.seqTeam.length>0).length;
        const strength = computeTeamPackDataStrength(importedPack);
        const baseLoss = clamp(1.4 - (strength.score/100) - (usable / Math.max(1, examples.length))*0.4, 0.12, 1.8);
        const finalLoss = clamp(baseLoss * (1 - epochs*0.03) * (batchSize===32 ? 0.96 : 1), 0.05, 1.8);
        const fitScore = clamp((strength.score/100) * 0.7 + (usable / Math.max(1, examples.length))*0.3, 0, 1);
        const models = getJsonStorage(TEAM_MODELS_KEY);
        models[importedPack?.team?.id || "unknown"] = {
          weights: { pseudoLoss: finalLoss, fitScore, examples: usable, windowSize, epochs, batchSize },
          schemaVersion: importedPack.schemaVersion,
          trainedAt: new Date().toISOString(),
          dataScoreAtTrain: strength.score,
          trainedOnRange: { from: importedPack?.range?.from || "", to: importedPack?.range?.to || "" },
          trainedOnMatchesCount: matches.length,
          cutoffDate: importedPack?.cutoffDate || importedPack?.range?.to || ""
        };
        localStorage.setItem(TEAM_MODELS_KEY, JSON.stringify(models));
        saveTeamBrainFeatures(importedPack?.team?.id || "", importedPack?.snapshots || []);
        if(out) out.innerHTML = [
          `✅ Modelo actualizado (${new Date().toLocaleString()}).`,
          `Pseudo-loss final: <b>${finalLoss.toFixed(4)}</b> · Fit score: <b>${(fitScore*100).toFixed(1)}%</b>.`,
          `Entrenado con ${usable}/${examples.length} ejemplos útiles · ventana ${windowSize} · epochs ${epochs} · batch ${batchSize}.`,
          "Brain sync: snapshots del pack guardados para autoload en pestaña Brain."
        ].join("<br>");
        renderTeamPackDashboard(importedPack);
      };

      loadTeamPackRecord(team.id).then((record)=>{
        if(!record) return;
        importedPack = {
          schemaVersion: record?.manifest?.schemaVersion || "FL_TEAMPACK_v1",
          createdAt: record?.manifest?.createdAt || record?.updatedAt || new Date().toISOString(),
          team: record?.manifest?.team || team,
          range: record?.manifest?.range || {},
          cutoffDate: record?.manifest?.cutoffDate || record?.manifest?.range?.to || "",
          matches: Array.isArray(record?.matches) ? record.matches : [],
          snapshots: Array.isArray(record?.snapshots) ? record.snapshots : []
        };
        renderTeamPackStrength(importedPack);
      }).catch(()=>{});

      document.getElementById("saveMeta").onclick = ()=>{
        let factorDia = {};
        const rawFactorDia = document.getElementById("ctx-factor-dia")?.value?.trim() || "";
        if(rawFactorDia){
          try{
            const parsed = JSON.parse(rawFactorDia);
            factorDia = typeof parsed === "object" && parsed !== null ? parsed : {};
          }catch(_e){
            alert("Factor por día inválido. Usa JSON, por ejemplo: {\"Tuesday\": -0.2}");
            return;
          }
        }
        team.meta = {
          stadium: document.getElementById("teamStadium").value.trim(),
          city: document.getElementById("teamCity").value.trim(),
          capacity: document.getElementById("teamCapacity").value.trim()
        };
        team.contextoEstrategico = {
          rachaLocal: document.getElementById("ctx-racha")?.value?.trim() || "",
          ausenciasClave: parseCommaList(document.getElementById("ctx-bajas")?.value || ""),
          patrones: parseCommaList(document.getElementById("ctx-insights")?.value || ""),
          factorDia
        };
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      content.querySelectorAll("[data-player-pos]").forEach(sel=>sel.onchange = (e)=>{
        const playerId = sel.getAttribute("data-player-pos");
        const player = db.players.find((x)=>x.id===playerId && x.teamId===team.id);
        if(!player) return;
        player.pos = normalizePlayerPos(e.target.value);
        saveDb(db);
        render("equipo", { teamId: team.id });
      });
      document.getElementById("runSquadImport").onclick = ()=>{
        try{
          const raw = document.getElementById("squadImport").value.trim();
          let rows = [];
          let importedTeamName = "";
          if(raw.startsWith("{") || raw.startsWith("[")){
            const data = JSON.parse(raw);
            rows = (data.squadBySection||[]).flatMap(sec=>(sec.rows||[]).map(r=>parseImportedSquadRow(r, sectionToPos(sec.section))));
            importedTeamName = String(data.team?.name||"").trim();
          }else{
            rows = parseManualSquadText(raw);
          }
          if(!rows.length) throw new Error("No se encontraron jugadores válidos en el texto importado");
          if(importedTeamName){
            team.name = importedTeamName.replace(/^Fútbol:\s*/i,"").replace(/\s*-\s*plantilla$/i,"").trim() || team.name;
          }
          let created=0, updated=0;
          rows.forEach(r=>{
            const name = String(r.name||"").trim();
            if(!name) return;
            let p = db.players.find(x=>x.teamId===team.id && x.name.toLowerCase()===name.toLowerCase());
            if(!p){
              db.players.push({ id: uid("pl"), teamId: team.id, ...r, pos: normalizePlayerPos(r.pos) });
              created++;
            }else{
              p.pos = normalizePlayerPos(p.pos || r.pos);
              p.number = r.number ?? p.number;
              p.age = r.age ?? p.age;
              p.appearances = r.appearances ?? p.appearances;
              p.minutes = r.minutes ?? p.minutes;
              p.goals = r.goals ?? p.goals;
              p.assists = r.assists ?? p.assists;
              p.yellowCards = r.yellowCards ?? p.yellowCards;
              p.redCards = r.redCards ?? p.redCards;
              p.flag = r.flag || p.flag;
              updated++;
            }
          });
          saveDb(db);
          document.getElementById("squadStatus").textContent = `✅ Importado. Nuevos: ${created}, actualizados: ${updated}`;
          render("equipo", { teamId: team.id });
        }catch(err){
          document.getElementById("squadStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      document.getElementById("syncResultsFromMemory").onclick = ()=>{
        const status = document.getElementById("resultStatus");
        const brainV2 = loadBrainV2();
        const out = syncMemoryMatchesIntoResultsModule({
          db,
          brainV2,
          team,
          ensureTrackerMatchState,
          uid
        });
        saveDb(db);
        status.textContent = out.inserted>0
          ? `✅ Sincronización completada. Importados: ${out.inserted}.`
          : "Todo sincronizado. No hay partidos nuevos para importar.";
        render("equipo", { teamId: team.id });
      };

      document.getElementById("addResult").onclick = ()=>{
        const homeId = document.getElementById("resHome").value;
        const awayId = document.getElementById("resAway").value;
        const status = document.getElementById("resultStatus");
        if(!homeId || !awayId || homeId===awayId){
          status.textContent = "Selecciona local y visitante distintos.";
          return;
        }
        const leagueId = db.settings.selectedLeagueId || "";
        if(leagueId){
          ensureTeamInLeague(db, homeId, leagueId);
          ensureTeamInLeague(db, awayId, leagueId);
        }
        const newMatch = ensureTrackerMatchState({
          id: uid("tr"),
          leagueId,
          date: document.getElementById("resDate").value,
          homeId,
          awayId,
          homeGoals: Number(document.getElementById("resHG").value)||0,
          awayGoals: Number(document.getElementById("resAG").value)||0,
          note: "",
          stats: [],
          statsRaw: null,
          featureSnapshots: {},
          featureSnapshotStatus: {}
        });
        db.tracker.push(newMatch);
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      renderSimpleLineChart(
        document.getElementById("teamPowerHistoryChart"),
        intel.metrics.labels,
        [{ label: "Team Power Index", data: intel.metrics.powerSeries, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.2)", tension: 0.25 }]
      );
      renderSimpleLineChart(
        document.getElementById("teamMomentumTripleChart"),
        intel.momentum.labels,
        [
          { label: "xG diferencial", data: intel.momentum.xgDifferential, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.15)", tension: 0.2 },
          { label: "Resultado real", data: intel.momentum.realPerformance, borderColor: "#2ea043", backgroundColor: "rgba(46,160,67,.12)", tension: 0.2 },
          { label: "Rendimiento esperado", data: intel.momentum.expectedPerformance, borderColor: "#d29922", backgroundColor: "rgba(210,153,34,.14)", tension: 0.2 }
        ]
      );
      renderRadarChart(
        document.getElementById("teamPsychRadar"),
        ["Agresividad", "Resiliencia", "Volatilidad", "Fatiga mental"],
        [intel.psych.aggressiveness, intel.psych.resilience, intel.psych.volatility, intel.psych.fatigue],
        "#ff7b72"
      );
      renderRadarChart(
        document.getElementById("teamTacticalRadar"),
        ["Ataque directo", "Posesión", "Transiciones", "Presión", "Balón parado"],
        [intel.tactical.directAttack, intel.tactical.possession, intel.tactical.transitions, intel.tactical.press, intel.tactical.setPieces],
        "#58a6ff"
      );
      content.querySelectorAll("[data-open-stats-modal]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-open-stats-modal"));
        openStatsModal({ db, match, team, onSave: ()=>render("equipo", { teamId: team.id }) });
      });
      content.querySelectorAll("[data-open-engine-modal]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-open-engine-modal"));
        openTeamEngineModal({ db, match, team, brainV2: brainV2TeamState, onSave: ()=>render("equipo", { teamId: team.id }) });
      });
      const runBulkCalculation = async (matches)=>{
        const status = document.getElementById("resultStatus");
        let ok = 0;
        let fail = 0;
        for(const match of matches){
          try{
            match.featureSnapshotStatus ||= {};
            match.featureSnapshotStatus[team.id] = { status: "calculando", updatedAt: new Date().toISOString() };
            saveDb(db);
            await calculateSnapshotForMatch({ db, team, match });
            ok += 1;
          }catch(err){
            match.featureSnapshotStatus ||= {};
            match.featureSnapshotStatus[team.id] = { status: "error", error: String(err.message || err), updatedAt: new Date().toISOString() };
            saveDb(db);
            fail += 1;
          }
        }
        status.textContent = `Cálculo completado: ${ok} ok / ${fail} error.`;
        render("equipo", { teamId: team.id });
      };

      document.getElementById("calcLast5Btn").onclick = async ()=>{
        const sorted = [...teamMatches].sort(compareByDateAsc);
        await runBulkCalculation(sorted.slice(-5));
      };
      document.getElementById("calcAllBtn").onclick = async ()=>{
        const sorted = [...teamMatches].sort(compareByDateAsc);
        await runBulkCalculation(sorted);
      };
      content.querySelectorAll("[data-calc-match]").forEach((btn)=>btn.onclick = async ()=>{
        const match = db.tracker.find((m)=>m.id===btn.getAttribute("data-calc-match"));
        if(!match) return;
        match.featureSnapshotStatus ||= {};
        match.featureSnapshotStatus[team.id] = { status: "calculando", updatedAt: new Date().toISOString() };
        saveDb(db);
        render("equipo", { teamId: team.id });
        try{
          await calculateSnapshotForMatch({ db, team, match });
        }catch(err){
          match.featureSnapshotStatus[team.id] = { status: "error", error: String(err.message || err), updatedAt: new Date().toISOString() };
          saveDb(db);
        }
        render("equipo", { teamId: team.id });
      });
      content.querySelectorAll("[data-move-match]").forEach(btn=>btn.onclick = ()=>{
        const matchId = btn.getAttribute("data-move-match");
        const delta = Number(btn.getAttribute("data-move-delta"));
        if(!matchId || !Number.isFinite(delta)) return;
        const orderedIds = teamMatches.map(m=>m.id);
        const idx = orderedIds.indexOf(matchId);
        if(idx<0) return;
        const target = idx + delta;
        if(target<0 || target>=orderedIds.length) return;
        [orderedIds[idx], orderedIds[target]] = [orderedIds[target], orderedIds[idx]];
        orderedIds.forEach((id, order)=>{
          const match = db.tracker.find(m=>m.id===id);
          if(match) match.manualOrder = order;
        });
        saveDb(db);
        render("equipo", { teamId: team.id });
      });
      content.querySelectorAll("[data-edit-match]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-edit-match"));
        if(!match) return;
        ensureTrackerMatchState(match);
        const teamIsHome = match.homeId===team.id;
        const date = prompt("Fecha del partido (YYYY-MM-DD)", match.date || "") || match.date || "";
        const homeGoals = prompt("Goles del local", String(match.homeGoals ?? 0));
        const awayGoals = prompt("Goles del visitante", String(match.awayGoals ?? 0));
        if(homeGoals===null || awayGoals===null) return;
        const lineupPrompt = prompt("XI titular de este equipo (coma separado)", parseLineupList(teamIsHome ? match.homeLineup : match.awayLineup).join(", "));
        if(lineupPrompt===null) return;
        const formationPrompt = prompt("Formación usada (ej. 4-3-3)", teamIsHome ? (match.homeFormation || "") : (match.awayFormation || ""));
        if(formationPrompt===null) return;
        const earlySubsPrompt = prompt("Cambios tempranos (0-3)", String(teamIsHome ? (match.homeEarlySubs || 0) : (match.awayEarlySubs || 0)));
        if(earlySubsPrompt===null) return;
        const systemChangesPrompt = prompt("Cambios de sistema en partido", String(teamIsHome ? (match.homeSystemChanges || 0) : (match.awaySystemChanges || 0)));
        if(systemChangesPrompt===null) return;
        match.date = String(date).trim();
        match.homeGoals = Number(homeGoals)||0;
        match.awayGoals = Number(awayGoals)||0;
        if(teamIsHome){
          match.homeLineup = parseLineupList(lineupPrompt);
          match.homeFormation = String(formationPrompt || "").trim();
          match.homeEarlySubs = Math.max(0, Number(earlySubsPrompt) || 0);
          match.homeSystemChanges = Math.max(0, Number(systemChangesPrompt) || 0);
        }else{
          match.awayLineup = parseLineupList(lineupPrompt);
          match.awayFormation = String(formationPrompt || "").trim();
          match.awayEarlySubs = Math.max(0, Number(earlySubsPrompt) || 0);
          match.awaySystemChanges = Math.max(0, Number(systemChangesPrompt) || 0);
        }
        saveDb(db);
        render("equipo", { teamId: team.id });
      });
      content.querySelectorAll("[data-delete-match]").forEach(btn=>btn.onclick = ()=>{
        const matchId = btn.getAttribute("data-delete-match");
        const match = db.tracker.find(m=>m.id===matchId);
        if(!match) return;
        if(!confirm("¿Borrar este partido?")) return;
        db.tracker = db.tracker.filter(m=>m.id!==matchId);
        saveDb(db);
        render("equipo", { teamId: team.id });
      });
      return;
    }

    if(view==="tracker"){
      if(!db.settings.selectedLeagueId && db.leagues[0]) db.settings.selectedLeagueId = db.leagues[0].id;
      const leagueOptions = db.leagues.map(l=>`<option value="${l.id}" ${db.settings.selectedLeagueId===l.id?"selected":""}>${l.name}</option>`).join("");
      const leagueTeams = db.settings.selectedLeagueId ? getTeamsForLeague(db, db.settings.selectedLeagueId) : db.teams;
      const options = leagueTeams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const rows = db.tracker.filter(t=>!db.settings.selectedLeagueId || t.leagueId===db.settings.selectedLeagueId).map(t=>`<tr><td>${t.date||""}</td><td>${db.leagues.find(l=>l.id===t.leagueId)?.name||"-"}</td><td>${db.teams.find(x=>x.id===t.homeId)?.name||"-"}</td><td>${t.homeGoals}-${t.awayGoals}</td><td>${db.teams.find(x=>x.id===t.awayId)?.name||"-"}</td><td>${t.note||""}</td><td><button class="fl-btn" data-open-match="${t.id}">Abrir</button></td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card"><div class="fl-row">
          <select id="trLeague" class="fl-select"><option value="">Liga</option>${leagueOptions}</select>
          <input id="trDate" type="date" class="fl-input" />
          <select id="trHome" class="fl-select"><option value="">Local</option>${options}</select>
          <input id="trHG" type="number" class="fl-input" placeholder="GL" style="width:74px" />
          <input id="trAG" type="number" class="fl-input" placeholder="GV" style="width:74px" />
          <select id="trAway" class="fl-select"><option value="">Visitante</option>${options}</select>
          <input id="trNote" class="fl-input" placeholder="Nota" />
          <button class="fl-btn" id="addTrack">Guardar</button>
        </div>
        <div class="fl-row" style="margin-top:8px;">
          <input id="trHXg" type="number" step="0.01" class="fl-input" placeholder="xG L" style="width:84px" />
          <input id="trAXg" type="number" step="0.01" class="fl-input" placeholder="xG V" style="width:84px" />
          <input id="trHC" type="number" class="fl-input" placeholder="Corners L" style="width:94px" />
          <input id="trAC" type="number" class="fl-input" placeholder="Corners V" style="width:94px" />
          <input id="trHY" type="number" class="fl-input" placeholder="Amarillas L" style="width:104px" />
          <input id="trAY" type="number" class="fl-input" placeholder="Amarillas V" style="width:104px" />
          <input id="trRefCards" type="number" step="0.1" class="fl-input" placeholder="Tarjetas árbitro" style="width:130px" />
          <input id="trOddH" type="number" step="0.01" class="fl-input" placeholder="Cuota 1" style="width:84px" />
          <input id="trOddD" type="number" step="0.01" class="fl-input" placeholder="Cuota X" style="width:84px" />
          <input id="trOddA" type="number" step="0.01" class="fl-input" placeholder="Cuota 2" style="width:84px" />
        </div></div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Fecha</th><th>Liga</th><th>Local</th><th>Marcador</th><th>Visitante</th><th>Nota</th><th></th></tr></thead><tbody>${rows||"<tr><td colspan='7'>Sin eventos</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("trLeague").onchange = (e)=>{
        db.settings.selectedLeagueId = e.target.value;
        saveDb(db);
        render("tracker");
      };
      document.getElementById("addTrack").onclick = ()=>{
        const homeId = document.getElementById("trHome").value;
        const awayId = document.getElementById("trAway").value;
        if(!homeId || !awayId || homeId===awayId) return;
        const leagueId = db.settings.selectedLeagueId || "";
        if(leagueId){
          ensureTeamInLeague(db, homeId, leagueId);
          ensureTeamInLeague(db, awayId, leagueId);
        }
        const trackedMatch = ensureTrackerMatchState({
          id: uid("tr"),
          leagueId,
          date: document.getElementById("trDate").value,
          homeId,
          awayId,
          homeGoals: Number(document.getElementById("trHG").value)||0,
          awayGoals: Number(document.getElementById("trAG").value)||0,
          homeXg: pickFirstNumber(document.getElementById("trHXg").value),
          awayXg: pickFirstNumber(document.getElementById("trAXg").value),
          homeCorners: pickFirstNumber(document.getElementById("trHC").value),
          awayCorners: pickFirstNumber(document.getElementById("trAC").value),
          homeYellow: pickFirstNumber(document.getElementById("trHY").value),
          awayYellow: pickFirstNumber(document.getElementById("trAY").value),
          refereeCardsAvg: pickFirstNumber(document.getElementById("trRefCards").value),
          oddsHome: pickFirstNumber(document.getElementById("trOddH").value),
          oddsDraw: pickFirstNumber(document.getElementById("trOddD").value),
          oddsAway: pickFirstNumber(document.getElementById("trOddA").value),
          note: document.getElementById("trNote").value.trim(),
          stats: [],
          statsRaw: null,
          featureSnapshots: {},
          featureSnapshotStatus: {}
        });
        db.tracker.push(trackedMatch);
        saveDb(db);
        render("tracker");
      };
      content.querySelectorAll("[data-open-match]").forEach(btn=>btn.onclick = ()=>render("match", { matchId: btn.getAttribute("data-open-match") }));
      return;
    }

    if(view==="match"){
      const match = db.tracker.find(m=>m.id===payload.matchId);
      if(!match){
        content.innerHTML = `<div class="fl-card">Partido no encontrado.</div>`;
        return;
      }
      match.stats ||= [];
      match.narrativeModule ||= { rawText: "", normalized: null, diagnostic: null };
      const home = db.teams.find(t=>t.id===match.homeId);
      const away = db.teams.find(t=>t.id===match.awayId);
      const league = db.leagues.find(l=>l.id===match.leagueId);
      const statsHtml = match.stats.length
        ? statsBarsHtml(match.stats)
        : `<div class="fl-muted">Sin estadísticas. Pega JSON para cargar.</div>`;
      const labels = match.narrativeModule?.diagnostic?.labels || null;
      const homeOpp = match?.opponentStrengthByTeam?.[match.homeId] || null;
      const awayOpp = match?.opponentStrengthByTeam?.[match.awayId] || null;
      const oppTooltip = (snap)=>{
        if(!snap) return "Sin snapshot";
        const w = snap?.blend?.weights || {};
        return `Elo ${snap.signals?.elo?.value ?? "-"} (c ${snap.signals?.elo?.conf ?? "-"}) · Tabla ${(snap.signals?.table?.value ?? "-")} (c ${snap.signals?.table?.conf ?? "-"}) · Market ${(snap.signals?.market?.value ?? "-")} (c ${snap.signals?.market?.conf ?? "-"}) · Blend ${snap.blend?.strength01 ?? "-"} (w ${w.elo ?? "-"}/${w.table ?? "-"}/${w.market ?? "-"})`;
      };
      const diagHtml = labels ? `
        <div class="fl-mini">Minuto quiebre: <b>${match.narrativeModule.diagnostic.breakMinute ?? "N/A"}</b></div>
        <div class="fl-grid" style="margin-top:8px;grid-template-columns:1fr;">
          ${Object.entries(labels).map(([k,v])=>`<div><div class="fl-mini">${k.replaceAll("_"," ")}: ${(Number(v)*100).toFixed(0)}%</div><div style="height:8px;background:#242b36;border-radius:999px;"><div style="width:${clamp(Number(v)||0,0,1)*100}%;height:8px;background:#1f6feb;border-radius:999px;"></div></div></div>`).join("")}
        </div>
        <ul style="margin:10px 0 0 16px;">${(match.narrativeModule.diagnostic.summary||[]).map(s=>`<li class="fl-mini">${s}</li>`).join("")}</ul>
      ` : `<div class="fl-muted">Sin diagnóstico todavía.</div>`;

      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-muted">${league?.name || "Liga"} • ${match.date || "sin fecha"}</div>
          <div style="font-size:28px;font-weight:900;margin-top:4px;">${home?.name || "Local"} ${match.homeGoals}-${match.awayGoals} ${away?.name || "Visitante"}</div>
          <div class="fl-row" style="margin-top:8px;gap:8px;">
            <span class="chip" title="${oppTooltip(homeOpp)}">OAS ${home?.name || "Local"}: ${homeOpp?.blend?.strength01 ?? "-"}</span>
            <span class="chip" title="${oppTooltip(awayOpp)}">OAS ${away?.name || "Visitante"}: ${awayOpp?.blend?.strength01 ?? "-"}</span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Estadísticas</div>
          ${statsHtml}
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">📋 Pegar relato</div>
          <textarea id="matchNarrative" class="fl-text" placeholder="Pega el relato línea por línea con minutos.">${match.narrativeModule.rawText || ""}</textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="convertNarrative">Convertir</button>
            <span id="narrativeStatus" class="fl-muted"></span>
          </div>
          <div id="normalizedEvents" class="fl-mini" style="margin-top:8px;"></div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">🕵️ Diagnóstico</div>
          ${diagHtml}
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">➕ Guardar al perfil</div>
          <div class="fl-row">
            <button class="fl-btn" id="applyDiag">Aplicar al ${home?.name || "Local"} y ${away?.name || "Visitante"}</button>
            <button class="fl-btn" id="saveStats">Guardar estadísticas</button>
            <button class="fl-btn" id="goBackMatch">Volver</button>
            <span id="statsStatus" class="fl-muted"></span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">Importar estadísticas JSON</div>
          <textarea id="statsImport" class="fl-text" placeholder='{"stats":[{"key":"Posesión","home":"67%","away":"33%"}]}'></textarea>
        </div>
      `;

      const renderEventsPreview = ()=>{
        const list = match.narrativeModule?.normalized?.events || [];
        document.getElementById("normalizedEvents").innerHTML = list.length
          ? `<b>Eventos extraídos (${list.length}):</b><br/>` + list.slice(0,30).map(e=>`${e.min ?? "?"}' • ${e.type} • ${e.team || "?"}${e.player ? ` • ${e.player}`:""}`).join("<br/>")
          : "Sin eventos convertidos aún.";
      };
      renderEventsPreview();

      document.getElementById("convertNarrative").onclick = ()=>{
        const raw = document.getElementById("matchNarrative").value;
        const parsed = extractNarratedEvents(raw, { home: home?.name || "Local", away: away?.name || "Visitante" });
        const diagnostic = buildNarrativeDiagnostic({ match, teams: { home: home?.name || "Local", away: away?.name || "Visitante" }, parsed });
        match.narrativeModule = {
          rawText: raw,
          normalized: {
            matchId: match.id,
            teams: { home: home?.name || "Local", away: away?.name || "Visitante" },
            events: parsed.events,
            counters: parsed.counters
          },
          diagnostic: { matchId: match.id, diagnostic }
        };
        saveDb(db);
        document.getElementById("narrativeStatus").textContent = `✅ ${parsed.events.length} eventos convertidos`;
        render("match", payload);
      };

      document.getElementById("applyDiag").onclick = ()=>{
        if(!match.narrativeModule?.diagnostic?.diagnostic){
          document.getElementById("statsStatus").textContent = "❌ Convierte un relato primero.";
          return;
        }
        applyDiagnosticToProfiles(db, { match, diagnostic: match.narrativeModule.diagnostic.diagnostic });
        saveDb(db);
        document.getElementById("statsStatus").textContent = "✅ Perfil acumulado actualizado (EMA).";
      };

      document.getElementById("saveStats").onclick = ()=>{
        try{
          const stats = parseStatsPayload(document.getElementById("statsImport").value.trim());
          match.stats = stats;
          saveDb(db);
          render("match", payload);
        }catch(err){
          document.getElementById("statsStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      document.getElementById("goBackMatch").onclick = ()=>{
        if(payload.backTeamId) return render("equipo", { teamId: payload.backTeamId });
        render("tracker");
      };
      return;
    }

    if(view==="brainv2"){
      const brainV2 = loadBrainV2();
      const health = computeBrainV2Health(brainV2.memories);
      const selectedLeagueId = payload.leagueId || db.settings.selectedLeagueId || db.leagues[0]?.id || "";
      const leagues = db.leagues.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      const leagueOptions = leagues.map((l)=>`<option value="${l.id}" ${selectedLeagueId===l.id?"selected":""}>${l.name}</option>`).join("");
      const leagueTeams = selectedLeagueId ? getTeamsForLeague(db, selectedLeagueId) : db.teams;
      const sortedTeams = leagueTeams.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      const selectedTeamId = payload.teamId || sortedTeams[0]?.id || "";
      const selectedTeamName = db.teams.find((t)=>t.id===selectedTeamId)?.name || "Local";
      const teamOptions = sortedTeams.map((t)=>`<option value="${t.id}" ${selectedTeamId===t.id?"selected":""}>${t.name}</option>`).join("");
      const teamMemories = (brainV2.memories[selectedTeamId] || []).slice().sort((a,b)=>parseSortableDate(b.date)-parseSortableDate(a.date));
      const teamMatchRefs = getTeamMatchRefs(brainV2, { teamId: selectedTeamId, teamName: selectedTeamName });
      const memoryRows = teamMemories.slice(0, 8).map((m)=>{
        const story = m?.summary?.story || (m.narrative || "").slice(0, 90);
        const tags = (m?.summary?.reasons || []).slice(0, 2).map((r)=>`${r.tag} ${(r.strength*100).toFixed(0)}%`).join(" · ");
        const lineup = parseLineupList(m?.lineup || m?.startingXI || []);
        const lineupTxt = lineup.length ? lineup.slice(0, 6).join(', ') + (lineup.length>6 ? '…' : '') : 'Sin composición';
        const [gfRaw, gaRaw] = String(m.score || '').split('-').map((v)=>Number(v));
        const scoreClass = Number.isFinite(gfRaw) && Number.isFinite(gaRaw)
          ? (gfRaw > gaRaw ? 'win' : gfRaw < gaRaw ? 'loss' : 'draw')
          : 'draw';
        return `<article class="b2-memory-row"><div class="b2-memory-main"><div class="b2-memory-meta"><span class="b2-memory-date">${m.date || "-"}</span><span class="b2-score-chip ${scoreClass}">${m.score || "-"}</span></div><div class="b2-memory-title">vs ${m.opponent || "-"}</div><div class="fl-mini">${story}</div><div class="fl-mini">${tags || "Sin razones"} · XI: ${lineupTxt}</div></div><div class="b2-memory-actions"><button class="fl-btn ghost b2WhyMatch" data-match-id="${m.id}" data-team-id="${selectedTeamId}">¿Por qué?</button><button class="fl-btn ghost b2EditMatch" data-match-id="${m.id}" data-team-id="${selectedTeamId}">Editar</button><button class="fl-btn ghost b2DeleteMatch" data-match-id="${m.id}" data-team-id="${selectedTeamId}">Borrar</button></div></article>`;
      }).join("");
      const selectedTeamSummary = summarizeTeamMemory(teamMemories);
      const selectedTeamHasBrain = selectedTeamSummary.samples > 0;
      const indexedCount = teamMatchRefs.length;
      const selectedTeamBadge = selectedTeamHasBrain
        ? `🧠 Cerebro activo para este equipo · ${selectedTeamSummary.samples} partidos (${selectedTeamSummary.positive} positivos / ${selectedTeamSummary.negative} alertas).`
        : "⚠️ Este equipo aún no tiene memoria en Brain v2. Guarda partidos para activar el cerebro.";

      const allTeams = db.teams.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      const homeId = payload.homeId || allTeams[0]?.id || "";
      const awayId = payload.awayId || allTeams[1]?.id || allTeams[0]?.id || "";
      const teamOptionFull = (chosen="") => allTeams.map((t)=>`<option value="${t.id}" ${chosen===t.id?"selected":""}>${t.name}</option>`).join("");

      content.innerHTML = `
        <div class="b2-layout">
          <div class="b2-topbar">
            <div class="b2-topbar-head">
              <div class="b2-brand">🧠 Brain v2</div>
              <div class="fl-mini">${selectedLeagueId ? (db.leagues.find((l)=>l.id===selectedLeagueId)?.name || 'Todas') : 'Todas las ligas'} · ${selectedTeamName}</div>
            </div>
            <div class="b2-kpi-strip">
              <div class="b2-stat-pill"><span class="fl-mini">Teams</span><b data-b2-counter data-b2-value="${health.teamsLearned}">0</b></div>
              <div class="b2-stat-pill"><span class="fl-mini">Matches</span><b data-b2-counter data-b2-value="${health.matchesLearned}">0</b></div>
              <div class="b2-stat-pill"><span class="fl-mini">Confianza</span><b data-b2-counter data-b2-value="${Math.round(health.confidence * 100)}" data-b2-suffix="%">0%</b></div>
              <div class="b2-stat-pill"><span class="fl-mini">Cobertura</span><b>${(health.statsCoverage * 100).toFixed(0)}% / ${(health.narrativeCoverage * 100).toFixed(0)}%</b></div>
              <div class="b2-health ${selectedTeamHasBrain ? 'active' : 'warn'}">${selectedTeamHasBrain ? 'CEREBRO ACTIVO' : 'SIN MEMORIA'}</div>
            </div>
          </div>

          <div class="b2-col-a">
            <div class="fl-card b2-card b2-sticky-panel">
              <div class="b2-card-header">CAPTURA DE PARTIDO</div>
              <div class="b2-card-body">
              <div class="fl-grid two">
                <div>
                  <label class="b2-label">Liga</label>
                  <select id="b2League" class="fl-select"><option value="">Todas</option>${leagueOptions}</select>
                </div>
                <div>
                  <label class="b2-label">Equipo</label>
                  <select id="b2Team" class="fl-select"><option value="">Selecciona equipo</option>${teamOptions}</select>
                </div>
              </div>
              <div class="fl-grid two" style="margin-top:10px;">
                <input id="b2Date" type="date" class="fl-input" value="${new Date().toISOString().slice(0,10)}" />
                <input id="b2Opponent" class="fl-input" placeholder="Rival" />
              </div>
              <input id="b2Score" class="fl-input" style="margin-top:8px;" placeholder="Marcador (ej: 2-1)" />
              <textarea id="b2Stats" class="fl-text" style="margin-top:8px;min-height:90px;" placeholder="xg: 1.8
shots: 13
possession: 57
passes: 425"></textarea>
              <textarea id="b2Narrative" class="fl-text" style="margin-top:8px;min-height:90px;" placeholder="Relato del partido: ritmo, lesiones, presión, cambios..."></textarea>
              <div class="fl-field" style="margin-top:8px;">
                <label>Composición (XI del día)</label>
                <div class="fl-row">
                  <input id="b2Lineup" class="fl-input" style="flex:1;min-width:240px;" placeholder="XI del día (coma separado)" />
                  <button class="fl-btn secondary" id="b2OpenLineupComposer" type="button">Abrir pizarra</button>
                </div>
                <input id="b2LineupShape" type="hidden" value="" />
              </div>
              <div class="fl-row" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
                <button class="fl-btn secondary" id="b2ImportMatchpack" type="button">Importar JSON</button>
                <input id="b2ImportMatchpackFile" type="file" accept="application/json,.json" style="display:none;" />
                <span id="b2ImportStatus" class="fl-mini"></span>
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <button class="fl-btn b2-btn-primary" id="b2SaveMatch">Guardar partido en memoria</button>
                <span id="b2Status" class="fl-muted"></span>
              </div>
              </div>
            </div>
          </div>

          <div class="b2-col-b">
            <div class="fl-card b2-card">
              <div class="b2-card-header">MEMORIA DEL EQUIPO <span class="fl-chip">${teamMemories.length} partidos</span></div>
              <div class="b2-card-body">
                <div class="fl-mini" style="margin-top:4px;">Partidos indexados (teamProfiles): <b>${indexedCount}</b></div>
                <div class="b2-memory-list">${memoryRows || '<div class="fl-mini">Sin partidos guardados.</div>'}</div>
              </div>
            </div>
            <div id="b2PowerDashboard" class="fl-card" style="margin-top:10px;display:none;"></div>
            <div id="b2GlobalLearningPanel" class="fl-card"></div>
          </div>

          <div class="b2-col-c">
            <div class="fl-card b2-card b2-col-c-sticky">
              <div class="b2-card-header">🎯 SIMULACIÓN</div>
              <div class="b2-card-body">
              <div class="fl-grid two" style="margin-top:8px;">
                <select id="b2Home" class="fl-select"><option value="">Equipo local</option>${teamOptionFull(homeId)}</select>
                <select id="b2Away" class="fl-select"><option value="">Equipo visita</option>${teamOptionFull(awayId)}</select>
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input id="b2OddH" class="fl-input" type="number" step="0.01" placeholder="Cuota Local" style="max-width:150px;" />
                <input id="b2OddD" class="fl-input" type="number" step="0.01" placeholder="Cuota Empate" style="max-width:150px;" />
                <input id="b2OddA" class="fl-input" type="number" step="0.01" placeholder="Cuota Visita" style="max-width:150px;" />
                <button class="fl-btn b2-btn-sim" id="b2Simulate">Simular visión</button>
              </div>
              <div class="fl-row" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
                <button class="fl-btn" id="b2PrematchGenerate">Generar previa editorial</button>
                <button class="fl-btn" id="b2PrematchRegenerate">Regenerar</button>
                <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="b2PrematchDebugToggle" /> Ver insights JSON</label>
              </div>
              <div id="b2BrainStatus" class="fl-mini" style="margin-top:8px;"></div>
            </div>
            </div>
            <div id="b2Vision" class="fl-mini b2-vision-card" style="margin-top:10px;">Carga local/visita para ver la simulación visual.</div>
            <div id="b2PrematchOut" class="fl-card" style="margin-top:8px;padding:10px;display:none;"></div>
          </div>

          <div class="b2-bottom">
            <details class="fl-card b2-advanced-tools">
              <summary>⚙ HERRAMIENTAS HÍBRIDAS <span class="fl-chip warn">AVANZADO</span></summary>
              <div class="fl-row" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
                <button class="fl-btn secondary" id="b2HybridSync">Sincronizar dataset híbrido</button>
                <button class="fl-btn secondary" id="b2HybridEvaluate">Evaluate</button>
                <button class="fl-btn secondary" id="b2HybridVisionPreview">Preview Vision</button>
              </div>
              <div id="b2HybridLogs" class="fl-mini" style="margin-top:8px;white-space:pre-wrap;line-height:1.5;">Hybrid tools listos.</div>
            </details>
          </div>
        </div>
            `;

      const openB2MatchModal = (row)=>{
        if(!row) return;
        const summary = ensureBrainV2RowSummary(row, selectedTeamName);
        const reasons = (summary?.reasons || []).slice(0, 8).map((r)=>`<span class="fl-chip">${r.label || r.tag || r.tagId} ${(Number(r.strength||0)*100).toFixed(0)}%</span>`).join(" ");
        const statsObj = parseBrainV2StatsToStatsRaw(row?.statsRaw || "");
        const statsRows = Array.isArray(statsObj?.stats) ? statsObj.stats : [];
        const backdrop = document.createElement("div");
        backdrop.className = "fl-modal-backdrop";
        backdrop.innerHTML = `
          <div class="fl-modal" style="max-width:900px;">
            <div class="fl-row" style="justify-content:space-between;align-items:center;">
              <div><div class="fl-modal-title">${row.date || "-"} · ${selectedTeamName} vs ${row.opponent || "Rival"}</div><div class="fl-mini">Marcador ${row.score || "0-0"}</div></div>
              <button class="fl-btn" data-close>Cerrar</button>
            </div>
            <div class="fl-card" style="margin-top:8px;"><b>Relato</b><div class="fl-mini" style="white-space:pre-wrap;max-height:180px;overflow:auto;margin-top:6px;">${String(row?.narrative || "Sin relato").replace(/</g, "&lt;")}</div></div>
            <div class="fl-card" style="margin-top:8px;"><b>Tags auto + manual</b><div class="fl-row" style="margin-top:6px;flex-wrap:wrap;">${reasons || "Sin tags detectados"}</div></div>
            <div class="fl-card" style="margin-top:8px;"><b>Stats pegadas</b><div class="fl-mini" style="max-height:150px;overflow:auto;margin-top:6px;">${statsRows.length ? statsRows.map((s)=>`${s.key}: ${s.home} - ${s.away}`).join("<br>") : "Sin stats"}</div></div>
          </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('[data-close]').onclick = ()=>backdrop.remove();
        backdrop.onclick = (e)=>{ if(e.target===backdrop) backdrop.remove(); };
      };

      const renderGlobalLearningPanel = ()=>{
        const node = document.getElementById('b2GlobalLearningPanel');
        if(!node) return;
        const gp = computeGlobalLearningProgress(brainV2.memories, brainV2.gpe);
        const IMPACT_TABLES_KEY = 'ui_impactTablesExpanded';

        const fmtPct = (x)=>`${x >= 0 ? '+' : ''}${(Number(x || 0) * 100).toFixed(1)}%`;
        const fmtRel = (rel)=>{
          const value = Number(rel || 0);
          const pct = value <= 1 ? value * 100 : value;
          return `${Math.round(pct)}%`;
        };
        const fmtImpact = (impact)=>Number(impact || 0).toFixed(3);
        const getDominantLift = (item = {})=>{
          const lifts = [
            { side: 'W', value: Number(item.liftW || 0) },
            { side: 'D', value: Number(item.liftD || 0) },
            { side: 'L', value: Number(item.liftL || 0) }
          ];
          return lifts.sort((a,b)=>b.value-a.value)[0] || { side: 'D', value: 0 };
        };
        const humanizeTag = (tagId)=>RELATO_TAG_LABELS?.[tagId] || tagId;
        const humanizeCombo = (comboKey)=>String(comboKey || '').split('|').map((tag)=>humanizeTag(tag)).join(' + ');
        const sortByImpactDesc = (rows = [])=>rows.slice().sort((a,b)=>Number(b.impactScore || b.impact || 0) - Number(a.impactScore || a.impact || 0));

        const renderImpactTagsTable = (rows = [])=>{
          const tableRows = rows.slice(0, 20).map((row)=>{
            const relPct = Math.round(row.rel * 100);
            const lifts = `W ${fmtPct(row.liftW)} · D ${fmtPct(row.liftD)} · L ${fmtPct(row.liftL)}`;
            return `<tr><td>${row.tagId}</td><td>${row.n}</td><td><div style="height:8px;background:#222;border-radius:999px;min-width:90px;"><div style="width:${relPct}%;height:8px;background:#58a6ff;border-radius:999px;"></div></div><div class="fl-mini">${relPct}%</div></td><td class="fl-mini">${lifts}</td><td>${fmtImpact(row.impactScore)}</td><td>${row.badge}</td></tr>`;
          }).join('');
          return `<div class="fl-card" style="padding:8px;"><b>Top Impact Tags</b><table class="fl-table" style="margin-top:6px;"><thead><tr><th>tag</th><th>n</th><th>rel</th><th>lift W/D/L</th><th>impact</th><th>badge</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6" class="fl-mini">Sin tags aún.</td></tr>'}</tbody></table></div>`;
        };

        const renderImpactCombosTable = (rows = [])=>{
          const tableRows = rows.slice(0, 18).map((row)=>{
            const lifts = `W ${fmtPct(row.liftW)} · D ${fmtPct(row.liftD)} · L ${fmtPct(row.liftL)}`;
            return `<tr><td>${row.comboKey}</td><td>${row.n}</td><td>${fmtRel(row.rel)}</td><td class="fl-mini">${lifts}</td><td>${fmtImpact(row.impactScore)}</td><td>${row.badge}</td></tr>`;
          }).join('');
          return `<div class="fl-card" style="padding:8px;"><b>Top Impact Combos</b><table class="fl-table" style="margin-top:6px;"><thead><tr><th>combo</th><th>n</th><th>rel</th><th>lift W/D/L</th><th>impact</th><th>badge</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6" class="fl-mini">Sin combos aún.</td></tr>'}</tbody></table></div>`;
        };

        const renderSummaryRows = ({ rows = [], type = 'tag', max = 5 })=>{
          const topRows = sortByImpactDesc(rows).slice(0, max);
          const maxImpact = topRows.reduce((acc, row)=>Math.max(acc, Number(row.impactScore || row.impact || 0)), 0) || 1;
          if(!topRows.length) return '<div class="fl-mini" style="padding:12px;border:1px dashed #30363d;border-radius:10px;">Sin evidencia suficiente aún</div>';
          return topRows.map((row)=>{
            const dominant = getDominantLift(row);
            const name = type === 'tag' ? humanizeTag(row.tagId) : humanizeCombo(row.comboKey);
            const impactValue = Number(row.impactScore || row.impact || 0);
            const barPct = Math.max(8, Math.min(100, (impactValue / maxImpact) * 100));
            return `
              <div class="fl-card" style="padding:10px 12px;margin-top:6px;background:#111821;border:1px solid #2d3748;box-shadow:0 1px 6px rgba(0,0,0,.25);">
                <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(120px,1fr) auto;gap:10px;align-items:center;">
                  <div style="min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
                      <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                      <span class="fl-chip" style="font-size:11px;padding:2px 7px;">${row.badge || '-'}</span>
                    </div>
                    <div class="fl-mini" style="margin-top:4px;font-size:12px;">n=${row.n} · rel=${fmtRel(row.rel)}</div>
                  </div>
                  <div>
                    <div class="fl-mini" style="font-size:12px;">Impact: ${fmtImpact(impactValue)}</div>
                    <div style="height:7px;background:#1b2430;border-radius:999px;margin-top:4px;overflow:hidden;"><div style="width:${barPct}%;height:100%;background:linear-gradient(90deg,#58a6ff,#3fb950);"></div></div>
                  </div>
                  <div style="text-align:right;min-width:120px;">
                    <div class="fl-mini" style="font-size:12px;font-weight:700;">Empuja ${dominant.side} (${fmtPct(dominant.value)})</div>
                  </div>
                </div>
              </div>`;
          }).join('');
        };

        const renderImpactSummary = (impactTags = [], impactCombos = [])=>{
          const expanded = localStorage.getItem(IMPACT_TABLES_KEY) === '1';
          return `
            <div class="fl-card" style="margin-top:8px;padding:10px;">
              <div style="font-size:16px;font-weight:800;">Qué está influyendo</div>
              <div class="fl-grid two" style="margin-top:8px;gap:8px;align-items:start;">
                <div class="fl-card" style="padding:8px;">
                  <b>Top señales (Tags)</b>
                  <div style="margin-top:6px;max-height:360px;overflow:auto;">${renderSummaryRows({ rows: impactTags, type: 'tag', max: 5 })}</div>
                </div>
                <div class="fl-card" style="padding:8px;">
                  <b>Top combinaciones (Combos)</b>
                  <div style="margin-top:6px;max-height:260px;overflow:auto;">${renderSummaryRows({ rows: impactCombos, type: 'combo', max: 3 })}</div>
                </div>
              </div>
              <button id="b2ImpactToggle" class="fl-btn secondary" type="button" style="margin-top:10px;padding:6px 10px;font-size:12px;">${expanded ? 'Ocultar análisis completo' : 'Ver análisis completo'}</button>
              <div id="b2ImpactTablesWrap" class="b2-collapse ${expanded ? 'is-open' : ''}" style="margin-top:8px;">
                <div class="fl-grid two" style="gap:8px;">${renderImpactTagsTable(impactTags)}${renderImpactCombosTable(impactCombos)}</div>
              </div>
            </div>`;
        };

        const warnings = gp.warnings.map((line)=>`<div class="fl-mini" style="padding:6px 0;border-bottom:1px solid #30363d;">${line}</div>`).join('');
        node.innerHTML = `
          <details>
            <summary>🌐 Aprendizaje Global — ${gp.totalTeams} equipos · ${gp.totalMatches} partidos</summary>
            <div style="font-size:18px;font-weight:900;margin-top:8px;">🌍 Global Impact Panel (GIE)</div>
            <div class="fl-kpi" style="margin-top:8px;">
            <div><span class="fl-mini">Strong signals</span><b>${gp.strongSignals}</b></div>
            <div><span class="fl-mini">Trap signals</span><b>${gp.trapSignals}</b></div>
            <div><span class="fl-mini">Chaos signals</span><b>${gp.chaosSignals}</b></div>
            <div><span class="fl-mini">Global readiness</span><b>${gp.readiness.toFixed(0)} / 100</b></div>
          </div>
          ${renderImpactSummary(gp.tagRows, gp.comboRows)}
          <div class="fl-card" style="margin-top:8px;padding:8px;"><b>Global Warnings you can trust</b><div style="margin-top:6px;">${warnings || '<div class="fl-mini">Aún no hay señales con rel ≥ 0.60.</div>'}</div></div>
            <div class="fl-mini" style="margin-top:8px;">Baseline global: W ${(gp.baseline.pW*100).toFixed(1)}% · D ${(gp.baseline.pD*100).toFixed(1)}% · L ${(gp.baseline.pL*100).toFixed(1)}% · Matches ${gp.totalMatches}</div>
          </details>`;

        const toggle = node.querySelector('#b2ImpactToggle');
        const wrap = node.querySelector('#b2ImpactTablesWrap');
        if(toggle && wrap){
          toggle.onclick = ()=>{
            const open = !wrap.classList.contains('is-open');
            wrap.classList.toggle('is-open', open);
            toggle.textContent = open ? 'Ocultar análisis completo' : 'Ver análisis completo';
            localStorage.setItem(IMPACT_TABLES_KEY, open ? '1' : '0');
          };
        }
      };


      const renderBrainV2PowerDashboard = ()=>{
        const node = document.getElementById('b2PowerDashboard');
        if(!node) return;
        const pack = buildTeamPackFromBrainV2Memories(teamMemories, selectedTeamName);
        const agg = buildTeamAggregate(pack);
        if(agg.sampleSize < 5){ node.style.display = 'none'; return; }
        node.style.display = 'block';
        const confidenceLabel = agg.confidence >= 0.8 ? 'alto' : agg.confidence >= 0.55 ? 'medio' : 'bajo';
        const dnaRows = agg.teamDNA.slice(0,5).map((tag)=>`<div class="fl-row" style="justify-content:space-between;"><span>${tag.label}</span><b>${tag.intensityPct.toFixed(0)}%</b></div>`).join('');
        const defeatRows = agg.defeatCauses.slice(0,5).map((tag)=>`<tr><td>${tag.tagId}</td><td>${tag.count}</td></tr>`).join('');
        const insightLines = [];
        if(agg.kpis.attackProduction >= 65 && agg.kpis.attackConversion <= 52){
          insightLines.push('El equipo genera volumen ofensivo alto, pero su conversión es baja.');
        }
        if(agg.kpis.defense <= 40){
          insightLines.push('La estabilidad defensiva es débil y concede escenarios de gol con frecuencia.');
        }
        const latePressure = agg.teamDNA.find((t)=>t.tagId === 'late_pressure');
        if((latePressure?.intensityPct || 0) >= 55){
          insightLines.push('Hay presión ofensiva tardía recurrente: los cierres de partido pesan en el resultado.');
        }
        if(!insightLines.length){
          insightLines.push('Perfil equilibrado sin un sesgo extremo detectado en los últimos partidos.');
        }
        const timelineRows = agg.matches.slice().reverse().map((m)=>{
          const tags = m.reasons.slice(0,3).map((r)=>`${r.label || r.tagId} ${(Number(r.strength||0)*100).toFixed(0)}%`).join(' · ');
          const dot = m.completeness.score >= 0.8 ? '🟢' : m.completeness.score >= 0.55 ? '🟡' : '🔴';
          return `<tr data-b2-match="${m.matchId}" style="cursor:pointer;"><td>${m.date || '-'}</td><td>${m.opponent}</td><td>${m.venue}</td><td>${m.gf}-${m.ga}</td><td>${m.outcome}</td><td class="fl-mini">${tags || 'Sin tags'}</td><td>${dot} ${(m.completeness.score*100).toFixed(0)}%</td></tr>`;
        }).join('');
        node.innerHTML = `
          <div style="font-size:18px;font-weight:900;">⚡ Brain v2 · Power Dashboard (${agg.panelLevel})</div>
          <div class="fl-mini" style="margin-top:4px;">N=${agg.sampleSize} · Confidence ${confidenceLabel} (${(agg.confidence*100).toFixed(0)}%)</div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span class="fl-mini">Attack Power</span><b>${agg.kpis.attack.toFixed(0)}</b></div>
            <div><span class="fl-mini">Defense Power</span><b>${agg.kpis.defense.toFixed(0)}</b></div>
            <div><span class="fl-mini">Control Power</span><b>${agg.kpis.control.toFixed(0)}</b></div>
            <div><span class="fl-mini">Efficiency Power</span><b>${agg.kpis.efficiency.toFixed(0)}</b></div>
          </div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span class="fl-mini">Attack Production</span><b>${agg.kpis.attackProduction.toFixed(0)}</b></div>
            <div><span class="fl-mini">Attack Conversion</span><b>${agg.kpis.attackConversion.toFixed(0)}</b></div>
            <div><span class="fl-mini">Setpiece Strength</span><b>${agg.kpis.setpieceStrength.toFixed(0)}</b></div>
            <div><span class="fl-mini">Discipline</span><b>${agg.kpis.discipline.toFixed(0)}</b></div>
          </div>
          <div class="fl-card" style="margin-top:8px;"><b>Team Insight</b><div class="fl-mini" style="margin-top:6px;">${insightLines.join('<br>')}</div></div>
          <div class="fl-card" style="margin-top:8px;"><b>Timeline</b><table class="fl-table" style="margin-top:6px;"><thead><tr><th>Fecha</th><th>Rival</th><th>H/A</th><th>Marcador</th><th>Outcome</th><th>Top tags</th><th>Data</th></tr></thead><tbody>${timelineRows}</tbody></table></div>
          <div class="fl-grid two" style="margin-top:8px;"><div class="fl-card"><div class="fl-mini">Radar Home/Away (6 ejes)</div><div style="height:240px;"><canvas id="b2PowerRadar"></canvas></div></div><div class="fl-card"><div class="fl-mini">Tendencia</div><div style="height:220px;"><canvas id="b2PowerTrend"></canvas></div></div></div>
          <div class="fl-grid two" style="margin-top:8px;"><div class="fl-card"><b>TEAM DNA (últimos partidos)</b><div class="fl-mini" style="margin-top:6px;display:grid;gap:6px;">${dnaRows || 'Sin tags suficientes.'}</div></div><div class="fl-card"><b>Causa de derrota (${agg.matches.filter((m)=>m.outcome==='L').length})</b><table class="fl-table" style="margin-top:6px;"><thead><tr><th>tag</th><th>conteo</th></tr></thead><tbody>${defeatRows || '<tr><td colspan="2" class="fl-mini">Sin derrotas o sin causas fuertes detectadas.</td></tr>'}</tbody></table></div></div>
        `;
        node.querySelectorAll('[data-b2-match]').forEach((tr)=>tr.onclick = ()=>{
          const row = teamMemories.find((m)=>String(m.id)===String(tr.getAttribute('data-b2-match')));
          openB2MatchModal(row);
        });
        if(typeof Chart === 'function'){
          const radar = node.querySelector('#b2PowerRadar');
          if(radar){
            if(radar._chart){ try{ radar._chart.destroy(); }catch(_e){} }
            radar._chart = new Chart(radar.getContext('2d'), {
              type:'radar',
              data:{ labels:['Attack Production','Attack Conversion','Defense Stability','Control','Setpiece Strength','Discipline'], datasets:[
                { label:'Home', data:[agg.radar.home.attackProduction, agg.radar.home.attackConversion, agg.radar.home.defenseStability, agg.radar.home.control, agg.radar.home.setpieceStrength, agg.radar.home.discipline], borderColor:'#1f6feb', backgroundColor:'rgba(31,111,235,.2)' },
                { label:'Away', data:[agg.radar.away.attackProduction, agg.radar.away.attackConversion, agg.radar.away.defenseStability, agg.radar.away.control, agg.radar.away.setpieceStrength, agg.radar.away.discipline], borderColor:'#f2cc60', backgroundColor:'rgba(242,204,96,.2)' }
              ] },
              options:{ responsive:true, maintainAspectRatio:false, animation:{ duration:800, easing:'easeOutQuart' }, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } }, scales:{ r:{ suggestedMin:0, suggestedMax:100, ticks:{ color:'#9ca3af', backdropColor:'transparent' }, pointLabels:{ color:'#9ca3af' } } } }
            });
          }
          renderSimpleLineChart(node.querySelector('#b2PowerTrend'), agg.matches.map((m)=>String(m.date || '').slice(5) || '-'), [
            { label:'Puntos', data:agg.matches.map((m)=>m.points*33.33), borderColor:'#3fb950', backgroundColor:'rgba(63,185,80,.2)', tension:0.2 },
            { label:'Dif goles', data:agg.matches.map((m)=>clamp(50 + m.goalDiff*15,0,100)), borderColor:'#ff7b72', backgroundColor:'rgba(255,123,114,.2)', tension:0.2 },
            { label:'Efficiency', data:agg.matches.map((m)=>clamp(m.efficiency*100,0,100)), borderColor:'#a371f7', backgroundColor:'rgba(163,113,247,.2)', tension:0.2 }
          ]);
        }
      };
      renderGlobalLearningPanel();
      renderBrainV2PowerDashboard();

      const animateTopbarCounters = ()=>{
        const nodes = Array.from(document.querySelectorAll('[data-b2-counter]'));
        nodes.forEach((node, idx)=>{
          const target = Number(node.getAttribute('data-b2-value') || 0);
          const suffix = node.getAttribute('data-b2-suffix') || '';
          const start = performance.now() + idx * 60;
          const duration = 600;
          const tick = (now)=>{
            const t = Math.max(0, Math.min(1, (now - start) / duration));
            const eased = 1 - Math.pow(1 - t, 3);
            node.textContent = `${Math.round(target * eased)}${suffix}`;
            if(t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      };
      animateTopbarCounters();

      const bindVisualButtonFeedback = ()=>{
        const setup = (id, { statusNodeId = '', successMatch = /✅|guardad|generad|simulación/i, wait = 1200 } = {})=>{
          const btn = document.getElementById(id);
          if(!btn || btn.dataset.b2FxBound==='1') return;
          btn.dataset.b2FxBound = '1';
          btn.addEventListener('click', ()=>{
            btn.classList.remove('b2-btn-success');
            btn.classList.add('b2-btn-loading');
            setTimeout(()=>btn.classList.remove('b2-btn-loading'), wait);
          }, { capture: true });
          if(statusNodeId){
            const statusNode = document.getElementById(statusNodeId);
            if(!statusNode) return;
            const obs = new MutationObserver(()=>{
              const txt = String(statusNode.textContent || '').trim();
              if(!txt) return;
              btn.classList.remove('b2-btn-loading');
              if(successMatch.test(txt)){
                btn.classList.add('b2-btn-success');
                setTimeout(()=>btn.classList.remove('b2-btn-success'), 900);
              }
            });
            obs.observe(statusNode, { childList: true, subtree: true, characterData: true });
          }
        };

        setup('b2SaveMatch', { statusNodeId:'b2Status', successMatch:/✅|guardado/i, wait:1400 });
        setup('b2Simulate', { statusNodeId:'b2BrainStatus', successMatch:/✅|🧠|simulación/i, wait:1000 });
        setup('b2PrematchGenerate', { statusNodeId:'b2PrematchOut', successMatch:/📰|<div/i, wait:1100 });
        setup('b2PrematchRegenerate', { statusNodeId:'b2PrematchOut', successMatch:/📰|<div/i, wait:1100 });
      };
      bindVisualButtonFeedback();

      const applyHeroReveal = (node)=>{
        if(!node) return;
        node.classList.remove('b2-hero-show');
        node.classList.add('b2-hero-enter');
        requestAnimationFrame(()=>{
          node.classList.add('b2-hero-show');
        });
      };

      const paintBrainStatus = ()=>{
        const homeIdSel = document.getElementById('b2Home')?.value || "";
        const awayIdSel = document.getElementById('b2Away')?.value || "";
        const node = document.getElementById('b2BrainStatus');
        if(!node) return;
        if(!homeIdSel || !awayIdSel){
          node.textContent = 'Selecciona local y visita para validar si el cerebro tiene memoria para ambos.';
          node.classList.add('b2-status-show');
          return;
        }
        const homeName = db.teams.find((t)=>t.id===homeIdSel)?.name || 'Local';
        const awayName = db.teams.find((t)=>t.id===awayIdSel)?.name || 'Visita';
        const homeSamples = (brainV2.memories[homeIdSel] || []).length;
        const awaySamples = (brainV2.memories[awayIdSel] || []).length;
        const homeState = homeSamples ? `✅ ${homeName}: ${homeSamples} partidos en memoria` : `⚠️ ${homeName}: sin memoria`;
        const awayState = awaySamples ? `✅ ${awayName}: ${awaySamples} partidos en memoria` : `⚠️ ${awayName}: sin memoria`;
        const ready = homeSamples > 0 && awaySamples > 0;
        node.textContent = `${homeState} · ${awayState}${ready ? ' · 🧠 Simulación usando cerebro entrenado.' : ' · 🔄 Entrena ambos equipos para una señal más confiable.'}`;
        node.classList.add('b2-status-show');
      };
      paintBrainStatus();

      const openBrainV2LineupComposer = ({ teamId = "", lineupInput, shapeInput } = {})=>{
        const status = document.getElementById('b2Status');
        if(!teamId){ if(status) status.textContent = 'Selecciona un equipo antes de armar la composición.'; return; }
        const roster = listTeamProfilePlayers(db, teamId);
        if(!roster.length){ if(status) status.textContent = '⚠️ Este equipo no tiene perfiles de jugadores cargados.'; return; }

        const parsedShape = parseLineupShape(shapeInput?.value || "") || {};
        let layout = buildFormationLayout(parsedShape.formation || '4-3-3');
        let assignments = { ...(parsedShape.assignments || {}) };
        const presetLineup = parseLineupList(lineupInput?.value || '');
        layout.slots.forEach((slot, idx)=>{
          if(!assignments[slot.key] && presetLineup[idx]) assignments[slot.key] = presetLineup[idx];
        });

        const modal = document.createElement('div');
        modal.className = 'fl-modal-backdrop';
        modal.innerHTML = `
          <div class="fl-modal" style="max-width:980px;">
            <div class="fl-row" style="justify-content:space-between;align-items:center;">
              <div><div class="fl-modal-title">🧭 Composición del partido</div><div class="fl-mini">Selecciona nombres del perfil de equipo y guárdalos por posición.</div></div>
              <button class="fl-btn" data-close>Cerrar</button>
            </div>
            <div class="fl-row" style="margin-top:10px;justify-content:space-between;align-items:center;">
              <label class="fl-mini">Formación <input id="b2ComposerFormation" class="fl-input" style="width:120px;margin-left:6px;" value="${layout.formation}"></label>
              <button class="fl-btn secondary" id="b2ComposerApplyFormation" type="button">Aplicar formación</button>
            </div>
            <div id="b2ComposerBoard" class="fl-lineup-board" style="margin-top:10px;"></div>
            <div class="fl-row" style="margin-top:12px;justify-content:space-between;">
              <span class="fl-mini" id="b2ComposerStatus"></span>
              <button class="fl-btn" id="b2ComposerSave" type="button">Guardar composición</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        const close = ()=>modal.remove();
        modal.onclick = (e)=>{ if(e.target===modal) close(); };
        modal.querySelector('[data-close]').onclick = close;

        const renderBoard = ()=>{
          const board = modal.querySelector('#b2ComposerBoard');
          if(!board) return;
          board.innerHTML = layout.slots.map((slot)=>{
            const selected = String(assignments[slot.key] || '');
            const options = ['<option value="">-- sin asignar --</option>']
              .concat(roster.map((p)=>`<option value="${p.name}" ${selected===p.name?'selected':''}>${p.name}</option>`))
              .join('');
            return `<div class="fl-lineup-slot" style="left:${slot.x}%;top:${slot.y}%;"><div class="fl-lineup-slot-tag">${slot.label}</div><select class="fl-lineup-slot-select" data-slot="${slot.key}">${options}</select></div>`;
          }).join('');
          board.querySelectorAll('select[data-slot]').forEach((select)=>select.addEventListener('change', ()=>{
            assignments[select.dataset.slot] = select.value || '';
          }));
        };

        modal.querySelector('#b2ComposerApplyFormation').onclick = ()=>{
          const nextFormation = modal.querySelector('#b2ComposerFormation').value || layout.formation;
          const currentNames = layout.slots.map((slot)=>assignments[slot.key]).filter(Boolean);
          layout = buildFormationLayout(nextFormation);
          assignments = {};
          layout.slots.forEach((slot, idx)=>{ if(currentNames[idx]) assignments[slot.key] = currentNames[idx]; });
          modal.querySelector('#b2ComposerStatus').textContent = `Formación ${layout.formation} aplicada.`;
          renderBoard();
        };

        modal.querySelector('#b2ComposerSave').onclick = ()=>{
          const shape = {
            formation: layout.formation,
            slots: layout.slots.map((slot)=>({ key: slot.key, label: slot.label, line: slot.line, x: slot.x, y: slot.y })),
            assignments
          };
          const lineup = buildLineupFromShape(shape);
          if(lineupInput) lineupInput.value = lineup.join(', ');
          if(shapeInput) shapeInput.value = JSON.stringify(shape);
          if(status) status.textContent = `✅ Composición guardada (${lineup.length} jugadores asignados).`;
          close();
        };

        renderBoard();
      };

      document.getElementById('b2League')?.addEventListener('change', (e)=>{
        db.settings.selectedLeagueId = e.target.value || "";
        saveDb(db);
        render('brainv2', { leagueId: e.target.value || "" });
      });
      document.getElementById('b2Team')?.addEventListener('change', (e)=>render('brainv2', { leagueId: selectedLeagueId, teamId: e.target.value || "" }));
      document.getElementById('b2OpenLineupComposer')?.addEventListener('click', ()=>{
        const teamId = document.getElementById('b2Team')?.value || "";
        openBrainV2LineupComposer({
          teamId,
          lineupInput: document.getElementById('b2Lineup'),
          shapeInput: document.getElementById('b2LineupShape')
        });
      });
      document.getElementById('b2ImportMatchpack')?.addEventListener('click', ()=>{
        document.getElementById('b2ImportMatchpackFile')?.click();
      });
      document.getElementById('b2ImportMatchpackFile')?.addEventListener('change', async (ev)=>{
        const status = document.getElementById('b2ImportStatus');
        const file = ev?.target?.files?.[0];
        if(!file) return;
        try{
          const raw = await file.text();
          const matchpack = parseFootballLabMatchpack(raw);
          const currentTeamId = document.getElementById('b2Team')?.value || "";
          const currentTeamName = db.teams.find((t)=>t.id===currentTeamId)?.name || "";
          const focus = inferFocusTeamFromMatchpack(matchpack, currentTeamName);
          const warnings = [];

          const allTeamsByNorm = new Map(db.teams.map((t)=>[normalizeTeamName(t.name), t.id]));
          const homeName = String(matchpack?.match?.home || "").trim();
          const awayName = String(matchpack?.match?.away || "").trim();
          const focusName = focus.side === "away" ? awayName : homeName;
          const rivalName = focus.side === "away" ? homeName : awayName;

          const teamSelect = document.getElementById('b2Team');
          const teamAlreadyChosen = !!currentTeamId;
          if(!teamAlreadyChosen){
            const inferredTeamId = allTeamsByNorm.get(normalizeTeamName(focusName));
            if(inferredTeamId){
              teamSelect.value = inferredTeamId;
            }else{
              warnings.push(`No se encontró equipo local para "${focusName}"; se mantiene selección actual.`);
            }
          }

          const dateValue = matchpackDateToInput(matchpack?.match?.date || matchpack?.match?.kickoff || "");
          if(dateValue) document.getElementById('b2Date').value = dateValue;
          else warnings.push('Fecha no reconocida; se conserva valor actual.');

          if(rivalName) document.getElementById('b2Opponent').value = rivalName;

          const score = buildScoreForForm(matchpack, focus.side);
          if(score) document.getElementById('b2Score').value = score;

          const statsTxt = buildStatsTextareaFromMatchpack(matchpack, focus.side);
          if(statsTxt) document.getElementById('b2Stats').value = statsTxt;
          else warnings.push('Sin stats.normalized utilizables; campo stats no se tocó.');

          const narrativeTxt = buildNarrativeTextareaFromMatchpack(matchpack);
          if(narrativeTxt) document.getElementById('b2Narrative').value = narrativeTxt;
          else warnings.push('Sin commentary.items relevantes; relato no se tocó.');

          const xi = buildXiStringFromMatchpack(matchpack);
          if(xi) document.getElementById('b2Lineup').value = xi;
          else warnings.push('Sin lineup.players; XI no se tocó.');

          const lineupShape = buildLineupShapeFromMatchpack(matchpack);
          if(lineupShape) document.getElementById('b2LineupShape').value = JSON.stringify(lineupShape);

          const competition = String(matchpack?.match?.competition || "").trim();
          if(competition){
            const hitLeague = db.leagues.find((l)=>normalizeTeamName(l?.name || "")===normalizeTeamName(competition));
            if(hitLeague){
              const leagueSelect = document.getElementById('b2League');
              leagueSelect.value = hitLeague.id;
            }else{
              warnings.push(`Liga "${competition}" no coincide con una liga existente.`);
            }
          }

          const autoText = warnings.length
            ? `✅ JSON importado con avisos: ${warnings.join(' ')}`
            : '✅ JSON importado correctamente. Revisa y edita antes de guardar.';
          if(status) status.textContent = autoText;
        }catch(err){
          if(status) status.textContent = `❌ Error al importar: ${String(err?.message || err)}`;
        }finally{
          ev.target.value = '';
        }
      });
      document.getElementById('b2Home')?.addEventListener('change', paintBrainStatus);
      document.getElementById('b2Away')?.addEventListener('change', paintBrainStatus);

      let lastBrainPrematchPayload = null;
      const renderCSIBlock = (csi = null)=>{
        if(!csi || !csi.home || !csi.away) return '';
        const labels = { pressure: 'Pressure', control: 'Control', stability: 'Stability', momentum: 'Momentum', cohesion: 'Cohesion' };
        const leaderText = csi.leader === 'even'
          ? 'Llegan igual de fuertes ahora'
          : `${csi.leader === 'home' ? csi.home.team : csi.away.team} llega más fuerte ahora`;
        const buildBars = (label, homeValue, awayValue)=>`
          <div class="fl-mini" style="display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center;">
            <span>${label}</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <div style="background:rgba(31,111,235,.25);height:8px;border-radius:999px;position:relative;"><span style="position:absolute;left:0;top:0;bottom:0;width:${Math.max(3, homeValue)}%;background:#1f6feb;border-radius:999px;"></span></div>
              <div style="background:rgba(248,81,73,.25);height:8px;border-radius:999px;position:relative;"><span style="position:absolute;left:0;top:0;bottom:0;width:${Math.max(3, awayValue)}%;background:#f85149;border-radius:999px;"></span></div>
            </div>
          </div>
        `;
        const lines = Object.keys(labels).map((key)=>buildBars(labels[key], Number(csi.home.subscores?.[key]) || 0, Number(csi.away.subscores?.[key]) || 0)).join('');
        const limitations = [
          ...(Array.isArray(csi.home?.explanation?.limitations) ? csi.home.explanation.limitations : []),
          ...(Array.isArray(csi.away?.explanation?.limitations) ? csi.away.explanation.limitations : [])
        ].filter((v, idx, arr)=>v && arr.indexOf(v)===idx);
        return `
          <div style="margin-top:10px;padding:10px;border:1px solid rgba(99,110,123,.35);border-radius:10px;">
            <div style="font-weight:800;">🔹 Current Strength (N=${csi.N || 5})</div>
            <div class="fl-mini" style="margin-top:6px;display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:6px;">
              <div>${csi.home.team}: <b>${csi.home.CSI}</b></div>
              <div>${csi.away.team}: <b>${csi.away.CSI}</b></div>
            </div>
            <div class="fl-mini" style="margin-top:6px;">👉 ${leaderText}</div>
            <div class="fl-mini" style="margin-top:8px;font-weight:700;">🔹 Breakdown visual</div>
            <div style="margin-top:6px;display:grid;gap:6px;">${lines}</div>
            <div class="fl-mini" style="margin-top:8px;">👉 ${csi.leader === 'home' ? csi.home.explanation?.summary : csi.leader === 'away' ? csi.away.explanation?.summary : 'No hay edge claro en fuerza reciente.'}</div>
            ${limitations.length ? `<div class="fl-mini" style="margin-top:6px;color:#8b949e;">Limitaciones: ${limitations.join(' · ')}</div>` : ''}
          </div>
        `;
      };



      const renderRQIBlock = (rqi = null)=>{
        if(!rqi || !rqi.home || !rqi.away) return '';
        const labels = {
          resultStrength: 'Result strength',
          dominance: 'Dominance',
          fragility: 'Fragility resistance',
          efficiencyAlert: 'Efficiency sustainability',
          controlConviction: 'Control / conviction'
        };
        const leaderText = rqi.leader === 'even'
          ? 'Racha de calidad muy similar entre ambos'
          : `${rqi.leader === 'home' ? rqi.home.team : rqi.away.team} trae una racha más convincente`;
        const buildBars = (label, homeValue, awayValue)=>`
          <div class="fl-mini" style="display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center;">
            <span>${label}</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <div style="background:rgba(31,111,235,.25);height:8px;border-radius:999px;position:relative;"><span style="position:absolute;left:0;top:0;bottom:0;width:${Math.max(3, homeValue)}%;background:#1f6feb;border-radius:999px;"></span></div>
              <div style="background:rgba(248,81,73,.25);height:8px;border-radius:999px;position:relative;"><span style="position:absolute;left:0;top:0;bottom:0;width:${Math.max(3, awayValue)}%;background:#f85149;border-radius:999px;"></span></div>
            </div>
          </div>
        `;
        const lines = Object.keys(labels)
          .map((key)=>buildBars(labels[key], Number(rqi.home.subscores?.[key]) || 0, Number(rqi.away.subscores?.[key]) || 0))
          .join('');
        const homeFlags = Array.isArray(rqi.home?.interpretation?.flags) ? rqi.home.interpretation.flags : [];
        const awayFlags = Array.isArray(rqi.away?.interpretation?.flags) ? rqi.away.interpretation.flags : [];
        const limitations = [
          ...(Array.isArray(rqi.home?.interpretation?.limitations) ? rqi.home.interpretation.limitations : []),
          ...(Array.isArray(rqi.away?.interpretation?.limitations) ? rqi.away.interpretation.limitations : [])
        ].filter((v, idx, arr)=>v && arr.indexOf(v)===idx);
        const renderFlags = (teamLabel, flags)=>{
          if(!flags.length) return '';
          return `<div class="fl-mini" style="margin-top:4px;"><b>${teamLabel} flags:</b> ${flags.map((f)=>`• ${f}`).join(' · ')}</div>`;
        };
        return `
          <div style="margin-top:10px;padding:10px;border:1px solid rgba(99,110,123,.35);border-radius:10px;">
            <div style="font-weight:800;">📊 Result Quality Index (N=${rqi.N || 5})</div>
            <div class="fl-mini" style="margin-top:6px;display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:6px;">
              <div>${rqi.home.team}: <b>${rqi.home.RQI}</b> → ${rqi.home.statusLabel || rqi.home.status}</div>
              <div>${rqi.away.team}: <b>${rqi.away.RQI}</b> → ${rqi.away.statusLabel || rqi.away.status}</div>
            </div>
            <div class="fl-mini" style="margin-top:6px;">👉 ${leaderText}</div>
            <div class="fl-mini" style="margin-top:8px;font-weight:700;">🔹 Subscores</div>
            <div style="margin-top:6px;display:grid;gap:6px;">${lines}</div>
            <div class="fl-mini" style="margin-top:8px;">${rqi.home.team}: ${rqi.home.interpretation?.summary || ''}</div>
            <div class="fl-mini">${rqi.away.team}: ${rqi.away.interpretation?.summary || ''}</div>
            ${renderFlags(rqi.home.team, homeFlags)}
            ${renderFlags(rqi.away.team, awayFlags)}
            ${limitations.length ? `<div class="fl-mini" style="margin-top:6px;color:#8b949e;">Limitaciones RQI: ${limitations.join(' · ')}</div>` : ''}
          </div>
        `;
      };

      const renderFSIBlock = (fsi = null)=>{
        if(!fsi || (!fsi.home && !fsi.away)) return '';
        const renderTeam = (row)=>{
          if(!row) return '';
          if(!Number.isFinite(row?.FSI)){
            return `<div style="padding:8px;border:1px dashed #30363d;border-radius:8px;"><b>${row.team}</b>: ${row?.explanation || 'Sin datos suficientes.'}</div>`;
          }
          return `
            <div style="padding:8px;border:1px solid rgba(99,110,123,.35);border-radius:8px;">
              <div style="font-weight:700;">${row.team}</div>
              <div class="fl-mini">Base temporada: ${row.seasonBase.ppg} ppg · GF ${row.seasonBase.gfpg} · GC ${row.seasonBase.gcpg} · DG ${row.seasonBase.dgpg}</div>
              <div class="fl-mini">Forma reciente: ${row.recentForm.ppg} ppg · GF ${row.recentForm.gfpg} · GC ${row.recentForm.gcpg} · DG ${row.recentForm.dgpg}</div>
              <div class="fl-mini">FSI <b>${row.FSI}</b> · <b>${row.status}</b></div>
              <div class="fl-mini">${row.explanation || ''}</div>
            </div>
          `;
        };
        return `
          <div style="margin-top:10px;padding:10px;border:1px solid rgba(99,110,123,.35);border-radius:10px;">
            <div style="font-weight:800;">🧭 Form Surprise Index (FSI)</div>
            <div class="fl-mini" style="margin-top:6px;display:grid;gap:8px;">
              ${renderTeam(fsi.home)}
              ${renderTeam(fsi.away)}
            </div>
            <div class="fl-mini" style="margin-top:8px;">👉 ${fsi.conclusion || 'Sin conclusión.'}</div>
          </div>
        `;
      };

      const renderBrainPrematchPreview = (payload = null)=>{
        const out = document.getElementById('b2PrematchOut');
        const toggle = document.getElementById('b2PrematchDebugToggle');
        if(!out) return;
        if(!payload){
          out.style.display = 'none';
          out.classList.remove('b2-reveal-enter','b2-reveal-show');
          out.innerHTML = '';
          return;
        }
        const editorial = payload.editorial || {};
        const sections = Array.isArray(editorial.sections) ? editorial.sections : [];
        const debugOn = Boolean(toggle?.checked);
        out.style.display = 'block';
        out.classList.remove('b2-reveal-show');
        out.classList.add('b2-reveal-enter');
        out.innerHTML = `
          <div style="font-weight:900;font-size:16px;">📰 ${editorial.headline || 'Previa editorial'}</div>
          <div class="fl-mini" style="margin-top:8px;display:grid;gap:8px;">
            ${sections.map((section)=>`<div><b>${section.title}</b><div>${section.text}</div></div>`).join('')}
          </div>
          ${renderCSIBlock(payload.insights?.csi || null)}
          ${renderRQIBlock(payload.insights?.rqi || null)}
          ${renderFSIBlock(payload.insights?.fsi || null)}
          ${debugOn ? `<details style="margin-top:8px;"><summary style="cursor:pointer;">Insights JSON</summary><pre class="fl-mini" style="white-space:pre-wrap;overflow:auto;max-height:280px;">${JSON.stringify(payload.insights || {}, null, 2)}</pre></details>` : ''}
        `;
        requestAnimationFrame(()=>out.classList.add('b2-reveal-show'));
      };

      const handleBrainPrematchGenerate = ()=>{
        const homeIdSel = document.getElementById('b2Home')?.value || '';
        const awayIdSel = document.getElementById('b2Away')?.value || '';
        const out = document.getElementById('b2PrematchOut');
        if(!homeIdSel || !awayIdSel || homeIdSel===awayIdSel){
          if(out){
            out.style.display = 'block';
            out.textContent = 'Selecciona local y visita para generar la previa editorial.';
          }
          return;
        }
        const oddH = document.getElementById('b2OddH')?.value;
        const oddD = document.getElementById('b2OddD')?.value;
        const oddA = document.getElementById('b2OddA')?.value;
        const market = clean1x2Probs(oddH, oddD, oddA);
        const homeTeam = db.teams.find((t)=>t.id===homeIdSel);
        const awayTeam = db.teams.find((t)=>t.id===awayIdSel);
        const leagueIdSel = selectedLeagueId || homeTeam?.leagueId || awayTeam?.leagueId || '';
        const homeReadiness = computeMatchReadinessEngine(db, homeIdSel, { brainV2, teamName: homeTeam?.name || '', leagueId: leagueIdSel });
        const awayReadiness = computeMatchReadinessEngine(db, awayIdSel, { brainV2, teamName: awayTeam?.name || '', leagueId: leagueIdSel });
        const data = collectPrematchData({
          db,
          brainV2,
          homeId: homeIdSel,
          awayId: awayIdSel,
          leagueId: leagueIdSel,
          market: market ? { ...market, oddH, oddD, oddA } : null,
          readiness: { home: homeReadiness, away: awayReadiness }
        });
        const insights = buildPrematchInsights(data);
        const editorial = composePrematchEditorial(insights);
        lastBrainPrematchPayload = { insights, editorial };
        renderBrainPrematchPreview(lastBrainPrematchPayload);
      };

      document.getElementById('b2PrematchGenerate')?.addEventListener('click', handleBrainPrematchGenerate);
      document.getElementById('b2PrematchRegenerate')?.addEventListener('click', handleBrainPrematchGenerate);
      document.getElementById('b2PrematchDebugToggle')?.addEventListener('change', ()=>renderBrainPrematchPreview(lastBrainPrematchPayload));

      document.getElementById('b2SaveMatch')?.addEventListener('click', ()=>{
        const status = document.getElementById('b2Status');
        const teamId = document.getElementById('b2Team')?.value || "";
        if(!teamId){ status.textContent = 'Selecciona un equipo.'; return; }
        const row = {
          id: uid('b2m'),
          teamId,
          teamName: db.teams.find((t)=>t.id===teamId)?.name || "Local",
          leagueId: document.getElementById('b2League')?.value || "",
          date: document.getElementById('b2Date')?.value || new Date().toISOString().slice(0,10),
          opponent: (document.getElementById('b2Opponent')?.value || '').trim(),
          score: (document.getElementById('b2Score')?.value || '0-0').trim(),
          statsRaw: (document.getElementById('b2Stats')?.value || '').trim(),
          narrative: (document.getElementById('b2Narrative')?.value || '').trim(),
          lineup: parseLineupList(document.getElementById('b2Lineup')?.value || ''),
          lineupShape: parseLineupShape(document.getElementById('b2LineupShape')?.value || ''),
          createdAt: Date.now()
        };
        row.summary = buildBrainV2MatchSummary({ row, teamName: row.teamName, opponentName: row.opponent || "Rival" });
        brainV2.memories[teamId] ||= [];
        brainV2.memories[teamId].push(row);
        indexMemoryMatchIntoTeamProfiles(brainV2, row, {
          includeOpponent: true,
          primaryTeamId: teamId,
          primaryTeamName: row.teamName,
          opponentTeamName: row.opponent || ''
        });
        saveBrainV2(brainV2);
        status.textContent = `✅ Partido guardado. Memoria total: ${brainV2.memories[teamId].length}.`;
        render('brainv2', { leagueId: selectedLeagueId, teamId });
      });

      const hybridLogs = document.getElementById('b2HybridLogs');
      const logHybrid = (message="")=>{ if(hybridLogs) hybridLogs.textContent = message; };
      const syncHybridDataset = ()=>{
        const pack = buildHybridPackFromBrainV2(db, brainV2.memories);
        const meta = hybridBrain.buildDataset(pack);
        return meta;
      };

      document.getElementById('b2HybridSync')?.addEventListener('click', ()=>{
        try{
          const meta = syncHybridDataset();
          logHybrid(`✅ Dataset sincronizado: ${meta.sampleCount} samples · ${meta.matchCount} matches.`);
        }catch(err){
          logHybrid(`❌ Sync error: ${err.message}`);
        }
      });

      document.getElementById('b2HybridEvaluate')?.addEventListener('click', async ()=>{
        try{
          await ensureTensorFlowReady();
          if(!hybridBrain.model){
            await hybridBrain.load();
          }
          if(!hybridBrain.examples?.length){
            syncHybridDataset();
          }
          if(!hybridBrain.examples?.length) throw new Error('No hay memoria suficiente para evaluar.');
          const split = hybridBrain.splitExamplesByMatch(hybridBrain.examples, { trainFrac: 0.8, seed: 1337 });
          const metrics = await hybridBrain.evaluateSplit(split.val);
          const cm = metrics.confusionMatrix.map((row)=>`[${row.join(',')}]`).join(' ');
          logHybrid(`🧪 Evaluate listo\nBrier: ${metrics.brier.toFixed(3)} · ECE: ${metrics.ece.toFixed(3)} · Goals MAE: ${metrics.goalsMae.toFixed(3)}\nCM: ${cm}`);
        }catch(err){
          logHybrid(`❌ Evaluate error (Brain v2): ${err.message}`);
        }
      });

      document.getElementById('b2HybridVisionPreview')?.addEventListener('click', ()=>{
        try{
          const homeSel = document.getElementById('b2Home')?.value || "";
          const awaySel = document.getElementById('b2Away')?.value || "";
          if(!homeSel || !awaySel) throw new Error('Selecciona local y visita.');
          const homeSummary = summarizeTeamMemory(brainV2.memories[homeSel] || []);
          const awaySummary = summarizeTeamMemory(brainV2.memories[awaySel] || []);
          const tabular = {
            ...toHybridFeatureSeed(homeSummary, 'home'),
            ...toHybridFeatureSeed(awaySummary, 'away'),
            elo_diff: (1500 + ((homeSummary.positive || 0) - (homeSummary.negative || 0)) * 8) - (1500 + ((awaySummary.positive || 0) - (awaySummary.negative || 0)) * 8),
            form_points_diff: Math.max(0, Math.min(15, (homeSummary.positive || 0) * 2 + 3)) - Math.max(0, Math.min(15, (awaySummary.positive || 0) * 2 + 3)),
            minute: 65,
            is_live_slice: 1,
            momentum_index_home: (homeSummary.positive || 0) - (homeSummary.negative || 0),
            momentum_index_away: (awaySummary.positive || 0) - (awaySummary.negative || 0)
          };
          const text = `${document.getElementById('b2Narrative')?.value || ''}`;
          const vision = hybridBrain.previewVision({ tabular, text, liveMinute: 65 });
          const rows = vision.channels.map((row)=>`C${row.channel}: min=${row.min.toFixed(3)} max=${row.max.toFixed(3)} mean=${row.mean.toFixed(3)}`).join('\n');
          logHybrid(`👁️ Vision tensor ${vision.shape.join('x')}\n${rows}`);
        }catch(err){
          logHybrid(`❌ Preview Vision error (Brain v2): ${err.message}`);
        }
      });
      function openB2MatchReasonModal({ teamId = "", matchId = "" } = {}){
        const status = document.getElementById('b2Status');
        if(!teamId || !matchId || !brainV2.memories[teamId]) return;
        const row = brainV2.memories[teamId].find((item)=>item.id===matchId);
        if(!row) return;
        const teamName = db.teams.find((t)=>t.id===teamId)?.name || row?.teamName || "Local";
        const buildAndRefreshSummary = ()=>{
          const manualReasons = (row.summary?.reasons || []).filter((r)=>r && r.auto===false);
          row.summary = buildBrainV2MatchSummary({ row, teamName: row?.teamName || teamName, opponentName: row?.opponent || 'Rival' });
          if(manualReasons.length){
            row.summary.reasons = [...(row.summary.reasons || []), ...manualReasons]
              .sort((a,b)=>(Number(b?.strength)||0)-(Number(a?.strength)||0))
              .slice(0, 6);
          }
          return ensureBrainV2RowSummary(row, teamName);
        };
        const summary = buildAndRefreshSummary();

        const backdrop = document.createElement('div');
        backdrop.className = 'fl-modal-backdrop';
        backdrop.innerHTML = `
          <div class="fl-modal" style="max-width:980px;">
            <div class="fl-row" style="justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div><div class="fl-modal-title">🧩 Editar partido y razones</div><div class="fl-mini">${teamName} vs ${row.opponent || 'Rival'} · ajusta resultado, relato y tags.</div></div>
              <button class="fl-btn" id="b2CloseReasonModal">Cerrar</button>
            </div>
            <div class="fl-modal-grid">
              <div class="fl-field"><label>Fecha</label><input id="b2ModalDate" class="fl-input" type="date" value="${row.date || ''}"></div>
              <div class="fl-field"><label>Rival</label><input id="b2ModalOpponent" class="fl-input" value="${row.opponent || ''}"></div>
              <div class="fl-field"><label>Resultado</label><input id="b2ModalScore" class="fl-input" placeholder="2-1" value="${row.score || '0-0'}"></div>
            </div>
            <div class="fl-field" style="margin-top:8px;">
              <label>Composición (XI del día)</label>
              <div class="fl-row">
                <input id="b2ModalLineup" class="fl-input" style="flex:1;min-width:240px;" value="${parseLineupList(row.lineup || row.startingXI || []).join(', ')}">
                <button class="fl-btn secondary" id="b2ModalOpenLineup" type="button">Abrir pizarra</button>
              </div>
              <input id="b2ModalLineupShape" type="hidden" value='${JSON.stringify(row.lineupShape || {}).replace(/'/g, "&#39;")}'>
            </div>
            <div class="fl-field" style="margin-top:8px;"><label>Relato</label><textarea id="b2ModalNarrative" class="fl-text" style="min-height:130px;">${row.narrative || ''}</textarea></div>
            <div class="fl-field" style="margin-top:8px;"><label>Stats raw (opcional)</label><textarea id="b2ModalStats" class="fl-text" style="min-height:80px;">${row.statsRaw || ''}</textarea></div>
            <div class="fl-row" style="justify-content:space-between;align-items:center;margin-top:10px;">
              <div style="font-weight:700;">Razones detectadas</div>
              <button class="fl-btn secondary" id="b2ModalRegen">Recalcular tags</button>
            </div>
            <div id="b2ModalReasons" style="display:grid;gap:8px;margin-top:8px;"></div>
            <div class="fl-modal-grid" style="margin-top:10px;">
              <div class="fl-field"><label>Tag manual</label><input id="b2ManualTag" class="fl-input" placeholder="finishing_failure"></div>
              <div class="fl-field"><label>Strength 0-1</label><input id="b2ManualStrength" class="fl-input" type="number" step="0.01" min="0" max="1" value="0.5"></div>
              <div class="fl-field"><label>Mins (csv)</label><input id="b2ManualMins" class="fl-input" placeholder="65,78"></div>
            </div>
            <div class="fl-field" style="margin-top:8px;"><label>Nota manual</label><input id="b2ManualNote" class="fl-input" placeholder="Ajuste manual del analista"></div>
            <div class="fl-row" style="justify-content:space-between;margin-top:12px;">
              <span id="b2ModalStatus" class="fl-mini"></span>
              <div class="fl-row"><button class="fl-btn secondary" id="b2AddManualReason">Añadir razón manual</button><button class="fl-btn" id="b2SaveReasonModal">Guardar cambios</button></div>
            </div>
          </div>`;
        document.body.appendChild(backdrop);
        const close = ()=>backdrop.remove();
        backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
        backdrop.querySelector('#b2CloseReasonModal').onclick = close;
        backdrop.querySelector('#b2ModalOpenLineup')?.addEventListener('click', ()=>{
          openBrainV2LineupComposer({
            teamId,
            lineupInput: backdrop.querySelector('#b2ModalLineup'),
            shapeInput: backdrop.querySelector('#b2ModalLineupShape')
          });
        });

        const renderReasons = ()=>{
          const rows = (row.summary?.reasons || []).map((r, idx)=>{
            const mins = (r.mins || []).join(', ');
            const evidence = (Array.isArray(r.evidence) ? r.evidence : []).slice(0, 2).map((e)=>`<div class="fl-mini" style="opacity:.9;">• ${e}</div>`).join('');
            return `<div style="padding:8px;border:1px solid #2f3d4f;border-radius:10px;background:#0f1620;"><div style="font-weight:700;">#${idx+1} ${r.tagId || r.tag} · ${(Number(r.strength||0)*100).toFixed(0)}%</div><div class="fl-mini">mins: ${mins || '-'}</div><div class="fl-mini" style="margin-top:4px;">${r.note || '-'}</div>${evidence}</div>`;
          }).join('') || '<div class="fl-mini">Sin razones para este partido.</div>';
          backdrop.querySelector('#b2ModalReasons').innerHTML = rows;
        };
        renderReasons();

        const syncRowFromModal = ()=>{
          row.date = backdrop.querySelector('#b2ModalDate').value || row.date;
          row.opponent = (backdrop.querySelector('#b2ModalOpponent').value || '').trim();
          row.score = (backdrop.querySelector('#b2ModalScore').value || '0-0').trim();
          row.lineup = parseLineupList(backdrop.querySelector('#b2ModalLineup').value || '');
          row.lineupShape = parseLineupShape(backdrop.querySelector('#b2ModalLineupShape')?.value || '') || null;
          row.narrative = (backdrop.querySelector('#b2ModalNarrative').value || '').trim();
          row.statsRaw = (backdrop.querySelector('#b2ModalStats').value || '').trim();
        };

        backdrop.querySelector('#b2ModalRegen').onclick = ()=>{
          syncRowFromModal();
          buildAndRefreshSummary();
          renderReasons();
          backdrop.querySelector('#b2ModalStatus').textContent = '♻️ Tags recalculados con el relato actual.';
        };

        backdrop.querySelector('#b2AddManualReason').onclick = ()=>{
          const tag = String(backdrop.querySelector('#b2ManualTag').value || '').trim();
          const strength = clamp(Number(backdrop.querySelector('#b2ManualStrength').value), 0, 1);
          const note = String(backdrop.querySelector('#b2ManualNote').value || '').trim();
          const mins = String(backdrop.querySelector('#b2ManualMins').value || '').split(',').map((v)=>Number(v.trim())).filter((v)=>Number.isFinite(v)).map((v)=>clamp(Math.round(v), 0, 140)).slice(0, 5);
          if(!tag){ backdrop.querySelector('#b2ModalStatus').textContent = '⚠️ Escribe un tag manual.'; return; }
          row.summary ||= summary;
          row.summary.reasons ||= [];
          row.summary.reasons.push({ tag, tagId: tag, label: RELATO_TAG_LABELS[tag] || tag, strength, mins, evidence: [], note: note || 'Ajuste manual del analista', auto: false });
          row.summary.reasons = row.summary.reasons.sort((a,b)=>(Number(b.strength)||0)-(Number(a.strength)||0)).slice(0, 6);
          renderReasons();
          backdrop.querySelector('#b2ModalStatus').textContent = '🧩 Razón manual añadida.';
        };

        backdrop.querySelector('#b2SaveReasonModal').onclick = ()=>{
          syncRowFromModal();
          buildAndRefreshSummary();
          rebuildTeamProfileIndex(brainV2, { replace: true, includeOpponent: true });
          saveBrainV2(brainV2);
          if(status) status.textContent = '✅ Partido actualizado con resultado y razones.';
          close();
          render('brainv2', { leagueId: selectedLeagueId, teamId });
        };
      }

      document.querySelectorAll('.b2DeleteMatch').forEach((btn)=>btn.addEventListener('click', ()=>{
        const status = document.getElementById('b2Status');
        const teamId = btn.dataset.teamId || "";
        const matchId = btn.dataset.matchId || "";
        if(!teamId || !matchId || !brainV2.memories[teamId]) return;
        if(!confirm('¿Borrar este partido de la memoria?')) return;
        brainV2.memories[teamId] = brainV2.memories[teamId].filter((row)=>row.id !== matchId);
        rebuildTeamProfileIndex(brainV2, { replace: true, includeOpponent: true });
        saveBrainV2(brainV2);
        if(status) status.textContent = '🗑️ Partido eliminado de la memoria.';
        render('brainv2', { leagueId: selectedLeagueId, teamId });
      }));

      document.querySelectorAll('.b2EditMatch').forEach((btn)=>btn.addEventListener('click', ()=>{
        const teamId = btn.dataset.teamId || "";
        const matchId = btn.dataset.matchId || "";
        openB2MatchReasonModal({ teamId, matchId });
      }));

      document.querySelectorAll('.b2WhyMatch').forEach((btn)=>btn.addEventListener('click', ()=>{
        const status = document.getElementById('b2Status');
        const teamId = btn.dataset.teamId || "";
        const matchId = btn.dataset.matchId || "";
        if(!teamId || !matchId || !brainV2.memories[teamId]) return;
        const row = brainV2.memories[teamId].find((item)=>item.id===matchId);
        if(!row) return;
        const teamName = db.teams.find((t)=>t.id===teamId)?.name || row?.teamName || "Local";
        const summary = ensureBrainV2RowSummary(row, teamName);
        const reasonsTxt = (summary.reasons || []).map((r, idx)=>{
          const mins = (r.mins || r.evidence || []).filter((v)=>Number.isFinite(Number(v))).map((v)=>Number(v));
          const evidenceTxt = Array.isArray(r.evidence) ? r.evidence.filter((v)=>typeof v === 'string') : [];
          return `#${idx+1} ${r.tagId || r.tag} ${(r.strength*100).toFixed(0)}% · mins ${mins.join(',') || '-'} · ${r.note}${evidenceTxt.length ? `\n   ↳ ${evidenceTxt.slice(0,2).join(' | ')}` : ''}`;
        }).join('\n');
        const manual = prompt(
          `Razones de ${row.date || '-'} vs ${row.opponent || 'Rival'}\n\n${reasonsTxt || 'Sin razones'}\n\nIntervención:\n- Escribe "regen" para recalcular\n- O añade manual: tag|strength(0-1)|nota|min1,min2\n- Cancelar para cerrar`,
          ''
        );
        if(manual===null) return;
        const cmd = String(manual || '').trim();
        if(!cmd) return;
        if(cmd.toLowerCase()==='regen'){
          row.summary = buildBrainV2MatchSummary({ row, teamName: row?.teamName || teamName, opponentName: row?.opponent || 'Rival' });
          saveBrainV2(brainV2);
          if(status) status.textContent = '♻️ Razones recalculadas automáticamente.';
          render('brainv2', { leagueId: selectedLeagueId, teamId });
          return;
        }
        const parts = cmd.split('|').map((p)=>String(p || '').trim());
        if(parts.length < 3){
          if(status) status.textContent = '⚠️ Formato inválido. Usa: tag|strength|nota|min1,min2';
          return;
        }
        const [tag, strengthRaw, note, minsRaw=""] = parts;
        const strength = clamp(Number(strengthRaw), 0, 1);
        const evidence = String(minsRaw)
          .split(',')
          .map((v)=>Number(v.trim()))
          .filter((v)=>Number.isFinite(v))
          .map((v)=>clamp(Math.round(v), 0, 140))
          .slice(0, 5);
        row.summary ||= summary;
        row.summary.reasons ||= [];
        row.summary.reasons.push({ tag: tag || 'manual_override', tagId: tag || 'manual_override', label: RELATO_TAG_LABELS[tag] || tag || 'manual_override', strength, mins: evidence, evidence: [], note: note || 'Ajuste manual del analista', auto: false });
        row.summary.reasons = row.summary.reasons.sort((a,b)=>(Number(b.strength)||0)-(Number(a.strength)||0)).slice(0, 6);
        const extra = row.summary.reasons.slice(0, 2).map((r)=>r.note.toLowerCase()).join(' y ');
        row.summary.story = `${teamName} vs ${row?.opponent || 'Rival'}: ${extra || 'partido con señales mixtas'}.`;
        saveBrainV2(brainV2);
        if(status) status.textContent = '🧩 Razón manual aplicada al partido.';
        render('brainv2', { leagueId: selectedLeagueId, teamId });
      }));

      document.getElementById('b2Simulate')?.addEventListener('click', ()=>{
        const homeIdSel = document.getElementById('b2Home')?.value || "";
        const awayIdSel = document.getElementById('b2Away')?.value || "";
        const out = document.getElementById('b2Vision');
        if(!homeIdSel || !awayIdSel || homeIdSel===awayIdSel){ out.textContent = 'Selecciona dos equipos distintos.'; return; }
        const homeTeam = db.teams.find((t)=>t.id===homeIdSel);
        const awayTeam = db.teams.find((t)=>t.id===awayIdSel);
        const homeSummary = summarizeTeamMemory(brainV2.memories[homeIdSel] || []);
        const awaySummary = summarizeTeamMemory(brainV2.memories[awayIdSel] || []);
        const homeProfile = buildTeamNarrativeProfileFromMemories(brainV2.memories[homeIdSel] || []);
        const awayProfile = buildTeamNarrativeProfileFromMemories(brainV2.memories[awayIdSel] || []);
        const vision = buildBrainV2Vision({
          homeSummary,
          awaySummary,
          homeProfile,
          awayProfile,
          gpe: brainV2.gpe,
          homeTeamId: homeIdSel,
          awayTeamId: awayIdSel,
          mneLearning: brainV2.mne,
          odds: {
            home: document.getElementById('b2OddH')?.value,
            draw: document.getElementById('b2OddD')?.value,
            away: document.getElementById('b2OddA')?.value
          }
        });
        const learnedState = normalizeOrchestratorLearningState(brainV2.orchestratorLearning);
        const momentumWindow = {
          home: {
            corners: Number(homeSummary?.avg?.corners || 0),
            shots: Number(homeSummary?.avg?.shots || 0),
            shotsOT: Number(homeSummary?.avg?.shots_on_target || homeSummary?.avg?.shots_target || 0),
            bigChances: Number(homeSummary?.avg?.big_chances || homeSummary?.avg?.bigChances || 0),
            pressureEvents: Number(homeSummary?.avg?.danger_attacks || homeSummary?.avg?.dangerAttacks || 0) / 6
          },
          away: {
            corners: Number(awaySummary?.avg?.corners || 0),
            shots: Number(awaySummary?.avg?.shots || 0),
            shotsOT: Number(awaySummary?.avg?.shots_on_target || awaySummary?.avg?.shots_target || 0),
            bigChances: Number(awaySummary?.avg?.big_chances || awaySummary?.avg?.bigChances || 0),
            pressureEvents: Number(awaySummary?.avg?.danger_attacks || awaySummary?.avg?.dangerAttacks || 0) / 6
          }
        };
        const matchState = {
          minute: 65,
          homeGoals: Number(vision?.score?.home || 0),
          awayGoals: Number(vision?.score?.away || 0),
          tempo: Number((homeSummary?.avg?.shots || 0) + (awaySummary?.avg?.shots || 0)) > 20 ? 'high' : 'medium',
          chaosDetected: false,
          dominanceHome: clamp((Number(vision?.bars?.homeControl || 50)) / 100, 0, 1),
          dominanceAway: clamp((Number(vision?.bars?.awayControl || 50)) / 100, 0, 1),
          liveEventsCount: Math.round((Number(homeSummary?.samples || 0) + Number(awaySummary?.samples || 0)) / 4),
          surpriseIndex: clamp(Math.abs((Number(vision?.probs?.home || 0.33) - Number(vision?.probs?.away || 0.33))), 0, 1)
        };
        const orchestrator = orchestrateBrainV2Decision({
          phase: '60-90',
          matchState,
          learnedBias: learnedState.learnedBias,
          recentWindow: momentumWindow,
          recentEvents: [],
          liveState: {
            minute: 65,
            liveEventsCount: matchState.liveEventsCount,
            shots: Number(homeSummary?.avg?.shots || 0) + Number(awaySummary?.avg?.shots || 0),
            shotsOT: Number(momentumWindow.home.shotsOT || 0) + Number(momentumWindow.away.shotsOT || 0),
            corners: Number(momentumWindow.home.corners || 0) + Number(momentumWindow.away.corners || 0),
            hasGoal: Number(vision?.score?.home || 0) + Number(vision?.score?.away || 0) > 0,
            hasRed: false,
            hasVar: false,
            completeness: clamp((Number(homeSummary?.samples || 0) + Number(awaySummary?.samples || 0)) / 60, 0, 1)
          },
          lsfForecast: {
            probs: {
              base: 0.34,
              trigger: 0.33,
              chaos: 0.33
            }
          }
        });
        const homeReadiness = computeMatchReadinessEngine(db, homeIdSel, { brainV2, teamName: homeTeam?.name || "", leagueId: selectedLeagueId });
        const awayReadiness = computeMatchReadinessEngine(db, awayIdSel, { brainV2, teamName: awayTeam?.name || "", leagueId: selectedLeagueId });
        const readinessDelta = clamp((homeReadiness.readinessScore - awayReadiness.readinessScore) / 100, -0.35, 0.35);
        const rawProbs = {
          home: Number(vision.probs?.home) || 0.33,
          draw: Number(vision.probs?.draw) || 0.34,
          away: Number(vision.probs?.away) || 0.33
        };
        const adjustedProbs = {
          home: clamp(rawProbs.home + readinessDelta * 0.18, 0.05, 0.9),
          draw: clamp(rawProbs.draw - Math.abs(readinessDelta) * 0.08, 0.05, 0.6),
          away: clamp(rawProbs.away - readinessDelta * 0.18, 0.05, 0.9)
        };
        const norm = adjustedProbs.home + adjustedProbs.draw + adjustedProbs.away;
        adjustedProbs.home /= norm;
        adjustedProbs.draw /= norm;
        adjustedProbs.away /= norm;
        const pH = (adjustedProbs.home * 100).toFixed(1);
        const pD = (adjustedProbs.draw * 100).toFixed(1);
        const pA = (adjustedProbs.away * 100).toFixed(1);
        const conf = (vision.confidence * 100).toFixed(0);
        const exp = vision.expected || {};
        const score = vision.score || { home: 0, away: 0, prob: 0 };
        const phy = vision.physical || {};
        const fragilityChaosBoost = homeReadiness.mentalState === "fragil" ? 0.12 : homeReadiness.mentalState === "roto" ? 0.20 : 0;
        const homeMre = toMreTeamModel(homeTeam, homeReadiness, {
          deltaReadiness: readinessDelta * 100,
          chaosBoost: fragilityChaosBoost * 100
        });
        const awayMre = toMreTeamModel(awayTeam, awayReadiness, {
          deltaReadiness: -(readinessDelta * 100),
          chaosBoost: 0
        });
        const mreRows = buildMreComparisonRows(homeMre, awayMre);
        const mreRowsHtml = mreRows.map((row)=>{
          const homeClass = row.winner === "home" ? "mre-win-home" : row.winner === "tie" ? "mre-tie" : "";
          const awayClass = row.winner === "away" ? "mre-win-away" : row.winner === "tie" ? "mre-tie" : "";
          return `<tr>
            <td class="mre-label">${row.label}</td>
            <td class="${homeClass}">${row.homeText}</td>
            <td class="${awayClass}">${row.awayText}</td>
            <td class="mre-reading">${row.interpretation}</td>
          </tr>`;
        }).join("");
        applyHeroReveal(out);
        out.innerHTML = `
          <div style="font-weight:800;">${homeTeam?.name || 'Local'} vs ${awayTeam?.name || 'Visita'}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;">
            <div class="fl-card" style="padding:8px;text-align:center;"><div class="fl-mini">Local</div><div style="font-size:22px;font-weight:900;">${pH}%</div></div>
            <div class="fl-card" style="padding:8px;text-align:center;"><div class="fl-mini">Empate</div><div style="font-size:22px;font-weight:900;">${pD}%</div></div>
            <div class="fl-card" style="padding:8px;text-align:center;"><div class="fl-mini">Visita</div><div style="font-size:22px;font-weight:900;">${pA}%</div></div>
          </div>
          <div style="margin-top:10px;font-weight:800;">⚡ MATCH READINESS CARD</div>
          <div class="fl-mre-table-wrap">
            <table class="fl-mre-table">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>${homeMre.teamName || 'Local'}</th>
                  <th>${awayMre.teamName || 'Visita'}</th>
                  <th>Lectura</th>
                </tr>
              </thead>
              <tbody>${mreRowsHtml}</tbody>
            </table>
          </div>
          <div class="fl-mini" style="margin-top:8px;">Confianza estimada: <b>${conf}%</b> · muestras ${homeSummary.samples}/${awaySummary.samples} · Prob base ${(rawProbs.home*100).toFixed(1)}/${(rawProbs.draw*100).toFixed(1)}/${(rawProbs.away*100).toFixed(1)} → ajustada ${pH}/${pD}/${pA}</div>
          <div class="fl-mini" style="margin-top:4px;">Muestras MRE ${homeMre.teamName}: <b>${homeReadiness?.evidence?.raw?.totalMatches ?? 0}</b> · ${awayMre.teamName}: <b>${awayReadiness?.evidence?.raw?.totalMatches ?? 0}</b> · Fuente: <b>${homeReadiness?.evidence?.source || "brainV2.memories"}</b></div>
          <div class="fl-mini" style="margin-top:4px;">Filtro: <b>${homeReadiness?.evidence?.filterLabel || "all competitions"}</b> · fallback: <b>${homeReadiness?.evidence?.fallback ? "sí" : "no"}</b>${homeReadiness?.evidence?.raw?.leagueFallback ? " (liga→all competitions)" : ""}</div>
          <div class="fl-mini" style="margin-top:4px;">Perfil narrativo (N=${homeProfile.lastN}/${awayProfile.lastN}) · presión tardía ${homeProfile.tendencies.latePressureAvg.toFixed(1)} vs ${awayProfile.tendencies.latePressureAvg.toFixed(1)}</div>
          <div class="fl-card" style="margin-top:8px;padding:8px;"><b>Global Evidence</b>
            <div class="fl-mini" style="margin-top:4px;">${vision.globalEvidence?.evidenceOk ? '✅ Global Evidence OK' : '❌ Sin evidencia global fuerte'}</div>
            ${vision.globalEvidence?.evidenceOk
              ? (vision.globalEvidence?.topContributors || []).map((item)=>`<div class="fl-mini">${item.tagId}: n=${item.n} rel=${(item.reliability*100).toFixed(0)}% → ${item.impactDelta>=0?'+':''}${item.impactDelta.toFixed(1)}% ${item.impactTarget}</div>`).join('')
              : `<div class="fl-mini">Se requiere avg rel ≥60% y al menos 60 matches globales (actual: ${vision.globalEvidence?.eligibleCount || 0} tags confiables · ${(Number(vision.globalEvidence?.avgReliability||0)*100).toFixed(0)}%).</div>`}
            ${(vision.globalEvidence?.trapWarnings || []).map((w)=>`<div class="fl-mini">⚠️ ${w.reason} · conf ${(Number(w.confidence||0)*100).toFixed(0)}%</div>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px;">
            <div class="fl-card" style="padding:8px;"><div class="fl-mini">⚽ xG esperado</div><div style="font-weight:800;">${exp.goalsHome?.toFixed(2)} - ${exp.goalsAway?.toFixed(2)}</div></div>
            <div class="fl-card" style="padding:8px;"><div class="fl-mini">🎯 Marcador probable</div><div style="font-weight:800;">${score.home}-${score.away} (${(score.prob * 100).toFixed(1)}%)</div></div>
            <div class="fl-card" style="padding:8px;"><div class="fl-mini">🚩 Córners</div><div style="font-weight:800;">${exp.cornersHome?.toFixed(1)} - ${exp.cornersAway?.toFixed(1)}</div></div>
            <div class="fl-card" style="padding:8px;"><div class="fl-mini">🟨 Tarjetas</div><div style="font-weight:800;">${exp.cardsHome?.toFixed(1)} - ${exp.cardsAway?.toFixed(1)}</div></div>
          </div>
          <details style="margin-top:10px;" open>
            <summary style="font-weight:800;cursor:pointer;">Advanced Orchestrator Signals</summary>
            <div class="fl-card" style="margin-top:8px;padding:8px;display:grid;gap:8px;">
              <div class="fl-mini"><b>Dynamic Weights:</b> ${Object.entries(orchestrator.finalWeights).map(([k,v])=>`${k} ${(Number(v)*100).toFixed(1)}%`).join(' · ')}</div>
              <div class="fl-mini"><b>Live Evidence Strength:</b> ${orchestrator.advancedSignals.evidence.label} (${(Number(orchestrator.advancedSignals.evidence.score)*100).toFixed(0)}%)</div>
              <div class="fl-mini"><b>Emotional Impact:</b> ${orchestrator.advancedSignals.emotional.level} · score ${Number(orchestrator.advancedSignals.emotional.score).toFixed(2)} · triggers ${(orchestrator.advancedSignals.emotional.triggeredBy || []).join(', ') || 'none'}</div>
              <div class="fl-mini"><b>Momentum:</b> home ${Number(orchestrator.advancedSignals.momentum.homeMomentum).toFixed(2)} vs away ${Number(orchestrator.advancedSignals.momentum.awayMomentum).toFixed(2)} · ${orchestrator.advancedSignals.momentum.label}</div>
              <div class="fl-mini">${(orchestrator.explanation || []).map((r)=>`• ${r}`).join(' ')}</div>
            </div>
          </details>
          <div style="margin-top:10px;display:grid;gap:6px;">
            <div>⚔️ Ataque local <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${vision.bars.homeAttack}%;height:8px;background:#3fb950;border-radius:999px;"></div></div></div>
            <div>🛡️ Ataque visita <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${vision.bars.awayAttack}%;height:8px;background:#58a6ff;border-radius:999px;"></div></div></div>
            <div>🎛️ Control local <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${vision.bars.homeControl}%;height:8px;background:#f2cc60;border-radius:999px;"></div></div></div>
            <div>🧭 Control visita <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${vision.bars.awayControl}%;height:8px;background:#d2a8ff;border-radius:999px;"></div></div></div>
            <div>🫀 Resistencia local <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${Math.round(phy.homeResistance || 0)}%;height:8px;background:#2ea043;border-radius:999px;"></div></div></div>
            <div>🫀 Resistencia visita <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${Math.round(phy.awayResistance || 0)}%;height:8px;background:#1f6feb;border-radius:999px;"></div></div></div>
            <div>🥵 Cansancio local <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${Math.round(phy.homeFatigue || 0)}%;height:8px;background:#ff7b72;border-radius:999px;"></div></div></div>
            <div>🥵 Cansancio visita <div style="height:8px;background:#222;border-radius:999px;"><div style="width:${Math.round(phy.awayFatigue || 0)}%;height:8px;background:#ffa657;border-radius:999px;"></div></div></div>
          </div>
          <div class="fl-mini" style="margin-top:8px;display:grid;gap:4px;">
            ${(vision.insights || []).map((line)=>`<div>${line}</div>`).join('')}
          </div>
          <div class="fl-card" style="margin-top:10px;padding:10px;">
            <div style="font-weight:800;">🧠 Por qué este resultado (pre-match)</div>
            <div class="fl-mini" style="margin-top:6px;display:grid;gap:4px;">
              ${(vision.reasonPreview || []).map((r, idx)=>`<div>#${idx+1} ${r.tag} · ${(r.strength*100).toFixed(0)}% · ${r.note}</div>`).join('') || '<div>Sin razones fuertes todavía.</div>'}
            </div>
          </div>
          <div class="fl-card" style="margin-top:10px;padding:10px;">
            <div style="font-weight:800;">📜 Match Narrative Engine (MNE)</div>
            <div class="fl-mini" style="margin-top:6px;display:grid;gap:8px;">
              ${(vision.mne?.narrative || []).map((phase)=>`
                <div class="fl-card" style="padding:8px;">
                  <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${phase.phase} · ${phase.title}</b><span>${Math.round((phase.confidence || 0)*100)}%</span></div>
                  <div style="margin-top:4px;">Tags: ${(phase.tags || []).join(', ') || 'sin tags'}</div>
                  <ul style="margin:4px 0 0 16px;">${(phase.notes || []).slice(0,2).map((note)=>`<li>${note}</li>`).join('')}</ul>
                  <div style="margin-top:4px;">Data: N=${phase.confidenceMeta?.N || 0} · Completeness=${Math.round((phase.confidenceMeta?.completeness || 0)*100)}% ${phase.confidenceMeta?.lowConfidence ? '· ⚠️ low confidence' : ''}</div>
                </div>
              `).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px;">
              <div class="fl-card" style="padding:8px;"><b>Key Risks</b>${(vision.mne?.keyRisks || []).map((risk)=>`<div class="fl-mini">• ${risk.tag} (${risk.side}) · ${risk.impact} · ${Math.round((risk.confidence||0)*100)}%</div>`).join('') || '<div class="fl-mini">Sin riesgos dominantes.</div>'}</div>
              <div class="fl-card" style="padding:8px;"><b>Live Triggers</b>${(vision.mne?.liveTriggers || []).map((trigger)=>`<div class="fl-mini">• Si ${trigger.if} → ${trigger.then} (${trigger.weight>0?'+':''}${trigger.weight.toFixed(2)})</div>`).join('') || '<div class="fl-mini">Sin triggers todavía.</div>'}</div>
            </div>
          </div>
          <div class="fl-card" style="margin-top:10px;padding:10px;">
            <div style="font-weight:800;">🧩 MNE ↔ Claude Offline Learning</div>
            <div class="fl-row" style="margin-top:8px;gap:8px;align-items:center;flex-wrap:wrap;">
              <button class="fl-btn" id="mneClaudeExportBtn">Export for Claude</button>
              <label class="fl-btn" for="mneClaudeFileInput" style="cursor:pointer;">Import Claude Feedback</label>
              <input type="file" id="mneClaudeFileInput" accept="application/json" style="display:none;" />
              <span id="mneClaudeStatus" class="fl-mini"></span>
            </div>
            <textarea id="mneClaudeImportText" class="fl-text" style="margin-top:8px;" placeholder="O pega aquí el JSON de feedback de Claude..."></textarea>
            <div class="fl-row" style="margin-top:6px;gap:8px;">
              <button class="fl-btn" id="mneClaudeImportTextBtn">Import from text</button>
            </div>
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;font-weight:700;">Preview export JSON</summary>
              <textarea id="mneClaudeExportPreview" class="fl-text" style="margin-top:6px;min-height:160px;" readonly></textarea>
            </details>
            <div id="mneClaudeFeedbackSummary" class="fl-mini" style="margin-top:8px;display:grid;gap:6px;"></div>
            <div id="mneLearningAuditSummary" class="fl-mini" style="margin-top:8px;display:grid;gap:6px;"></div>
          </div>
          <div class="fl-card" style="margin-top:10px;padding:10px;">
            <div style="font-weight:800;">⚡ MNE Live Feedback Loop (LFL)</div>
            <div class="fl-row" style="margin-top:8px;gap:8px;align-items:flex-end;flex-wrap:wrap;">
              <div>
                <div class="fl-mini">Fase</div>
                <select id="mneLflPhase" class="fl-select">${(vision.mne?.narrative || []).map((p)=>`<option value="${p.phase}">${p.phase}</option>`).join('')}</select>
              </div>
              <button class="fl-btn" id="mneLflCompare">Compare & Learn</button>
              <span id="mneLflStatus" class="fl-mini"></span>
            </div>
            <textarea id="mneLflNarrative" class="fl-text" style="margin-top:8px;" placeholder="Pega el relato real del bloque seleccionado..."></textarea>
            <div id="mneLsfPanel" class="fl-card" style="margin-top:8px;padding:8px;"></div>
            <div class="fl-row" style="margin-top:6px;gap:8px;">
              <button class="fl-btn" id="mneLsfLearnedBtn">What LSF learned</button>
              <span id="mneLsfLearnStatus" class="fl-mini"></span>
            </div>
            <div id="mneAdjustWidget" class="fl-mini" style="margin-top:8px;"></div>
            <div id="mneLflTimeline" class="fl-mini" style="margin-top:8px;display:grid;gap:8px;"></div>
            <div id="mneLearningLog" class="fl-mini" style="margin-top:8px;"></div>
          </div>
          <div class="fl-mini" style="margin-top:8px;">${vision.missing.length ? `⚠️ Falta info: ${vision.missing.join(' · ')}` : '✅ Dataset suficiente para seguir mejorando el modelo TensorFlow.'}</div>
        `;

        const simMatchId = `sim_${homeIdSel}_${awayIdSel}`;
        brainV2.mne ||= normalizeMneLearningState({});

        const claudeStatusEl = document.getElementById('mneClaudeStatus');
        const claudeExportPreviewEl = document.getElementById('mneClaudeExportPreview');
        const claudeFeedbackSummaryEl = document.getElementById('mneClaudeFeedbackSummary');
        const mneLearningAuditSummaryEl = document.getElementById('mneLearningAuditSummary');
        const setClaudeStatus = (text)=>{ if(claudeStatusEl) claudeStatusEl.textContent = text; };
        const currentMemoryRows = (brainV2.memories?.[homeIdSel] || []).slice(-5);
        const buildClaudePayload = ()=>buildMneClaudeExport({
          match: {
            id: simMatchId,
            home: homeTeam?.name || 'Local',
            away: awayTeam?.name || 'Visitante',
            competition: db.leagues.find((row)=>row.id===db.settings?.selectedLeagueId)?.name || 'Simulation',
            date: new Date().toISOString().slice(0, 10),
            score: { home: Number(vision?.score?.home || 0), away: Number(vision?.score?.away || 0) },
            status: 'simulation'
          },
          vision,
          memoryRows: currentMemoryRows
        });
        const renderClaudeFeedbackSummary = ()=>{
          const latest = getLatestClaudeFeedback(brainV2.mne?.claudeExchange, simMatchId);
          if(!claudeFeedbackSummaryEl) return;
          if(!latest?.feedback){
            claudeFeedbackSummaryEl.innerHTML = '<div class="fl-mini">Sin feedback importado todavía para este match.</div>';
            return;
          }
          const fb = latest.feedback;
          const rules = (fb.newRules || []).map((rule)=>`<li>${rule.name} (${Math.round((Number(rule.confidence)||0)*100)}%)</li>`).join('') || '<li>Sin reglas sugeridas.</li>';
          const missed = (fb.missedSignals || []).map((row)=>`<li>${row.type}: ${row.detail}</li>`).join('') || '<li>Sin señales.</li>';
          const patterns = (fb.patternInsights || []).map((row)=>`<li>${row.name}: ${row.detail}</li>`).join('') || '<li>Sin patrones.</li>';
          const notes = (fb.trainingNotes || []).map((n)=>`<li>${n}</li>`).join('') || '<li>Sin notas.</li>';
          claudeFeedbackSummaryEl.innerHTML = `
            <div class="fl-card" style="padding:8px;">
              <div><b>Último import:</b> ${latest.importedAt || 'N/A'}</div>
              <div>Evaluación: ${fb.evaluation?.summary || 'Sin resumen'} · Accuracy ${(Number(fb.evaluation?.accuracy || 0)*100).toFixed(0)}% · ${fb.evaluation?.agreementLevel || 'medium'}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
              <div class="fl-card" style="padding:8px;"><b>Reglas sugeridas</b><ul style="margin:6px 0 0 16px;">${rules}</ul></div>
              <div class="fl-card" style="padding:8px;"><b>Señales ignoradas</b><ul style="margin:6px 0 0 16px;">${missed}</ul></div>
              <div class="fl-card" style="padding:8px;"><b>Patrones aprendidos</b><ul style="margin:6px 0 0 16px;">${patterns}</ul></div>
              <div class="fl-card" style="padding:8px;"><b>Training notes</b><ul style="margin:6px 0 0 16px;">${notes}</ul></div>
            </div>`;
        };

        const renderLearningAuditSummary = ()=>{
          if(!mneLearningAuditSummaryEl) return;
          const audits = (brainV2.mne?.claudeExchange?.learningAudit?.audits || []).filter((row)=>String(row?.sourceMatchId || '') === simMatchId).slice(-4).reverse();
          if(!audits.length){
            mneLearningAuditSummaryEl.innerHTML = '<div class="fl-card" style="padding:8px;"><b>Learning Audit</b><div class="fl-mini" style="margin-top:4px;">Sin auditorías todavía. Se crean automáticamente al importar feedback Claude.</div></div>';
            return;
          }
          const statusColor = (status)=> status === 'improved' ? '#22c55e' : status === 'regressed' ? '#ef4444' : status === 'mixed' ? '#f59e0b' : '#94a3b8';
          mneLearningAuditSummaryEl.innerHTML = `<div class="fl-card" style="padding:8px;"><b>Learning Audit</b> · ${audits.length} auditoría(s) activas</div>${audits.map((audit)=>{
            const tracked = (audit.trackedItems || []).slice(0,6).map((item)=>`<li>${item.kind}: ${item.label || item.key}</li>`).join('') || '<li>Sin items.</li>';
            const lastObs = (audit.observations || []).slice(-2).reverse().map((obs)=>`<div>• ${obs.observedMatchId || 'N/A'} · ${obs.status} · ${obs.notes || ''}</div>`).join('') || '<div>Sin observaciones aún.</div>';
            const m = audit.metrics || {};
            return `<div class="fl-card" style="padding:8px;">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>Source: ${audit.sourceMatchId || 'N/A'}</b><span class="fl-pill" style="border:1px solid ${statusColor(audit.aggregateStatus)};color:${statusColor(audit.aggregateStatus)};">${audit.aggregateStatus || 'unchanged'}</span></div>
              <div style="margin-top:4px;">Importado: ${audit.importedAt || 'N/A'}</div>
              <div style="margin-top:4px;">Observed matches: ${m.totalObservedMatches || 0} · improved ${m.improvements || 0} · unchanged ${m.unchanged || 0} · regressed ${m.regressions || 0} · not_triggered ${m.notTriggered || 0}</div>
              <div style="margin-top:4px;">Triggered rules: ${m.triggeredRules || 0} · last status: ${m.lastStatus || 'unchanged'}</div>
              <div style="margin-top:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
                <div><b>Tracked items</b><ul style="margin:6px 0 0 16px;">${tracked}</ul></div>
                <div><b>Latest evidence</b><div style="margin-top:6px;">${lastObs}</div></div>
              </div>
            </div>`;
          }).join('')}`;
        };

        const refreshClaudeExportPreview = ()=>{
          const payload = buildClaudePayload();
          if(claudeExportPreviewEl) claudeExportPreviewEl.value = safeJsonPreview(payload);
          return payload;
        };
        const importClaudeFeedbackText = (rawText)=>{
          const result = parseClaudeFeedbackText(rawText);
          if(!result.ok){
            setClaudeStatus(`❌ ${result.errors.join(' | ')}`);
            return;
          }
          brainV2.mne = updateClaudeMemoryState(brainV2.mne, { matchId: simMatchId, feedback: result.data });
          saveBrainV2(brainV2);
          const warnText = (result.warnings || []).length ? ` · ⚠️ ${result.warnings.join(' | ')}` : '';
          setClaudeStatus(`✅ Feedback importado${warnText}`);
          renderClaudeFeedbackSummary();
          renderLearningAuditSummary();
          refreshClaudeExportPreview();
        };

        document.getElementById('mneClaudeExportBtn')?.addEventListener('click', ()=>{
          try{
            const payload = refreshClaudeExportPreview();
            const json = safeJsonPreview(payload);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mne-claude-export-${simMatchId}-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setClaudeStatus('✅ Export generado y descargado.');
          }catch(err){
            setClaudeStatus(`❌ ${String(err?.message || err)}`);
          }
        });

        document.getElementById('mneClaudeImportTextBtn')?.addEventListener('click', ()=>{
          const raw = String(document.getElementById('mneClaudeImportText')?.value || '').trim();
          if(!raw){
            setClaudeStatus('⚠️ Pega un JSON antes de importar.');
            return;
          }
          importClaudeFeedbackText(raw);
        });

        document.getElementById('mneClaudeFileInput')?.addEventListener('change', async (ev)=>{
          const file = ev?.target?.files?.[0];
          if(!file){
            setClaudeStatus('⚠️ Selecciona un archivo JSON.');
            return;
          }
          try{
            const text = await file.text();
            importClaudeFeedbackText(text);
          }catch(err){
            setClaudeStatus(`❌ ${String(err?.message || err)}`);
          }finally{
            ev.target.value = '';
          }
        });

        refreshClaudeExportPreview();
        renderClaudeFeedbackSummary();
        renderLearningAuditSummary();

        const renderLfl = ()=>{
          const timeline = document.getElementById('mneLflTimeline');
          const logEl = document.getElementById('mneLearningLog');
          const widget = document.getElementById('mneAdjustWidget');
          const lsfPanel = document.getElementById('mneLsfPanel');
          const lsfState = brainV2.mne.lsfState = normalizeLsfState(brainV2.mne.lsfState);
          const preds = brainV2.mne.phasePredictions?.[simMatchId] || [];
          const obs = brainV2.mne.phaseObservations?.[simMatchId] || [];
          const fRecords = brainV2.mne.lsfForecasts?.[simMatchId] || [];
          const merged = preds.map((pred)=>{
            const phaseObs = obs.find((row)=>row.phase===pred.phase);
            const cmp = phaseObs?.comparison || null;
            const fc = fRecords.find((row)=>row.madeAtPhase===pred.phase);
            return { pred, phaseObs, cmp, fc };
          });
          timeline.innerHTML = merged.map((row)=>{
            if(!row.phaseObs) return `<div class="fl-card" style="padding:8px;"><b>${row.pred.phase}</b> · pendiente de observación real.</div>`;
            const m = row.cmp?.metrics || {};
            const fcRow = row.fc ? `<div>LSF → ${row.fc.nextScenario} (${Math.round((Number(row.fc.probs?.base)||0)*100)} / ${Math.round((Number(row.fc.probs?.trigger)||0)*100)} / ${Math.round((Number(row.fc.probs?.chaos)||0)*100)})</div>` : '';
            return `<div class="fl-card" style="padding:8px;">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${row.pred.phase}</b><span>Conf ${Math.round((row.pred.predicted.confidence||0)*100)}%</span></div>
              <div>Pred: ${Object.keys(row.pred.predicted.tags || {}).join(', ') || '—'}</div>
              <div>Obs: ${Object.entries(row.phaseObs.observed.derivedTags || {}).map(([k,v])=>`${k}:${(Number(v)||0).toFixed(2)}`).join(' · ')}</div>
              ${fcRow}
              <div>✅ hits: ${(row.cmp?.hits || []).join(', ') || '—'} · ❌ misses: ${(row.cmp?.misses || []).join(', ') || '—'} · ⚡ surprises: ${(row.cmp?.surprises || []).join(', ') || '—'}</div>
              <div>Accuracy ${(Number(m.precision||0)*100).toFixed(0)}% · Calibration ${(Number(m.calibrationError||0)).toFixed(2)} · Surprise ${(Number(m.surprise||0)*100).toFixed(0)}%</div>
            </div>`;
          }).join('') || '<div class="fl-mini">Sin comparaciones todavía.</div>';
          const logs = (brainV2.mne.learningLog || []).filter((row)=>row.matchId===simMatchId).slice(-5).reverse();
          logEl.innerHTML = `<b>Learning Log</b>${logs.map((row)=>`<div>• ${row.phase} · ${(row.updates || []).map((up)=>`${up.type}:${up.id} ${up.delta>0?'+':''}${Number(up.delta||0).toFixed(3)}`).join(' | ') || 'sin cambios'}</div>`).join('') || '<div>Sin ajustes.</div>'}`;
          const today = new Date().toISOString().slice(0, 10);
          const todayUpdates = (brainV2.mne.learningLog || []).filter((row)=>String(row.ts || '').startsWith(today)).flatMap((row)=>row.updates || []);
          const scenesN = todayUpdates.filter((u)=>u.type==='scene').length;
          const triggersN = todayUpdates.filter((u)=>u.type==='trigger').length;
          const cals = todayUpdates.filter((u)=>u.type==='calibration').map((u)=>Number(u.delta)||0);
          widget.innerHTML = `<b>Brain is adjusting</b> · Scenes adjusted today: <b>${scenesN}</b> · Triggers adjusted: <b>${triggersN}</b> · Calibration improved: <b>${(Math.max(0, -average(cals, 0))*100).toFixed(1)}%</b>`;
          const phase = document.getElementById('mneLflPhase')?.value || '0-15';
          const fRec = fRecords.find((r)=>r.madeAtPhase===phase) || fRecords[fRecords.length - 1];
          if(lsfPanel){
            const acc10rows = (brainV2.mne.lsfEvalHistory || []).filter((r)=>r.matchId===simMatchId).slice(-10);
            const acc10 = acc10rows.length ? acc10rows.filter((r)=>r.predicted===r.truth).length / acc10rows.length : 0;
            const avgBrier = lsfState.stats.forecastsMade ? lsfState.stats.brierSum / lsfState.stats.forecastsMade : 0;
            if(fRec){
              const bars = [
                { scenario: 'base', pct: Math.round((Number(fRec.probs?.base || 0) * 100)) },
                { scenario: 'trigger', pct: Math.round((Number(fRec.probs?.trigger || 0) * 100)) },
                { scenario: 'chaos', pct: Math.round((Number(fRec.probs?.chaos || 0) * 100)) }
              ];
              const leader = bars.slice().sort((a,b)=>b.pct-a.pct)[0] || { scenario: 'base', pct: 0 };
              const confPct = Math.round((Number(fRec.confidence || 0) * 100));
              const confMeta = confPct < 35
                ? { icon: '🔴', label: 'Baja', color: '#ef4444', desc: 'Baja: partido impredecible' }
                : confPct < 60
                  ? { icon: '🟡', label: 'Media', color: '#f59e0b', desc: 'Media: guion probable' }
                  : { icon: '🟢', label: 'Alta', color: '#22c55e', desc: 'Alta: guion claro' };
              const switchRiskMeta = (()=>{
                const entropy = Number(fRec.entropy || 0);
                const gap = Number(fRec.leaderGap || 0);
                const nearTie = gap < 0.07;
                if(entropy > 0.92 || nearTie || String(fRec.switchRisk || '').toUpperCase()==='HIGH') return { icon: '🔴', label: 'Alto', color: '#ef4444', desc: 'El guion puede cambiar con 1 evento.' };
                if(entropy > 0.7 || String(fRec.switchRisk || '').toUpperCase()==='MED') return { icon: '🟡', label: 'Medio', color: '#f59e0b', desc: 'Hay señales mixtas; atento a los próximos minutos.' };
                return { icon: '🟢', label: 'Bajo', color: '#22c55e', desc: 'Guion estable salvo evento fuerte.' };
              })();
              const driversHuman = (fRec.drivers || []).slice(0,3).map((d)=>({
                human: toHuman(d.key),
                pushes: d.scenario,
                technical: `${d.key} (${d.val>0?'+':''}${Number(d.val || 0).toFixed(2)} ${d.scenario})`
              }));
              const switches = (fRec.ifThen || []).slice(0,2).map((i)=>({
                cond: String(i.label || '').replace(/^Si\s+/i, '').replace('home', 'Local').replace('away', 'Visita').replace('corners', 'córners').replace('shotsOT', 'tiros a puerta'),
                effect: `${scenarioLabel(i.scenario)} +${Math.round((Number(i.delta || 0) * 100))}%`
              }));
              lsfPanel.innerHTML = `<div style="display:grid;gap:10px;">
                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">🔮 Próximos 10–15 min (${fRec.forecastForPhase || '-'})</div>
                  <div class="fl-mini" style="margin-top:2px;opacity:.85;">Escenario esperado</div>
                  <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
                    <div style="font-size:20px;font-weight:900;">${scenarioLabel(leader.scenario)}</div>
                    <span class="fl-pill" style="background:rgba(59,130,246,.2);border:1px solid rgba(59,130,246,.55);font-weight:800;">${leader.pct}%</span>
                  </div>
                  <div class="fl-mini" style="margin-top:8px;">Confianza ${confMeta.icon} <b>${confMeta.label}</b> (${confPct}%)</div>
                  <div style="margin-top:4px;height:8px;border-radius:999px;background:rgba(148,163,184,.25);overflow:hidden;"><div style="width:${confPct}%;height:100%;background:${confMeta.color};"></div></div>
                  <div class="fl-mini" style="margin-top:6px;">Esto significa: ${confMeta.desc}</div>
                </div>

                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">📊 Mapa de escenarios</div>
                  <div style="margin-top:8px;display:grid;gap:6px;">${bars.map((b)=>{
                    const active = b.scenario===leader.scenario;
                    const color = active ? '#60a5fa' : '#64748b';
                    return `<div class="fl-mini" style="display:grid;grid-template-columns:130px 1fr 46px;gap:8px;align-items:center;${active?'font-weight:700;':''}">
                      <span>${scenarioLabel(b.scenario)}</span>
                      <div style="height:8px;border-radius:999px;background:rgba(148,163,184,.2);overflow:hidden;"><div style="width:${b.pct}%;height:100%;background:${color};"></div></div>
                      <span>${b.pct}%</span>
                    </div>`;
                  }).join('')}</div>
                </div>

                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">🚦 Riesgo de cambio</div>
                  <div style="margin-top:8px;font-size:20px;font-weight:900;color:${switchRiskMeta.color};">${switchRiskMeta.icon} ${switchRiskMeta.label}</div>
                  <div class="fl-mini" style="margin-top:6px;">${switchRiskMeta.desc}</div>
                </div>

                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">🧭 Qué lo está empujando</div>
                  <div style="margin-top:6px;display:grid;gap:4px;">${driversHuman.map((d)=>`<div class="fl-mini">• ${d.human} → empuja a <b>${scenarioLabel(d.pushes)}</b></div>`).join('') || '<div class="fl-mini">Sin señales fuertes todavía.</div>'}</div>
                  <details style="margin-top:8px;"><summary class="fl-mini" style="cursor:pointer;">Ver técnico</summary><div class="fl-mini" style="margin-top:4px;display:grid;gap:2px;">${driversHuman.map((d)=>`<div>• ${d.technical}</div>`).join('') || '<div>Sin drivers técnicos.</div>'}</div></details>
                </div>

                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">⚑ Qué lo cambia</div>
                  <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">${switches.map((s)=>`<div class="fl-card" style="padding:8px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);"><div class="fl-mini">Si pasa esto…</div><div><b>${s.cond}</b></div><div class="fl-mini" style="margin-top:4px;">cambia a <b>${s.effect}</b></div></div>`).join('') || '<div class="fl-mini">Sin switches candidatos todavía.</div>'}</div>
                </div>

                <div class="fl-card" style="padding:10px;">
                  <div style="font-weight:800;">🧠 Aprendizaje de hoy</div>
                  <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;" class="fl-mini">
                    <div>🧠 Forecasts hoy: <b>${lsfState.stats.forecastsMade}</b></div>
                    <div>✅ Acierto (últimos 10): <b>${(acc10*100).toFixed(0)}%</b></div>
                    <div>🎯 Error (Brier): <b>${avgBrier.toFixed(3)}</b></div>
                    <div>🔄 Ajustó pesos: <b>${(brainV2.mne.lsfEvalHistory || []).slice(-1)[0]?.updatesCount>0 ? 'Sí':'No'}</b></div>
                  </div>
                  <div class="fl-mini" style="margin-top:6px;">El sistema está aprendiendo: aún con poca muestra.</div>
                </div>

                <details class="fl-card" style="padding:10px;" open>
                  <summary style="font-weight:800;cursor:pointer;">Advanced Orchestrator Signals</summary>
                  <div class="fl-mini" style="margin-top:8px;display:grid;gap:4px;">${fRec.orchestrator
                    ? `<div><b>Dynamic Weights</b>: ${Object.entries(fRec.orchestrator.finalWeights || {}).map(([k,v])=>`${k} ${(Number(v)*100).toFixed(1)}%`).join(' · ')}</div>
                       <div><b>Live Evidence</b>: ${fRec.orchestrator?.advancedSignals?.evidence?.label || '-'} (${(Number(fRec.orchestrator?.advancedSignals?.evidence?.score || 0)*100).toFixed(0)}%)</div>
                       <div><b>Emotional Impact</b>: ${(Number(fRec.orchestrator?.advancedSignals?.emotional?.score || 0)).toFixed(2)} · ${fRec.orchestrator?.advancedSignals?.emotional?.level || 'low'} · ${(fRec.orchestrator?.advancedSignals?.emotional?.triggeredBy || []).join(', ') || 'none'}</div>
                       <div><b>Momentum</b>: home ${(Number(fRec.orchestrator?.advancedSignals?.momentum?.homeMomentum || 0)).toFixed(2)} vs away ${(Number(fRec.orchestrator?.advancedSignals?.momentum?.awayMomentum || 0)).toFixed(2)} · ${fRec.orchestrator?.advancedSignals?.momentum?.label || 'flat'}</div>
                       <div>${(fRec.orchestrator?.explanation || []).map((x)=>`• ${x}`).join(' ')}</div>`
                    : 'Sin señales avanzadas aún.'}
                  </div>
                </details>
              </div>`;
            }else{
              lsfPanel.innerHTML = '<div class="fl-mini">Aún no hay forecast LSF para esta fase. Usa Compare & Learn para generarlo.</div>';
            }
          }
        };


        const initialPreds = (vision.mne?.narrative || []).map((phaseData)=>buildMnePhasePrediction({ matchId: simMatchId, phaseData }));
        brainV2.mne.phasePredictions[simMatchId] = initialPreds;
        brainV2.mne.phaseObservations[simMatchId] ||= [];
        brainV2.mne.lsfForecasts ||= {};
        brainV2.mne.lsfForecasts[simMatchId] ||= [];
        brainV2.mne.lsfState = normalizeLsfState(brainV2.mne.lsfState);
        saveBrainV2(brainV2);
        renderLfl();

        document.getElementById('mneLflCompare')?.addEventListener('click', ()=>{
          const phase = document.getElementById('mneLflPhase')?.value || '0-15';
          const raw = String(document.getElementById('mneLflNarrative')?.value || '').trim();
          const statusEl = document.getElementById('mneLflStatus');
          if(!raw){ if(statusEl) statusEl.textContent = '⚠️ Pega el relato real de la fase.'; return; }
          const prediction = (brainV2.mne.phasePredictions[simMatchId] || []).find((row)=>row.phase===phase) || buildMnePhasePrediction({ matchId: simMatchId, phaseData: { phase, tags: [], confidence: 0.1, confidenceMeta: {} } });
          const baseTerritorialDiff = (homeProfile?.phaseDNA?.territorial_pressure?.[phase] || 0) - (awayProfile?.phaseDNA?.territorial_pressure?.[phase] || 0);
          const observation = buildObservedPhaseFromNarrative({ matchId: simMatchId, phase, narrativeRaw: raw, homeTeam: homeTeam?.name || 'Local', awayTeam: awayTeam?.name || 'Rival', baseTerritorialDiff });
          const comparison = compareMnePredictionVsReality(prediction, observation);
          const learning = applyMneLearning({ brainV2, matchId: simMatchId, phase, homeTeamId: homeIdSel, awayTeamId: awayIdSel, prediction, comparison, evidenceCount: observation?.observed?.evidence?.events || 0 });
          const list = brainV2.mne.phaseObservations[simMatchId] || [];
          const nextRow = { ...observation, comparison, learning };
          const idx = list.findIndex((row)=>row.phase===phase);
          if(idx >= 0) list[idx] = nextRow;
          else list.push(nextRow);
          brainV2.mne.phaseObservations[simMatchId] = list;

          const featuresCurrent = extractLSFFeatures(observation, { comparison }, phase);
          const records = brainV2.mne.lsfForecasts[simMatchId] || [];
          const pending = records.find((r)=>r.forecastForPhase===phase && !r.evaluatedAt);
          let lsfResult = null;
          if(pending){
            lsfResult = applyLsfLearning({ brainV2, matchId: simMatchId, madeAtPhase: pending.madeAtPhase, forecastRecord: pending, observedFeatures: featuresCurrent, evidenceCount: observation?.observed?.evidence?.events || 0 });
            pending.evaluatedAt = new Date().toISOString();
            pending.evaluation = lsfResult;
          }

          const nextPhase = nextMnePhase(phase);
          const lsfForecast = computeLsfForecast({ lsfState: brainV2.mne.lsfState, features: featuresCurrent, forecastForPhase: nextPhase });
          const liveEventsLite = [];
          Object.entries(observation?.observed?.tags || {}).forEach(([key, n])=>{
            const qty = Math.max(0, Number(n) || 0);
            for(let i=0;i<qty;i+=1) liveEventsLite.push({ type: key, minute: 60 + i, quality: 0.8 });
          });
          const liveState = {
            minute: Number(String(phase || '0-15').split('-')[1]) || 60,
            liveEventsCount: Number(observation?.observed?.evidence?.events || 0),
            shots: Number(observation?.observed?.tags?.shot || 0),
            shotsOT: Number(observation?.observed?.tags?.shot_on_target || 0),
            corners: Number(observation?.observed?.tags?.corner || 0),
            hasGoal: Number(observation?.observed?.tags?.goal || 0) > 0,
            hasRed: Number(observation?.observed?.tags?.red || 0) > 0,
            hasVar: Number(observation?.observed?.tags?.var_review || 0) > 0 || Number(observation?.observed?.tags?.var_overturn || 0) > 0,
            completeness: clamp((Number(observation?.observed?.evidence?.events || 0)) / 10, 0, 1)
          };
          const momentumWindowLive = {
            home: {
              corners: Number(observation?.observed?.teamTags?.home?.corner || 0),
              shots: Number(observation?.observed?.teamTags?.home?.shot || 0),
              shotsOT: Number(observation?.observed?.teamTags?.home?.shot_on_target || 0),
              bigChances: Number(observation?.observed?.teamTags?.home?.big_chance || 0),
              pressureEvents: Number(observation?.observed?.derivedTags?.territorial_pressure || 0) * 4
            },
            away: {
              corners: Number(observation?.observed?.teamTags?.away?.corner || 0),
              shots: Number(observation?.observed?.teamTags?.away?.shot || 0),
              shotsOT: Number(observation?.observed?.teamTags?.away?.shot_on_target || 0),
              bigChances: Number(observation?.observed?.teamTags?.away?.big_chance || 0),
              pressureEvents: Number(observation?.observed?.derivedTags?.counter_strike || 0) * 4
            }
          };
          const learnedStateLive = normalizeOrchestratorLearningState(brainV2.orchestratorLearning);
          const orchestratorLive = orchestrateBrainV2Decision({
            phase,
            matchState: {
              minute: liveState.minute,
              homeGoals: Number(observation?.observed?.teamTags?.home?.goal || 0),
              awayGoals: Number(observation?.observed?.teamTags?.away?.goal || 0),
              tempo: Number(observation?.observed?.evidence?.events || 0) >= 6 ? 'high' : 'medium',
              chaosDetected: Number(comparison?.metrics?.surprise || 0) > 0.5,
              dominanceHome: clamp(Number(observation?.observed?.evidence?.dangerIndexHome || 0) / 3, 0, 1),
              dominanceAway: clamp(Number(observation?.observed?.evidence?.dangerIndexAway || 0) / 3, 0, 1),
              liveEventsCount: liveState.liveEventsCount,
              surpriseIndex: clamp(Number(comparison?.metrics?.surprise || 0), 0, 1)
            },
            learnedBias: learnedStateLive.learnedBias,
            recentWindow: momentumWindowLive,
            recentEvents: liveEventsLite,
            liveState,
            lsfForecast
          });
          const rec = {
            matchId: simMatchId,
            madeAtPhase: phase,
            madeAtTs: new Date().toISOString(),
            forecastForPhase: nextPhase,
            probs: lsfForecast.probs,
            nextScenario: lsfForecast.nextScenario,
            confidence: lsfForecast.confidence,
            switchRisk: lsfForecast.switchRisk,
            drivers: lsfForecast.drivers,
            ifThen: lsfForecast.ifThen,
            featuresSnapshot: featuresCurrent,
            orchestrator: orchestratorLive
          };
          const recIdx = records.findIndex((r)=>r.madeAtPhase===phase);
          if(recIdx>=0) records[recIdx] = { ...records[recIdx], ...rec };
          else records.push(rec);
          brainV2.mne.lsfForecasts[simMatchId] = records;

          const maxRel = Math.max(lsfForecast.probs.base, lsfForecast.probs.trigger, lsfForecast.probs.chaos);
          const beta = clamp(0.15 + 0.2 * maxRel, 0.15, 0.35);
          if(prediction?.predicted?.sceneId){
            const prev = Number(brainV2.mne.sceneWeights?.[homeIdSel]?.[prediction.predicted.sceneId]) || 0;
            const mixed = (1-beta) * prev + beta * (lsfForecast.probs.base - lsfForecast.probs.chaos);
            brainV2.mne.sceneWeights[homeIdSel] ||= {};
            brainV2.mne.sceneWeights[homeIdSel][prediction.predicted.sceneId] = Number(clamp(mixed, -2, 2).toFixed(3));
          }
          const triggerMap = [
            { feat: 'cornersSurgeHome', id: 'setpiece_threat_boost' },
            { feat: 'cornersSurgeAway', id: 'setpiece_threat_boost' },
            { feat: 'varShock', id: 'turning_point_var' }
          ];
          triggerMap.forEach((row)=>{
            const f = Number(featuresCurrent[row.feat]) || 0;
            if(f<=0) return;
            const prev = Number(brainV2.mne.triggerWeights[row.id]) || 0;
            brainV2.mne.triggerWeights[row.id] = Number(clamp(prev + 0.02 * f, -2, 2).toFixed(3));
          });

          const predictedOutcome = orchestratorLive.finalDecision.probs.home >= orchestratorLive.finalDecision.probs.draw && orchestratorLive.finalDecision.probs.home >= orchestratorLive.finalDecision.probs.away
            ? 'home'
            : orchestratorLive.finalDecision.probs.away >= orchestratorLive.finalDecision.probs.draw ? 'away' : 'draw';
          const actualOutcome = Number(observation?.observed?.teamTags?.home?.goal || 0) === Number(observation?.observed?.teamTags?.away?.goal || 0)
            ? 'draw'
            : Number(observation?.observed?.teamTags?.home?.goal || 0) > Number(observation?.observed?.teamTags?.away?.goal || 0) ? 'home' : 'away';
          brainV2.orchestratorLearning = updateOrchestratorLearning({
            state: brainV2.orchestratorLearning,
            result: {
              predictedOutcome,
              actualOutcome,
              confidence: orchestratorLive.finalDecision.confidence,
              topEngines: Object.entries(orchestratorLive.finalWeights).map(([engine, contribution])=>({ engine, contribution }))
            }
          });
          brainV2.mne = observeLearningAuditsForMatch(brainV2.mne, {
            matchId: simMatchId,
            observedMatch: {
              matchId: simMatchId,
              observedAt: new Date().toISOString(),
              phase,
              narrative: raw,
              sceneId: prediction?.predicted?.sceneId || null,
              triggerIds: (vision?.mne?.liveTriggers || []).map((row)=>`${row.sceneId || ''}:${row.if || ''}`),
              derivedTags: observation?.observed?.derivedTags || {},
              evidenceEvents: Number(observation?.observed?.evidence?.events || 0),
              comparisonMetrics: comparison?.metrics || {}
            }
          });
          saveBrainV2(brainV2);
          if(statusEl){
            const lsfTxt = lsfResult && !lsfResult.skipped ? ` · LSF eval ${lsfResult.truth} · brier ${Number(lsfResult.brier||0).toFixed(3)}` : '';
            statusEl.textContent = learning.skipped === 'low_evidence' ? '⚠️ Evidencia insuficiente (<3 eventos), sin ajuste.' : `✅ Comparado. Prec ${(comparison.metrics.precision*100).toFixed(0)}% · Δcal ${comparison.metrics.calibrationError.toFixed(2)}${lsfTxt}.`;
          }
          renderLfl();
          renderLearningAuditSummary();
        });

        document.getElementById('mneLsfLearnedBtn')?.addEventListener('click', ()=>{
          const status = document.getElementById('mneLsfLearnStatus');
          const lsfState = normalizeLsfState(brainV2.mne.lsfState);
          const topByScenario = (scenario)=>Object.entries(lsfState.weights?.[scenario] || {}).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,5);
          const hist = (brainV2.mne.lsfEvalHistory || []).filter((row)=>row.matchId===simMatchId);
          const topWrong = hist.filter((row)=>row.predicted!==row.truth).slice(-20);
          const modal = document.createElement('div');
          modal.className = 'fl-modal-backdrop';
          modal.innerHTML = `<div class="fl-modal" style="max-width:820px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><div><div class="fl-modal-title">What LSF learned</div><div class="fl-mini">Pesos actuales, mejoras y disparadores problemáticos.</div></div><button class="fl-btn" id="closeLsfModal">Cerrar</button></div>
            <div class="fl-mini" style="margin-top:8px;display:grid;gap:6px;">
              <div><b>base</b>: ${topByScenario('base').map(([k,v])=>`${k} ${v>=0?'+':''}${Number(v).toFixed(2)}`).join(' · ')}</div>
              <div><b>trigger</b>: ${topByScenario('trigger').map(([k,v])=>`${k} ${v>=0?'+':''}${Number(v).toFixed(2)}`).join(' · ')}</div>
              <div><b>chaos</b>: ${topByScenario('chaos').map(([k,v])=>`${k} ${v>=0?'+':''}${Number(v).toFixed(2)}`).join(' · ')}</div>
              <div><b>Most improved this week</b>: ${hist.slice(-15).filter((r)=>r.updatesCount>0).slice(-5).map((r)=>`${r.phase}→${r.truth} (Δw ${r.updatesCount})`).join(' | ') || 'sin cambios'}</div>
              <div><b>Most wrong triggers</b>: ${topWrong.slice(-5).map((r)=>`${r.phase}: pred ${r.predicted} / truth ${r.truth} (brier ${Number(r.brier).toFixed(3)})`).join(' | ') || 'sin errores recientes'}</div>
            </div>
          </div>`;
          document.body.appendChild(modal);
          modal.querySelector('#closeLsfModal')?.addEventListener('click', ()=>modal.remove());
          modal.addEventListener('click', (evt)=>{ if(evt.target===modal) modal.remove(); });
          if(status) status.textContent = `Mostrando ${hist.length} evaluaciones LSF.`;
        });
      });
      return;
    }


    if(view==="momentum"){
      const teamOptions = db.teams.map(t=>`<option value="${t.name}">${t.name}</option>`).join("");
      content.innerHTML = `
        <div class="fl-card">
          <div style="font-weight:900;font-size:20px;">📊 Momentum Lab</div>
          <div class="fl-mini">Motor de velas, patrones y firma histórica por relato.</div>
        </div>
        <div class="fl-card fl-grid two">
          <div>
            <div class="fl-mini">Equipo A</div>
            <select id="momTeamA" class="fl-select" style="width:100%;margin-top:4px;">${teamOptions}</select>
          </div>
          <div>
            <div class="fl-mini">Equipo B</div>
            <select id="momTeamB" class="fl-select" style="width:100%;margin-top:4px;">${teamOptions}</select>
          </div>
        </div>
        <div class="fl-card">
          <textarea id="momNarrative" class="fl-text" placeholder="Pega el relato crudo aquí"></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="momConvert">Convertir</button>
            <button class="fl-btn" id="momGenerateDiag" disabled>Generar diagnóstico</button>
            <button class="fl-btn" id="momSaveProfile" disabled>Guardar al perfil</button>
            <span id="momStatus" class="fl-mini"></span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Velas IDD (equipo A)</div>
          <svg id="momCandleSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">IDD acumulado</div>
          <svg id="momLineSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Patrones detectados</div>
          <div id="momPatterns" class="fl-mini">Sin análisis todavía.</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Resumen de firma</div>
          <pre id="momSignature" class="fl-mini" style="white-space:pre-wrap"></pre>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Diagnóstico automático</div>
          <pre id="momDiagJson" class="fl-mini" style="white-space:pre-wrap;margin-bottom:8px;">Genera un diagnóstico para ver métricas y etiquetas.</pre>
          <div id="momDiagSections" class="fl-mini">
            <div><b>Resumen:</b> -</div>
            <div><b>Quiebre:</b> -</div>
            <div><b>Volatilidad:</b> -</div>
            <div><b>Cierre:</b> -</div>
            <div><b>Patrón:</b> -</div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">⚽ Early Phase Analyzer (EPA)</div>
          <div class="fl-grid two" style="margin-bottom:8px;">
            <div class="fl-mini">Modo acumulativo: cada nuevo texto se mezcla con lo ya cargado para ver la evolución completa del partido.</div>
            <div class="fl-mini" style="display:flex;align-items:flex-end;">Función secundaria: no reemplaza el análisis de momentum actual.</div>
          </div>
          <textarea id="epaNarrative" class="fl-text" placeholder="Pega más relato (minuto a minuto). Se acumula automáticamente."></textarea>
          <textarea id="epaStatsInput" class="fl-text" style="margin-top:8px;" placeholder='(Opcional) Pega JSON de estadísticas: {"kind":"match_stats", ...}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="epaAnalyze">Actualizar EPA</button>
            <button class="fl-btn" id="epaInjectStats">Inyectar stats al EPA</button>
            <button class="fl-btn" id="epaReset">Reiniciar EPA</button>
            <button class="fl-btn" id="epaSaveProfile" disabled>Guardar firma temprana al equipo</button>
            <span id="epaStatus" class="fl-mini"></span>
          </div>
          <div class="fl-card" style="margin-top:10px;">
            <div style="font-weight:700;margin-bottom:8px;">Movimiento psicológico EMA sobre velas de intensidad</div>
            <svg id="epaPsychSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
          </div>
          <div id="epaCards" class="fl-grid two" style="margin-top:10px;gap:10px;"></div>
          <pre id="epaJson" class="fl-mini" style="white-space:pre-wrap;margin-top:10px;">Sin análisis EPA.</pre>
          <ul id="epaText" class="fl-mini" style="margin:8px 0 0 18px;"></ul>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">📈 Live Projection Engine (LPE)</div>
          <div class="fl-mini" style="margin-bottom:8px;">Acumulativo por <code>matchId</code>: acepta JSON LPE directo o <code>kind: "match_stats"</code> (Flashscore/Sofascore) y lo normaliza.</div>
          <textarea id="lpeInput" class="fl-text" placeholder='Pega JSON de ventana {"matchId":"...","teams":...,"stats":...,"score":...} o {"kind":"match_stats","sections":[...]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="lpeUpdate">Actualizar LPE</button>
            <button class="fl-btn" id="lpeReset">Reiniciar partido</button>
            <span id="lpeStatus" class="fl-mini"></span>
          </div>
          <div id="lpeSummary" class="fl-mini" style="margin-top:8px;">Sin estado LPE.</div>
          <div class="fl-card" style="margin-top:10px;">
            <div style="font-weight:700;margin-bottom:8px;">Tendencia acumulativa + proyección (IDD/EPI)</div>
            <svg id="lpeProjectionSvg" viewBox="0 0 700 230" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
          </div>
          <div id="lpeAlerts" class="fl-mini" style="margin-top:8px;"></div>
          <pre id="lpeJson" class="fl-mini" style="white-space:pre-wrap;margin-top:10px;">{}</pre>
        </div>
      `;

      let lastPayload = null;
      let lastEPA = null;
      let lastLPE = null;
      const drawCandleChart = (candles=[])=>{
        const svg = document.getElementById("momCandleSvg");
        if(!svg) return;
        const width = 700;
        const height = 220;
        const zeroY = height/2;
        const scaleY = 85;
        const barW = 40;
        const gap = 20;
        const bodyW = 18;
        const axis = `<line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>`;
        const bars = candles.map((c, i)=>{
          const x = 25 + i*(barW+gap);
          const yOpen = zeroY - c.open*scaleY;
          const yClose = zeroY - c.close*scaleY;
          const yHigh = zeroY - c.high*scaleY;
          const yLow = zeroY - c.low*scaleY;
          const color = c.close >= c.open ? "#2ea043" : "#f85149";
          const bodyY = Math.min(yOpen, yClose);
          const bodyH = Math.max(2, Math.abs(yOpen-yClose));
          return `<g>
            <line x1="${x+barW/2}" y1="${yHigh}" x2="${x+barW/2}" y2="${yLow}" stroke="${color}" stroke-width="2"/>
            <rect x="${x + (barW-bodyW)/2}" y="${bodyY}" width="${bodyW}" height="${bodyH}" fill="${color}"/>
            <text x="${x+barW/2}" y="208" fill="#9ca3af" font-size="10" text-anchor="middle">${c.block===9?"90+":`${c.block*10}`}</text>
          </g>`;
        }).join("");
        svg.innerHTML = axis + bars;
      };

      const drawIddLine = (blocks=[], team)=>{
        const svg = document.getElementById("momLineSvg");
        if(!svg) return;
        const width = 700;
        const height = 220;
        const zeroY = height/2;
        const accum = cumulativeSum(blocks.map(b=>Number(b.idd?.[team]) || 0));
        const pts = accum.map((value, idx)=>{
          const x = 20 + idx * ((width - 40) / 9);
          const y = zeroY - value * 40;
          return `${x},${y}`;
        }).join(" ");
        svg.innerHTML = `
          <line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>
          <polyline points="${pts}" fill="none" stroke="#58a6ff" stroke-width="3"/>
        `;
      };

      const renderMomentumDiagnostic = (diagnostic)=>{
        if(!diagnostic) return;
        const diagJson = document.getElementById("momDiagJson");
        const diagSections = document.getElementById("momDiagSections");
        if(diagJson) diagJson.textContent = JSON.stringify({
          metrics: diagnostic.metrics,
          tags: diagnostic.tags,
          diagnosticText: diagnostic.diagnosticText
        }, null, 2);
        const summary = diagnostic.diagnosticText[0] || "-";
        const breakLine = diagnostic.diagnosticText.find(line=>line.startsWith("Quiebre principal:")) || "-";
        const volLine = diagnostic.diagnosticText.find(line=>line.startsWith("Volatilidad:")) || "-";
        const closeLine = diagnostic.diagnosticText.find(line=>line.startsWith("Final:")) || "-";
        const patternLine = diagnostic.diagnosticText.find(line=>line.startsWith("Patrón:")) || "Patrón: sin clasificación dominante.";
        if(diagSections){
          diagSections.innerHTML = `
            <div><b>Resumen:</b> ${summary}</div>
            <div><b>Quiebre:</b> ${breakLine}</div>
            <div><b>Volatilidad:</b> ${volLine}</div>
            <div><b>Cierre:</b> ${closeLine}</div>
            <div><b>Patrón:</b> ${patternLine}</div>
          `;
        }
      };

      const renderEPA = (epa)=>{
        const cards = document.getElementById("epaCards");
        const textList = document.getElementById("epaText");
        const jsonOut = document.getElementById("epaJson");
        const psychSvg = document.getElementById("epaPsychSvg");
        if(!epa || !cards || !textList || !jsonOut) return;
        const [teamA, teamB] = epa.teams;
        const iddA = Number(epa.features?.idd?.[teamA] || 0);
        const threatA = Number(epa.features?.threat?.[teamA] || 0);
        const threatB = Number(epa.features?.threat?.[teamB] || 0);
        const shockA = Number(epa.features?.shockRisk?.[teamA] || 0);
        const shockB = Number(epa.features?.shockRisk?.[teamB] || 0);
        const psychA = epa.psych?.[teamA] || {};
        const psychB = epa.psych?.[teamB] || {};
        const live = epa.liveProbabilities || {};
        const pHome = Number(live.pHome || 0);
        const pDraw = Number(live.pDraw || 0);
        const pAway = Number(live.pAway || 0);
        const whyItems = Array.isArray(live.reasons) ? live.reasons : [];
        cards.innerHTML = `
          <div style="grid-column:1/-1;background:#0f172a;border:1px solid #24324a;border-radius:10px;padding:10px;">
            <div style="font-weight:800;margin-bottom:4px;">PROBABILIDAD DE VICTORIA EN VIVO</div>
            <div class="fl-mini" style="margin-bottom:6px;">${live.label || "Sin datos de probabilidad live."}</div>
            <div style="height:10px;background:#d9d9d9;border-radius:999px;overflow:hidden;display:flex;">
              <div style="width:${(pHome*100).toFixed(2)}%;background:#7a7a7a"></div>
              <div style="width:${(pDraw*100).toFixed(2)}%;background:#cfcfcf"></div>
              <div style="width:${(pAway*100).toFixed(2)}%;background:#1f6feb"></div>
            </div>
            <div class="fl-mini" style="display:flex;justify-content:space-between;margin-top:6px;">
              <span>${teamA} ${(pHome*100).toFixed(0)}%</span>
              <span>Empate ${(pDraw*100).toFixed(0)}%</span>
              <span>${teamB} ${(pAway*100).toFixed(0)}%</span>
            </div>
            <div class="fl-mini" style="margin-top:8px;">${live.explanation || "Sin explicación contextual."}</div>
            <button class="fl-btn" id="epaWhyToggle" style="margin-top:8px;">Ver por qué</button>
            <ul id="epaWhyList" class="fl-mini" style="display:none;margin:8px 0 0 18px;">${whyItems.map(item=>`<li>${item}</li>`).join("")}</ul>
          </div>
          <div><b>IDD early</b><div class="fl-mini">${teamA}: ${iddA.toFixed(2)} · ${teamB}: ${(-iddA).toFixed(2)}</div></div>
          <div><b>Intensidad</b><div class="fl-mini">${(Number(epa.features?.intensity||0)*100).toFixed(0)}%</div></div>
          <div><b>Threat</b><div class="fl-mini">${teamA}: ${(threatA*100).toFixed(0)}% · ${teamB}: ${(threatB*100).toFixed(0)}%</div></div>
          <div><b>Shock risk</b><div class="fl-mini">${teamA}: ${(shockA*100).toFixed(0)}% · ${teamB}: ${(shockB*100).toFixed(0)}%</div></div>
          <div><b>Psych (${teamA})</b><div class="fl-mini">Cnf ${(Number(psychA.confidence||0)*100).toFixed(0)} · Comp ${(Number(psychA.composure||0)*100).toFixed(0)} · Fr ${(Number(psychA.frustration||0)*100).toFixed(0)}</div></div>
          <div><b>Psych (${teamB})</b><div class="fl-mini">Cnf ${(Number(psychB.confidence||0)*100).toFixed(0)} · Comp ${(Number(psychB.composure||0)*100).toFixed(0)} · Fr ${(Number(psychB.frustration||0)*100).toFixed(0)}</div></div>
        `;
        const whyToggle = document.getElementById("epaWhyToggle");
        const whyList = document.getElementById("epaWhyList");
        if(whyToggle && whyList){
          whyToggle.onclick = ()=>{
            const open = whyList.style.display !== "none";
            whyList.style.display = open ? "none" : "block";
            whyToggle.textContent = open ? "Ver por qué" : "Ocultar detalle";
          };
        }
        const psychText = [
          ...(epa.text || []),
          `${teamA}: ${(epa.psychText?.[teamA] || []).join(" · ")}`,
          `${teamB}: ${(epa.psychText?.[teamB] || []).join(" · ")}`
        ];
        textList.innerHTML = psychText.map(line=>`<li>${line}</li>`).join("");
        if(psychSvg){
          const buckets = epa.psychChart?.buckets || [];
          const width = 700;
          const height = 220;
          const zeroY = 170;
          const maxMove = Math.max(1, ...buckets.map(b=>Math.max(Number(b.ema?.[teamA]||0), Number(b.ema?.[teamB]||0))));
          const xAt = (idx)=>20 + idx*((width-40)/Math.max(1, buckets.length-1));
          const yMove = (v)=>170 - (Number(v)||0)*(90/maxMove);
          const intensityBars = buckets.map((b, idx)=>{
            const x = xAt(idx) - 18;
            const h = (Number(b.intensity)||0)*80;
            const y = zeroY - h;
            return `<g><rect x="${x}" y="${y}" width="36" height="${h}" fill="rgba(88,166,255,.25)" stroke="rgba(88,166,255,.45)"/><text x="${xAt(idx)}" y="205" fill="#9ca3af" font-size="10" text-anchor="middle">${b.label}</text></g>`;
          }).join("");
          const poly = (team, color)=>buckets.map((b, idx)=>`${xAt(idx)},${yMove(b.ema?.[team]||0)}`).join(" ");
          psychSvg.innerHTML = `
            <line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>
            ${intensityBars}
            <polyline points="${poly(teamA, "#2ea043")}" fill="none" stroke="#2ea043" stroke-width="3"/>
            <polyline points="${poly(teamB, "#f85149")}" fill="none" stroke="#f85149" stroke-width="3"/>
            <text x="24" y="16" fill="#2ea043" font-size="11">EMA ${teamA}</text>
            <text x="130" y="16" fill="#f85149" font-size="11">EMA ${teamB}</text>
          `;
        }
        jsonOut.textContent = JSON.stringify(epa, null, 2);
      };

      const buildEpaAccumKey = (teamA, teamB)=>{
        const parts = [String(teamA || "").trim(), String(teamB || "").trim()]
          .filter(Boolean)
          .map(normalizeTeamToken)
          .sort();
        return `match_epa_accum_${parts.join("__")}`;
      };

      const mergeEarlyEvents = (baseEvents=[], incomingEvents=[])=>{
        const map = new Map();
        [...(Array.isArray(baseEvents) ? baseEvents : []), ...(Array.isArray(incomingEvents) ? incomingEvents : [])].forEach(evt=>{
          if(!evt) return;
          const k = `${Number(evt.minute) || 0}|${String(evt.team || "").trim().toLowerCase()}|${String(evt.type || "").trim().toLowerCase()}|${String(evt.text || "").trim().toLowerCase()}`;
          if(!map.has(k)) map.set(k, evt);
        });
        return [...map.values()].sort((a,b)=> (Number(a.minute)||0) - (Number(b.minute)||0));
      };

      const resolveAccumWindowKey = (events=[])=>{
        const maxMinute = Math.max(10, ...events.map(evt=>Number(evt?.minute) || 0));
        return `0-${Math.ceil(maxMinute)}`;
      };

      const resolveEpaPsychForLpe = (epa, lpeTeams={})=>{
        if(!epa?.teams?.length || !epa?.psych) return null;
        const [epaHome, epaAway] = epa.teams;
        const psych = epa.psych || {};
        const norm = (v)=>normalizeTeamToken(v || "");
        const directHome = psych[lpeTeams?.home] || psych[Object.keys(psych).find(k=>norm(k)===norm(lpeTeams?.home))];
        const directAway = psych[lpeTeams?.away] || psych[Object.keys(psych).find(k=>norm(k)===norm(lpeTeams?.away))];
        return {
          home: directHome || psych[epaHome] || null,
          away: directAway || psych[epaAway] || null
        };
      };

      const buildStatsStateForEpa = (normalized={}, teamA="", teamB="", fallbackState={})=>{
        const fallbackScore = fallbackState || {};
        const stats = normalized?.stats || {};
        const score = normalized?.score || {};
        const mapStats = (side)=>({
          ...createEarlyTeamStats(),
          shots: Number(stats?.[side]?.shots || 0),
          shotsOnTarget: Number(stats?.[side]?.shotsOn || 0),
          bigChances: Number(stats?.[side]?.bigChances || 0),
          corners: Number(stats?.[side]?.corners || 0),
          dangerActions: Number(stats?.[side]?.dangerAttacks || 0),
          fouls: Number(stats?.[side]?.fouls || 0),
          cards: Number(stats?.[side]?.yellows || 0)
        });
        const homeStats = mapStats("home");
        const awayStats = mapStats("away");
        return {
          minute: Number(normalized?.minute || String(normalized?.window || "").split("-").slice(-1)[0] || fallbackScore.minute || 55),
          scoreHome: Number(score.home ?? fallbackScore.scoreHome ?? 0),
          scoreAway: Number(score.away ?? fallbackScore.scoreAway ?? 0),
          statsCumulative: {
            [teamA]: homeStats,
            [teamB]: awayStats
          },
          statsSegment: {
            [teamA]: homeStats,
            [teamB]: awayStats
          }
        };
      };

      document.getElementById("epaAnalyze").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const status = document.getElementById("epaStatus");
        const narrativeEl = document.getElementById("epaNarrative");
        const raw = (narrativeEl?.value || document.getElementById("momNarrative").value || "").trim();
        if(!teamA || !teamB || teamA===teamB){
          status.textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        if(!raw){
          status.textContent = "⚠️ Pega texto para actualizar EPA.";
          return;
        }
        const seedProfiles = {
          [teamA]: JSON.parse(localStorage.getItem(`team_profile_${teamA}`) || "null") || {},
          [teamB]: JSON.parse(localStorage.getItem(`team_profile_${teamB}`) || "null") || {}
        };
        const accumKey = buildEpaAccumKey(teamA, teamB);
        const previousAccum = safeParseJson(localStorage.getItem(accumKey) || "null") || {};
        const incoming = parseEarlyNarrative(raw, { teamA, teamB, windowKey: "0-200" });
        const mergedEvents = mergeEarlyEvents(previousAccum.events, incoming.events || []);
        const windowKey = resolveAccumWindowKey(mergedEvents);
        const epa = computeEarlyPhaseAnalyzer("", { teamA, teamB, windowKey, seedProfiles, eventsOverride: mergedEvents });
        const snapshot = {
          teamA,
          teamB,
          windowKey,
          events: mergedEvents,
          updatedAt: new Date().toISOString()
        };
        localStorage.setItem(accumKey, JSON.stringify(snapshot));
        renderEPA(epa);
        lastEPA = epa;
        if(narrativeEl) narrativeEl.value = "";
        document.getElementById("epaSaveProfile").disabled = false;
        status.textContent = `✅ EPA acumulado ${epa.window} (${mergedEvents.length} eventos).`;
      };

      document.getElementById("epaInjectStats").onclick = ()=>{
        const status = document.getElementById("epaStatus");
        const rawStats = (document.getElementById("epaStatsInput")?.value || "").trim();
        if(!lastEPA){
          status.textContent = "⚠️ Primero ejecuta EPA con relato para tener base.";
          return;
        }
        if(!rawStats){
          status.textContent = "⚠️ Pega un JSON de estadísticas para inyectar.";
          return;
        }
        const parsedRaw = safeParseJson(rawStats);
        if(!parsedRaw){
          status.textContent = "❌ JSON de estadísticas inválido.";
          return;
        }
        const normalized = normalizeIncomingLpePayload(parsedRaw);
        if(!normalized?.stats?.home || !normalized?.stats?.away){
          status.textContent = "❌ No se pudieron mapear estadísticas de home/away.";
          return;
        }
        const [teamA, teamB] = lastEPA.teams || [];
        const statsState = buildStatsStateForEpa(normalized, teamA, teamB, lastEPA.liveState || {});
        const baseProb = lastEPA.liveProbabilities || {};
        const statsProb = computeLiveOutcomeProbabilities(statsState, teamA, teamB);
        const blend = (a,b,w=0.62)=>((Number(a)||0)*(1-w))+((Number(b)||0)*w);
        const blended = {
          ...statsProb,
          pHome: blend(baseProb.pHome, statsProb.pHome),
          pDraw: blend(baseProb.pDraw, statsProb.pDraw),
          pAway: blend(baseProb.pAway, statsProb.pAway)
        };
        const total = blended.pHome + blended.pDraw + blended.pAway || 1;
        blended.pHome /= total;
        blended.pDraw /= total;
        blended.pAway /= total;
        blended.label = `Ahora mismo: ${teamA} ${(blended.pHome*100).toFixed(0)}% | Empate ${(blended.pDraw*100).toFixed(0)}% | ${teamB} ${(blended.pAway*100).toFixed(0)}%`;
        const reasons = ["Probabilidades recalibradas con estadísticas inyectadas.", ...(statsProb.reasons || [])];
        blended.reasons = [...new Set(reasons)].slice(0, 5);
        blended.explanation = blended.reasons[0] || statsProb.explanation || baseProb.explanation;

        lastEPA.liveProbabilities = blended;
        lastEPA.statsInjection = {
          source: normalized?.source || parsedRaw?.source || "manual",
          window: normalized?.window || "live",
          capturedAt: parsedRaw?.capturedAt || null,
          stats: normalized.stats
        };
        renderEPA(lastEPA);
        status.textContent = "✅ Stats inyectadas: probabilidad live recalibrada.";
      };

      document.getElementById("epaReset").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const status = document.getElementById("epaStatus");
        if(!teamA || !teamB || teamA===teamB){
          status.textContent = "⚠️ Selecciona dos equipos para reiniciar EPA.";
          return;
        }
        localStorage.removeItem(buildEpaAccumKey(teamA, teamB));
        lastEPA = null;
        const cards = document.getElementById("epaCards");
        const textList = document.getElementById("epaText");
        const jsonOut = document.getElementById("epaJson");
        const psychSvg = document.getElementById("epaPsychSvg");
        if(cards) cards.innerHTML = "";
        if(textList) textList.innerHTML = "";
        if(jsonOut) jsonOut.textContent = "Sin análisis EPA.";
        if(psychSvg) psychSvg.innerHTML = "";
        document.getElementById("epaSaveProfile").disabled = true;
        status.textContent = "✅ EPA reiniciado para este partido.";
      };

      document.getElementById("epaSaveProfile").onclick = ()=>{
        if(!lastEPA?.signatureUpdate) return;
        const [teamA, teamB] = lastEPA.teams;
        [teamA, teamB].forEach(teamName=>{
          const current = JSON.parse(localStorage.getItem(`team_profile_${teamName}`) || "null");
          const updated = updateTeamEarlyProfile(current, teamName, lastEPA.signatureUpdate[teamName] || {});
          localStorage.setItem(`team_profile_${teamName}`, JSON.stringify(updated));
        });
        document.getElementById("epaStatus").textContent = "✅ Firma temprana guardada para ambos equipos.";
      };

      const drawLpeProjectionChart = (history=[])=>{
        const svg = document.getElementById("lpeProjectionSvg");
        if(!svg) return;
        const width = 700;
        const height = 230;
        const pad = { top: 18, right: 16, bottom: 26, left: 38 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const yFromNorm = (v)=> pad.top + (1 - clamp((Number(v) || 0), 0, 1)) * plotH;
        const yFromSigned = (v)=> pad.top + (1 - (clamp((Number(v) || 0), -1, 1) + 1)/2) * plotH;

        const real = Array.isArray(history) ? history : [];
        const realPoints = real.slice(-12);
        const projectionCount = 3;
        const projected = [];

        const linearProjection = (arr, key)=>{
          const series = arr.map((item, idx)=>({ x: idx + 1, y: Number(item?.[key]) || 0 }));
          if(!series.length) return Array.from({ length: projectionCount }, ()=>0);
          if(series.length===1) return Array.from({ length: projectionCount }, ()=>series[0].y);
          const meanX = series.reduce((acc, p)=>acc+p.x, 0) / series.length;
          const meanY = series.reduce((acc, p)=>acc+p.y, 0) / series.length;
          const num = series.reduce((acc, p)=>acc + (p.x - meanX)*(p.y - meanY), 0);
          const den = series.reduce((acc, p)=>acc + (p.x - meanX)*(p.x - meanX), 0) || 1;
          const slope = num/den;
          const intercept = meanY - slope*meanX;
          return Array.from({ length: projectionCount }, (_v, i)=> intercept + slope*(series.length + i + 1));
        };

        const iddProjected = linearProjection(realPoints, "iddAway").map(v=>clamp(v, -1, 1));
        const epiProjected = linearProjection(realPoints, "epi").map(v=>clamp(v, 0, 1));
        for(let i=0;i<projectionCount;i+=1){
          projected.push({
            idx: realPoints.length + i,
            iddAway: iddProjected[i],
            epi: epiProjected[i]
          });
        }

        const all = [...realPoints, ...projected];
        if(!all.length){
          svg.innerHTML = `<text x="24" y="42" fill="#8b949e" font-size="12">Carga al menos una ventana LPE para visualizar tendencia y proyección.</text>`;
          return;
        }

        const maxIndex = Math.max(all.length - 1, 1);
        const xPos = (idx)=> pad.left + (idx / maxIndex) * plotW;
        const linePath = (arr, key, yMapper)=> arr.map((p, idx)=>`${idx===0?"M":"L"}${xPos(idx)} ${yMapper(p[key])}`).join(" ");
        const realPathIdd = linePath(realPoints, "iddAway", yFromSigned);
        const projPathIdd = linePath([...realPoints.slice(-1), ...projected], "iddAway", yFromSigned);
        const realPathEpi = linePath(realPoints, "epi", yFromNorm);
        const projPathEpi = linePath([...realPoints.slice(-1), ...projected], "epi", yFromNorm);
        const splitX = xPos(Math.max(realPoints.length - 1, 0));

        svg.innerHTML = `
          <line x1="${pad.left}" y1="${yFromSigned(0)}" x2="${width-pad.right}" y2="${yFromSigned(0)}" stroke="#39414d" stroke-width="1"/>
          <line x1="${splitX}" y1="${pad.top}" x2="${splitX}" y2="${height-pad.bottom}" stroke="#30363d" stroke-width="1" stroke-dasharray="4 4"/>
          <text x="${splitX + 6}" y="${pad.top + 14}" fill="#8b949e" font-size="11">proyección</text>
          <path d="${realPathIdd}" fill="none" stroke="#58a6ff" stroke-width="2.5"/>
          <path d="${projPathIdd}" fill="none" stroke="#58a6ff" stroke-width="2" stroke-dasharray="6 5"/>
          <path d="${realPathEpi}" fill="none" stroke="#2ea043" stroke-width="2"/>
          <path d="${projPathEpi}" fill="none" stroke="#2ea043" stroke-width="1.8" stroke-dasharray="5 5"/>
          <text x="${pad.left}" y="${height-8}" fill="#58a6ff" font-size="11">IDD away (azul)</text>
          <text x="${pad.left + 140}" y="${height-8}" fill="#2ea043" font-size="11">EPI (verde)</text>
        `;
      };

      const renderLPE = (state)=>{
        const summary = document.getElementById("lpeSummary");
        const alertsEl = document.getElementById("lpeAlerts");
        const jsonEl = document.getElementById("lpeJson");
        if(!summary || !alertsEl || !jsonEl) return;
        if(!state){
          summary.textContent = "Sin estado LPE.";
          alertsEl.innerHTML = "";
          jsonEl.textContent = "{}";
          drawLpeProjectionChart([]);
          return;
        }
        const teams = state.teams || { home: "home", away: "away" };
        const p = state.projections || {};
        summary.innerHTML = `
          <div><b>${teams.home}</b> vs <b>${teams.away}</b> · ventana ${state.lastWindow || "live"} · iteración ${state.k}</div>
          <div>IDD next: <b>${Number(p.iddNext || 0).toFixed(2)}</b> · Dominio probable: <b>${p.dominance || "-"}</b></div>
          <div>Shock risk: <b>${p.shockRisk || "-"}</b> · EPI: <b>${(Number(p.eventTension || 0)*100).toFixed(0)}%</b></div>
        `;
        const recentAlerts = (state.alerts || []).slice(-6).reverse();
        alertsEl.innerHTML = recentAlerts.length
          ? recentAlerts.map(a=>`<span style="display:inline-block;padding:4px 8px;border:1px solid #2d333b;border-radius:999px;margin:0 6px 6px 0;">${a.type}${a.team?` · ${a.team}`:""}${a.level?` · ${Math.round(a.level*100)}%`:""}</span>`).join("")
          : "Sin alertas todavía.";
        drawLpeProjectionChart(state.history || []);
        jsonEl.textContent = JSON.stringify(state, null, 2);
      };

      document.getElementById("lpeUpdate").onclick = ()=>{
        const status = document.getElementById("lpeStatus");
        const raw = document.getElementById("lpeInput").value || "";
        const parsedRaw = safeParseJson(raw);
        const parsed = parsedRaw ? normalizeIncomingLpePayload(parsedRaw) : null;
        if(!parsed){
          status.textContent = "❌ JSON inválido.";
          return;
        }
        const matchId = parsed.matchId || `TMP-${Date.now()}`;
        const lpeKey = `match_lpe_${matchId}`;
        const previous = safeParseJson(localStorage.getItem(lpeKey) || "null") || {};
        const epaPsych = resolveEpaPsychForLpe(lastEPA, parsed.teams);
        const nextState = updateLiveProjectionState(previous, parsed, { epaPsych });
        localStorage.setItem(lpeKey, JSON.stringify(nextState));
        lastLPE = nextState;
        renderLPE(nextState);
        status.textContent = `✅ LPE actualizado (${nextState.k} ventanas)`;
      };

      document.getElementById("lpeReset").onclick = ()=>{
        const status = document.getElementById("lpeStatus");
        const raw = document.getElementById("lpeInput").value || "";
        const parsedRaw = safeParseJson(raw);
        const parsed = parsedRaw ? normalizeIncomingLpePayload(parsedRaw) : null;
        const matchId = parsed?.matchId;
        if(!matchId){
          status.textContent = "⚠️ Para reiniciar, pega un JSON con matchId.";
          return;
        }
        localStorage.removeItem(`match_lpe_${matchId}`);
        lastLPE = null;
        renderLPE(null);
        status.textContent = `✅ Estado LPE reiniciado para ${matchId}.`;
      };

      document.getElementById("momConvert").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const raw = document.getElementById("momNarrative").value;
        if(!teamA || !teamB || teamA===teamB){
          document.getElementById("momStatus").textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        const parsed = parseMatchNarrative(raw, [teamA, teamB]);
        const timeline = buildEventTimeline(parsed.events);
        const blocks = computeMomentumBlocks(timeline, [teamA, teamB]);
        const candles = generateCandles(blocks, teamA);
        const patterns = detectPatterns({ candles, blocks, team: teamA, opponent: teamB });
        const signature = computeMomentumSignature(teamA, blocks, timeline);
        const matchMomentumId = uid("mom");
        const bundle = { matchMomentumId, teams: [teamA, teamB], events: timeline, blocks, candles, patterns, signature, momentumDiagnostic: null, createdAt: new Date().toISOString() };
        localStorage.setItem(`match_events_${matchMomentumId}`, JSON.stringify(timeline));
        localStorage.setItem(`match_momentum_${matchMomentumId}`, JSON.stringify(bundle));
        drawCandleChart(candles);
        drawIddLine(blocks, teamA);
        document.getElementById("momPatterns").innerHTML = patterns.length
          ? patterns.map(p=>`• ${p.type} (bloque ${p.block===9?"90+":p.block})`).join("<br/>")
          : "Sin patrones detectados con las reglas actuales.";
        document.getElementById("momSignature").textContent = JSON.stringify(signature.momentumSignature, null, 2);
        document.getElementById("momStatus").textContent = `✅ ${timeline.length} eventos convertidos`;
        document.getElementById("momSaveProfile").disabled = false;
        document.getElementById("momGenerateDiag").disabled = false;
        document.getElementById("momDiagJson").textContent = "Genera un diagnóstico para ver métricas y etiquetas.";
        lastPayload = bundle;
      };

      document.getElementById("momGenerateDiag").onclick = ()=>{
        if(!lastPayload?.candles?.length){
          document.getElementById("momStatus").textContent = "❌ Convierte un relato primero.";
          return;
        }
        const diagnostic = computeMomentumDiagnostic(lastPayload.candles);
        lastPayload.momentumDiagnostic = diagnostic;
        if(lastPayload.matchMomentumId){
          localStorage.setItem(`match_momentum_${lastPayload.matchMomentumId}`, JSON.stringify(lastPayload));
        }
        renderMomentumDiagnostic(diagnostic);
        document.getElementById("momStatus").textContent = "✅ Diagnóstico generado y guardado.";
      };

      document.getElementById("momSaveProfile").onclick = ()=>{
        if(!lastPayload) return;
        const teamA = lastPayload.teams[0];
        const current = JSON.parse(localStorage.getItem(`team_profile_${teamA}`) || "null");
        const updated = updateTeamProfile(current, { team: teamA, momentumSignature: lastPayload.signature.momentumSignature });
        localStorage.setItem(`team_profile_${teamA}`, JSON.stringify(updated));
        document.getElementById("momStatus").textContent = `✅ Perfil ${teamA} actualizado (${updated.samples} muestras)`;
      };
      return;
    }

    if(view==="bitacora"){
      db.bitacora = ensureBitacoraState(db.bitacora);
      const st = db.bitacora;
      const today = new Date().toISOString().slice(0,10);
      const todayEntries = st.entries.filter(e=>(e.date||"").slice(0,10)===today);
      const todayProfit = todayEntries.reduce((s,e)=>s+(Number(e.profit)||0),0);
      const todayRisk = todayEntries.reduce((s,e)=>s+(Number(e.stake)||0),0);
      const todayState = { result: todayProfit > 0 ? "winning" : (todayProfit < 0 ? "losing" : "flat") };
      if(!st.planStartBank || !st.planStartDate){
        st.planStartBank = st.bank;
        st.planStartDate = today;
      }
      const plan = computeBitacoraPlan(st, todayEntries);
      if(!st.planTargetBank || Math.abs(st.planTargetBank - plan.targetBank) > 0.01){
        st.planTargetBank = plan.targetBank;
      }
      const riskLeft = Math.max(0, (st.bank * st.dailyRiskPct) - todayRisk);
      const dayIndex = Math.max(1, Math.min(plan.targetDays, Number(st.entries.slice(-1)[0]?.planDayIndex) || 1));
      const maxDayBets = Math.max(2, Math.min(3, Number(st.maxBetsPerDay) || 3));
      const allowThirdStep = todayEntries.length < maxDayBets && !plan.streakStop;
      const roadmap = bitacoraRoadmap(plan, dayIndex, st.bank);
      const onTrack = plan.progressPct >= ((dayIndex-1) / Math.max(1, plan.targetDays));

      const pickCandidates = Array.isArray(st.pickCandidates) && st.pickCandidates.length
        ? st.pickCandidates
        : [
          { id: uid("pick"), odds: 1.52, pFinal: 0.69, pMkt: 0.65, pickType: "1X2" },
          { id: uid("pick"), odds: 1.66, pFinal: 0.64, pMkt: 0.6, pickType: "DNB" }
        ];
      st.pickCandidates = pickCandidates;

      const evaluated = pickCandidates
        .map(row=>evaluatePickCandidate({
          odds: Number(row.odds) || 0,
          pFinal: clamp(Number(row.pFinal) || 0, 0.01, 0.99),
          pMkt: Number(row.pMkt),
          pickType: row.pickType || "1X2"
        }, st, plan, todayState));

      const lastRows = st.entries.slice(-Math.max(7, plan.targetDays));
      const startBank = lastRows.length ? (Number(lastRows[0].bankBefore) || (Number(lastRows[0].bankAfter) - Number(lastRows[0].profit||0)) || st.bank) : st.bank;
      const equitySeries = [startBank, ...lastRows.map(e=>Number(e.bankAfter) || 0)];
      const guideSeries = Array.from({ length: equitySeries.length }, (_v, idx)=>startBank + (plan.totalGoal/Math.max(1, plan.targetDays)) * idx);

      const avgP = lastRows.length ? lastRows.reduce((s,e)=>s+(Number(e.probability)||plan.pRequired),0)/lastRows.length : plan.pRequired;
      const avgOdds = lastRows.length ? lastRows.reduce((s,e)=>s+(Number(e.odds)||plan.avgOdds),0)/lastRows.length : plan.avgOdds;
      const avgStake = lastRows.length ? Math.max(st.minUnit, lastRows.reduce((s,e)=>s+(Number(e.stake)||st.minUnit),0)/lastRows.length) : plan.stepStakes[0];
      const projection = projectBankroll({ bank: st.bank, p: avgP, odds: avgOdds, stake: avgStake, steps: plan.targetDays, paths: 850 });

      const chartValues = [...equitySeries, ...guideSeries, ...projection.flatMap(p=>[p.p10,p.p90])];
      const minV = Math.min(...chartValues) - 0.5;
      const maxV = Math.max(...chartValues) + 0.5;
      const equityPath = sparklinePath(equitySeries, 640, 200, minV, maxV);
      const guidePath = sparklinePath(guideSeries, 640, 200, minV, maxV);
      const lowPath = sparklinePath(projection.map(p=>p.p10), 640, 200, minV, maxV);
      const highPath = sparklinePath(projection.map(p=>p.p90), 640, 200, minV, maxV);

      const compactHistory = st.entries.slice().reverse().slice(0,7).map(e=>{
        const tag = Number(e.ev) >= 0.03 ? "edge+" : (Number(e.ev) > 0 ? "ok" : "frío");
        return `
          <tr>
            <td>${(e.date||"").slice(5,10)}</td>
            <td>${e.pickType || "-"}</td>
            <td>${Number(e.odds||0).toFixed(2)}</td>
            <td>${e.result || "-"}</td>
            <td style="color:${Number(e.profit)>=0?"#3fb950":"#ff7b72"}">${Number(e.profit)>=0?"+":""}${Number(e.profit||0).toFixed(2)}</td>
            <td><span class="fl-chip ${tag === "edge+" ? "ok" : (tag === "ok" ? "warn" : "bad")}">${tag}</span></td>
            <td><button class="fl-btn" data-edit-log="${e.id}" style="padding:4px 8px;">Editar</button></td>
          </tr>
        `;
      }).join("");

      const historySeries = st.entries.slice(-20).map((e, idx)=>({
        idx,
        label: (e.date || "").slice(5,10) || `#${idx+1}`,
        bank: Number(e.bankAfter) || 0
      }));
      const historyValues = historySeries.map(p=>p.bank);
      const historyMin = historyValues.length ? Math.min(...historyValues) : 0;
      const historyMax = historyValues.length ? Math.max(...historyValues) : 0;
      const historyPath = historyValues.length ? sparklinePath(historyValues, 640, 180, historyMin - 0.5, historyMax + 0.5) : "";
      const historyMidLabel = historySeries.length ? historySeries[Math.floor((historySeries.length-1)/2)].label : "-";
      const historyFirstLabel = historySeries[0]?.label || "-";
      const historyLastLabel = historySeries[historySeries.length-1]?.label || "-";

      const radarRows = evaluated.map((row, idx)=>`
        <tr>
          <td>${pickCandidates[idx].pickType}</td>
          <td>${row.odds.toFixed(2)}</td>
          <td>${(row.pFinal*100).toFixed(1)}%</td>
          <td>${(row.pMkt*100).toFixed(1)}%</td>
          <td style="color:${row.ev>=0?"#3fb950":"#ff7b72"}">${(row.ev*100).toFixed(1)}%</td>
          <td>${(row.kelly*100).toFixed(1)}%</td>
          <td>S/${row.stake.toFixed(2)}</td>
          <td>${(row.confidence*100).toFixed(0)}%</td>
          <td>${(row.flexibility*100).toFixed(0)}%</td>
          <td title="${row.reason}">${row.label}</td>
        </tr>
      `).join("");

      const roadmapRows = roadmap.map(step=>`
        <tr>
          <td>${step.reached?"✅":"⏳"} ${step.label}</td>
          <td>Día ${step.checkpointDay}</td>
          <td>S/${step.checkpointBank.toFixed(2)}</td>
          <td style="color:${step.gap>=0?"#3fb950":"#ff7b72"}">${step.gap>=0?"+":""}S/${step.gap.toFixed(2)}</td>
          <td>${step.reached?"Cumplido":(step.expectedByNow?"Acelerar":"En ventana")}</td>
        </tr>
      `).join("");

      const progressColor = plan.progressPct >= 1 ? "#3fb950" : (plan.progressPct >= 0.6 ? "#f2cc60" : "#ff7b72");
      const perfLab = buildBitacoraPerformanceLab(st.entries, { rollingWindow: 20 });
      const perfRangeRows = [
        { label: "Global", data: perfLab.portfolio.global },
        { label: "Últimos 7 días", data: perfLab.portfolio.last7d },
        { label: "Últimos 30 picks", data: perfLab.portfolio.last30 }
      ];
      const perfOverviewCards = [
        { label: "Picks", value: `${perfLab.portfolio.global.picks}` },
        { label: "Win rate", value: `${(perfLab.portfolio.global.winRate*100).toFixed(1)}%` },
        { label: "ROI", value: perfLab.portfolio.global.roi===null ? "-" : `${(perfLab.portfolio.global.roi*100).toFixed(2)}%`, tone: (perfLab.portfolio.global.roi||0)>=0 ? "#3fb950" : "#ff7b72" },
        { label: "CLV promedio", value: perfLab.portfolio.global.clvAverage===null ? "-" : `${(perfLab.portfolio.global.clvAverage*100).toFixed(2)} pp`, tone: (perfLab.portfolio.global.clvAverage||0)>=0 ? "#3fb950" : "#ff7b72" },
        { label: "EV acumulado", value: `${perfLab.portfolio.global.evCumulative>=0?'+':''}${perfLab.portfolio.global.evCumulative.toFixed(2)}`, tone: perfLab.portfolio.global.evCumulative>=0 ? "#3fb950" : "#ff7b72" },
        { label: "Yield", value: perfLab.portfolio.global.yieldPct===null ? "-" : `${(perfLab.portfolio.global.yieldPct*100).toFixed(2)}%` }
      ].map((row)=>`<div><div class="fl-mini">${row.label}</div><b style="font-size:20px;color:${row.tone||'#f6f8fa'};">${row.value}</b></div>`).join('');
      const perfRangeTable = perfRangeRows.map((row)=>`<tr><td>${row.label}</td><td>${row.data.picks}</td><td>${(row.data.winRate*100).toFixed(1)}%</td><td>${row.data.roi===null?'-':`${(row.data.roi*100).toFixed(2)}%`}</td><td>${row.data.clvAverage===null?'-':`${(row.data.clvAverage*100).toFixed(2)} pp`}</td><td>${row.data.evCumulative.toFixed(2)}</td></tr>`).join('');
      const perfLabels = perfLab.charts.map((p)=>p.label);
      const perfEquity = perfLab.charts.map((p)=>p.equity);
      const perfEv = perfLab.charts.map((p)=>p.ev);
      const perfClv = perfLab.charts.map((p)=>p.clv===null?null:Number((p.clv*100).toFixed(3)));
      const perfRolling = perfLab.rolling.map((p)=>p.roi===null?null:Number((p.roi*100).toFixed(3)));
      const renderBreakRows = (rows=[])=>rows.slice(0,6).map((row)=>`<tr><td>${row.key}</td><td>${row.picks}</td><td>${(row.winRate*100).toFixed(1)}%</td><td>${row.roi===null?'-':`${(row.roi*100).toFixed(2)}%`}</td><td>${row.clv===null?'-':`${(row.clv*100).toFixed(2)} pp`}</td></tr>`).join('') || '<tr><td colspan="5" class="fl-mini">Sin datos suficientes.</td></tr>';
      const perfInsights = perfLab.insights.length ? perfLab.insights.map((txt)=>`<li>${txt}</li>`).join('') : '<li>Sin señales suficientes todavía.</li>';

      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));">
            <div><div class="fl-mini">Bank</div><div style="font-size:24px;font-weight:900;">S/${st.bank.toFixed(2)}</div></div>
            <div><div class="fl-mini">Meta ${plan.targetDays} días</div><div style="font-size:24px;font-weight:900;">S/${plan.targetBank.toFixed(2)}</div></div>
            <div><div class="fl-mini">Progreso real del plan</div><div style="font-size:24px;font-weight:900;color:${progressColor};">${(plan.progressPct*100).toFixed(1)}%</div></div>
            <div><div class="fl-mini">Riesgo restante hoy</div><div style="font-size:24px;font-weight:900;color:${riskLeft>0?"#f2cc60":"#ff7b72"};">S/${riskLeft.toFixed(2)}</div></div>
            <div style="display:flex;justify-content:flex-end;align-items:center;"><button class="fl-btn" id="bkBuildPlan">Generar plan</button></div>
          </div>
          <div class="fl-row" style="margin-top:10px;">
            <input id="bkBank" class="fl-input" type="number" min="1" step="0.5" value="${st.bank.toFixed(2)}" placeholder="Bank actual" style="width:120px" />
            <input id="bkDays" class="fl-input" type="number" min="1" max="30" value="${st.targetDays}" placeholder="Días" style="width:90px" />
            <input id="bkTarget" class="fl-input" type="number" min="1" step="0.5" value="${st.targetValue}" placeholder="Meta" style="width:120px" />
            <select id="bkTargetMode" class="fl-select" style="width:120px"><option value="amount" ${st.targetMode==="amount"?"selected":""}>Meta S/</option><option value="percent" ${st.targetMode==="percent"?"selected":""}>Meta %</option></select>
            <select id="bkRiskLevel" class="fl-select" style="width:140px"><option value="conservador" ${st.riskLevel==="conservador"?"selected":""}>Conservador</option><option value="balanceado" ${st.riskLevel==="balanceado"?"selected":""}>Balanceado</option><option value="agresivo" ${st.riskLevel==="agresivo"?"selected":""}>Agresivo</option></select>
            <input id="bkMaxBets" class="fl-input" type="number" min="2" max="3" step="1" value="${maxDayBets}" style="width:95px" title="Máx apuestas día" />
            <input id="bkStopSoles" class="fl-input" type="number" min="0.5" step="0.5" value="${st.stopLoss.toFixed(2)}" style="width:110px" title="Stop diario S/" />
            <input id="bkStopPct" class="fl-input" type="number" min="5" max="40" step="1" value="${(st.dailyRiskPct*100).toFixed(0)}" style="width:100px" title="Stop diario %" />
            <input id="bkStopStreak" class="fl-input" type="number" min="1" max="4" step="1" value="${st.stopLossStreak}" style="width:100px" title="Stop racha" />
          </div>
          <div id="bkPilot" class="fl-mini" style="margin-top:8px;">
            🧠 Plan de hoy (Día ${dayIndex}/${plan.targetDays}): ${onTrack?"✅ Vas en ruta":"⚠️ Debes acelerar"} · avance ${plan.progressProfit>=0?"+":""}S/${plan.progressProfit.toFixed(2)} desde inicio · faltan S/${plan.remainingToTarget.toFixed(2)} para meta · odds ${plan.profile.oddsMin.toFixed(2)}-${plan.profile.oddsMax.toFixed(2)} · p mínima ${(plan.pRequired*100).toFixed(1)}% · EV mínima +${(plan.evGate*100).toFixed(1)}%.
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">🧪 Performance Lab</div>
          <div class="fl-kpi" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:10px;">${perfOverviewCards}</div>
          <div class="fl-mre-table-wrap" style="margin-bottom:10px;">
            <table class="fl-mre-table"><thead><tr><th>Ventana</th><th>Picks</th><th>Win rate</th><th>ROI</th><th>CLV</th><th>EV acum.</th></tr></thead><tbody>${perfRangeTable}</tbody></table>
          </div>
          <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
            <div class="fl-card" style="margin:0;padding:8px;">
              <div class="fl-mini">Equity real vs EV acumulado</div>
              <div style="height:180px;"><canvas id="bitacoraEquityVsEvChart"></canvas></div>
            </div>
            <div class="fl-card" style="margin:0;padding:8px;">
              <div class="fl-mini">CLV timeline (pp)</div>
              <div style="height:180px;"><canvas id="bitacoraClvChart"></canvas></div>
            </div>
            <div class="fl-card" style="margin:0;padding:8px;">
              <div class="fl-mini">ROI rolling 20 picks (%)</div>
              <div style="height:180px;"><canvas id="bitacoraRollingRoiChart"></canvas></div>
            </div>
          </div>
          <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px;">
            <div class="fl-mre-table-wrap"><table class="fl-mre-table"><thead><tr><th>Tipo</th><th>Picks</th><th>WR</th><th>ROI</th><th>CLV</th></tr></thead><tbody>${renderBreakRows(perfLab.breakdowns.byType)}</tbody></table></div>
            <div class="fl-mre-table-wrap"><table class="fl-mre-table"><thead><tr><th>Cuota</th><th>Picks</th><th>WR</th><th>ROI</th><th>CLV</th></tr></thead><tbody>${renderBreakRows(perfLab.breakdowns.byOdds)}</tbody></table></div>
            <div class="fl-mre-table-wrap"><table class="fl-mre-table"><thead><tr><th>Liga</th><th>Picks</th><th>WR</th><th>ROI</th><th>CLV</th></tr></thead><tbody>${renderBreakRows(perfLab.breakdowns.byLeague)}</tbody></table></div>
            <div class="fl-mre-table-wrap"><table class="fl-mre-table"><thead><tr><th>Tag</th><th>Picks</th><th>WR</th><th>ROI</th><th>CLV</th></tr></thead><tbody>${renderBreakRows(perfLab.breakdowns.byTag)}</tbody></table></div>
          </div>
          <div class="fl-card" style="margin-top:10px;padding:10px;background:#0d1117;border:1px solid #2d333b;">
            <div style="font-weight:700;">Lecturas automáticas</div>
            <ul style="margin:8px 0 0 16px;padding:0;display:grid;gap:5px;">${perfInsights}</ul>
          </div>
        </div>

        <div class="fl-grid two">
          <div class="fl-card">
            <div style="font-weight:800;margin-bottom:8px;">🧾 Misiones del día</div>
            <div class="fl-mini">Paso 1: cuota ${plan.profile.oddsMin.toFixed(2)}-${Math.min(plan.profile.oddsMax, 1.6).toFixed(2)} · stake S/${plan.stepStakes[0].toFixed(2)} · EV ≥ +${(plan.evGate*100).toFixed(1)}%</div>
            <div class="fl-mini" style="margin-top:4px;">Si gana → Paso 2: cuota 1.40-1.55 · stake S/${plan.stepStakes[1].toFixed(2)} · EV ≥ +${((plan.evGate-0.005)*100).toFixed(1)}%</div>
            <div class="fl-mini" style="margin-top:4px;">${allowThirdStep?`Si gana → Paso 3 opcional · stake S/${plan.stepStakes[2].toFixed(2)}`:"Paso 3 bloqueado por riesgo del día"}</div>
            <div class="fl-mini" style="margin-top:8px;color:${plan.recoveryMode?"#f2cc60":"#3fb950"};">${plan.recoveryMode?"🔻 Recuperación suave: baja stake mañana y exige EV +1.5%.":"✅ Modo normal: puedes escalar +10% a +25% si sigues verde."}</div>
            <div class="fl-mini" style="margin-top:8px;color:${plan.streakStop?"#ff7b72":"#9ca3af"};">${plan.streakStop?"Stop por racha activa: 2 pérdidas seguidas, se cierra el día.":"Stop racha controlado."}</div>
            <div class="fl-mini" style="margin-top:8px;">📍 Roadmap: cada checkpoint marca cuánto bank necesitas y si vas adelantado/atrasado.</div>
            <label class="fl-row" style="margin-top:10px;align-items:center;gap:6px;"><input id="bkAutoMode" type="checkbox" ${st.autoMode?"checked":""} /> Auto: ON</label>
          </div>

          <div class="fl-card">
            <div style="font-weight:800;margin-bottom:8px;">🎯 Radar de picks</div>
            <div class="fl-row">
              <select id="pickType" class="fl-select" style="width:120px"><option>1X2</option><option>DNB</option><option>Doble oportunidad</option><option>Under/Over</option></select>
              <input id="pickOdds" class="fl-input" type="number" step="0.01" min="1.01" placeholder="Cuota" style="width:100px" />
              <input id="pickP" class="fl-input" type="number" step="0.01" min="0.01" max="0.99" placeholder="pFinal" style="width:100px" />
              <input id="pickPmkt" class="fl-input" type="number" step="0.01" min="0.01" max="0.99" placeholder="pMkt" style="width:100px" />
              <button class="fl-btn" id="addPick">Agregar</button>
            </div>
            <table class="fl-table" style="margin-top:8px;">
              <thead><tr><th>Tipo</th><th>Cuota</th><th>pFinal</th><th>pMkt</th><th>EV</th><th>0.25 Kelly</th><th>Stake</th><th>Conf</th><th>Flex</th><th>Etiqueta</th></tr></thead>
              <tbody>${radarRows}</tbody>
            </table>
            <div class="fl-mini" style="margin-top:8px;">Conf = confianza del setup en el plan. Flex = qué tanto encaja en tu ventana ideal de cuota para ajustar sin romper el roadmap.</div>
          </div>
        </div>

        <div class="fl-grid two">
          <div class="fl-card">
            <div style="font-weight:800;margin-bottom:8px;">📈 Equity real vs plan ideal vs banda de riesgo</div>
            <svg viewBox="0 0 640 200" style="width:100%;height:220px;background:#0f141d;border:1px solid #2d333b;border-radius:10px;">
              <path d="${lowPath}" fill="none" stroke="#ff7b72" stroke-width="1.2" stroke-dasharray="4 3"/>
              <path d="${highPath}" fill="none" stroke="#2ea043" stroke-width="1.2" stroke-dasharray="4 3"/>
              <path d="${guidePath}" fill="none" stroke="#f2cc60" stroke-width="2"/>
              <path d="${equityPath}" fill="none" stroke="#58a6ff" stroke-width="2.8"/>
            </svg>
            <div class="fl-mini" style="margin-top:8px;">Azul: bank real. Amarillo: trayectoria ideal diaria para cumplir meta. Verde/rojo punteado: banda probabilística (P90/P10) según tu stake, p y cuota promedio.</div>
            <div class="fl-row" style="margin-top:8px;">
              <span class="fl-chip">Drawdown máx: ${(Math.max(...equitySeries)-Math.min(...equitySeries)).toFixed(2)}</span>
              <span class="fl-chip">Días para meta (est): ${Math.max(1, Math.ceil((plan.targetBank-st.bank)/Math.max(0.01,plan.dailyGoal)))}</span>
              <span class="fl-chip ${riskLeft>0?"warn":"bad"}">Riesgo hoy: S/${riskLeft.toFixed(2)}</span>
            </div>
          </div>
          <div class="fl-card">
            <div style="font-weight:800;margin-bottom:8px;">🗺️ Roadmap del plan + Historial compacto</div>
            <table class="fl-table" style="margin-bottom:10px;"><thead><tr><th>Checkpoint</th><th>Día objetivo</th><th>Bank objetivo</th><th>Gap</th><th>Estado</th></tr></thead><tbody>${roadmapRows}</tbody></table>
            <div style="font-weight:700;margin-bottom:6px;">Últimas apuestas (7 días)</div>
            <table class="fl-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cuota</th><th>Res</th><th>P/L</th><th>Tag</th><th>Acción</th></tr></thead><tbody>${compactHistory || "<tr><td colspan='7'>Sin registros</td></tr>"}</tbody></table>
            <div class="fl-card" style="margin-top:10px;border:1px solid #2d333b;background:#0d1117;">
              <div style="font-weight:700;margin-bottom:6px;">📉 Evolución de bank (fecha vs dinero)</div>
              ${historyValues.length ? `
                <svg viewBox="0 0 640 210" style="width:100%;height:210px;background:#0f141d;border:1px solid #2d333b;border-radius:10px;">
                  <path d="${historyPath}" fill="none" stroke="#ff4d4f" stroke-width="2.4"/>
                  <text x="8" y="16" fill="#9ca3af" font-size="11">S/${historyMax.toFixed(2)}</text>
                  <text x="8" y="196" fill="#9ca3af" font-size="11">S/${historyMin.toFixed(2)}</text>
                  <text x="6" y="206" fill="#8b949e" font-size="10">${historyFirstLabel}</text>
                  <text x="305" y="206" fill="#8b949e" font-size="10">${historyMidLabel}</text>
                  <text x="585" y="206" fill="#8b949e" font-size="10">${historyLastLabel}</text>
                </svg>
              ` : `<div class="fl-mini">Sin datos suficientes todavía.</div>`}
            </div>
            <div class="fl-row" style="margin-top:10px;">
              <input id="logStake" class="fl-input" type="number" step="0.5" min="${st.minUnit}" value="${plan.stepStakes[0]}" style="width:90px" placeholder="Stake" />
              <input id="logOdds" class="fl-input" type="number" step="0.01" min="1.01" placeholder="Cuota" style="width:90px" />
              <input id="logProb" class="fl-input" type="number" step="0.01" min="0.01" max="0.99" placeholder="pFinal" style="width:90px" />
              <input id="logCloseOdds" class="fl-input" type="number" step="0.01" min="1.01" placeholder="Cuota cierre" style="width:105px" />
              <input id="logEV" class="fl-input" type="number" step="0.01" placeholder="EV pick" style="width:90px" />
              <input id="logTag" class="fl-input" type="text" placeholder="Tag" style="width:90px" />
              <input id="logLeague" class="fl-input" type="text" placeholder="Liga" style="width:110px" />
              <input id="logConfidence" class="fl-input" type="number" step="0.01" min="0" max="1" placeholder="Conf" style="width:75px" />
              <select id="logPickType" class="fl-select" style="width:140px"><option>1X2</option><option>DNB</option><option>Doble oportunidad</option><option>Under/Over</option></select>
              <select id="logResult" class="fl-select" style="width:90px"><option value="win">win</option><option value="loss">loss</option><option value="push">push</option></select>
              <button class="fl-btn" id="saveLog">Guardar</button>
            </div>
            <div id="logOut" class="fl-mini" style="margin-top:8px;"></div>
          </div>
        </div>
      `;

      if(typeof Chart === "function"){
        const eqCanvas = document.getElementById("bitacoraEquityVsEvChart");
        const clvCanvas = document.getElementById("bitacoraClvChart");
        const roiCanvas = document.getElementById("bitacoraRollingRoiChart");
        const baseOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#c9d1d9' } } }, scales:{ x:{ ticks:{ color:'#9ca3af', maxRotation:0, autoSkip:true }, grid:{ color:'rgba(255,255,255,.05)' } }, y:{ ticks:{ color:'#9ca3af' }, grid:{ color:'rgba(255,255,255,.07)' } } } };
        if(eqCanvas){ if(eqCanvas._chart){ try{ eqCanvas._chart.destroy(); }catch(_e){} } eqCanvas._chart = new Chart(eqCanvas.getContext('2d'), { type:'line', data:{ labels: perfLabels, datasets:[{ label:'Equity real', data: perfEquity, borderColor:'#3fb950', backgroundColor:'rgba(63,185,80,.16)', tension:0.22, spanGaps:true }, { label:'EV acumulado', data: perfEv, borderColor:'#58a6ff', backgroundColor:'rgba(88,166,255,.15)', tension:0.22, spanGaps:true }] }, options: baseOpts }); }
        if(clvCanvas){ if(clvCanvas._chart){ try{ clvCanvas._chart.destroy(); }catch(_e){} } clvCanvas._chart = new Chart(clvCanvas.getContext('2d'), { type:'line', data:{ labels: perfLabels, datasets:[{ label:'CLV (pp)', data: perfClv, borderColor:'#f2cc60', backgroundColor:'rgba(242,204,96,.18)', tension:0.2, spanGaps:true }] }, options: baseOpts }); }
        if(roiCanvas){ if(roiCanvas._chart){ try{ roiCanvas._chart.destroy(); }catch(_e){} } roiCanvas._chart = new Chart(roiCanvas.getContext('2d'), { type:'line', data:{ labels: perfLabels.slice(0, perfRolling.length), datasets:[{ label:'ROI rolling %', data: perfRolling, borderColor:'#ff7b72', backgroundColor:'rgba(255,123,114,.14)', tension:0.2, spanGaps:true }] }, options: baseOpts }); }
      }

      document.getElementById("bkBuildPlan").onclick = ()=>{
        st.bank = Math.max(1, Number(document.getElementById("bkBank").value) || st.bank);
        st.targetDays = clamp(Number(document.getElementById("bkDays").value) || st.targetDays, 1, 30);
        st.targetMode = document.getElementById("bkTargetMode").value === "percent" ? "percent" : "amount";
        st.targetValue = Math.max(1, Number(document.getElementById("bkTarget").value) || st.targetValue);
        st.riskLevel = document.getElementById("bkRiskLevel").value || st.riskLevel;
        st.maxBetsPerDay = clamp(Number(document.getElementById("bkMaxBets").value) || st.maxBetsPerDay, 2, 3);
        st.stopLoss = Math.max(0.5, Number(document.getElementById("bkStopSoles").value) || st.stopLoss);
        st.dailyRiskPct = clamp((Number(document.getElementById("bkStopPct").value) || (st.dailyRiskPct*100))/100, 0.05, 0.4);
        st.stopLossStreak = clamp(Number(document.getElementById("bkStopStreak").value) || st.stopLossStreak, 1, 4);
        st.autoMode = !!document.getElementById("bkAutoMode").checked;
        st.planStartBank = st.bank;
        st.planStartDate = new Date().toISOString().slice(0,10);
        st.planTargetBank = st.targetMode === "percent"
          ? st.planStartBank * (1 + st.targetValue/100)
          : st.targetValue;
        saveDb(db);
        render("bitacora");
      };

      document.getElementById("addPick").onclick = ()=>{
        const odds = Number(document.getElementById("pickOdds").value);
        const pFinal = Number(document.getElementById("pickP").value);
        const pMktRaw = Number(document.getElementById("pickPmkt").value);
        if(!(odds>1) || !(pFinal>0 && pFinal<1)) return;
        st.pickCandidates.unshift({
          id: uid("pick"),
          pickType: document.getElementById("pickType").value || "1X2",
          odds,
          pFinal,
          pMkt: (pMktRaw>0 && pMktRaw<1) ? pMktRaw : null
        });
        st.pickCandidates = st.pickCandidates.slice(0,8);
        saveDb(db);
        render("bitacora");
      };

      document.getElementById("saveLog").onclick = ()=>{
        const stake = Math.max(st.minUnit, Number(document.getElementById("logStake").value) || st.minUnit);
        const odds = Math.max(1.01, Number(document.getElementById("logOdds").value) || 0);
        const probability = clamp(Number(document.getElementById("logProb").value) || 0.5, 0.01, 0.99);
        const result = document.getElementById("logResult").value;
        const pickType = document.getElementById("logPickType").value || "1X2";
        const out = document.getElementById("logOut");
        if(!(odds>1)){
          out.textContent = "❌ Cuota inválida.";
          return;
        }
        const calc = calcBitacoraSuggestion({
          bank: st.bank,
          odds,
          probability,
          kellyFraction: st.kellyFraction,
          minUnit: st.minUnit,
          maxStakePct: st.maxStakePct
        });
        const profit = result==="win" ? stake * (odds - 1) : (result==="loss" ? -stake : 0);
        const bankBefore = st.bank;
        st.bank = Math.max(0, st.bank + profit);
        const closingOdds = pickFirstNumber(document.getElementById("logCloseOdds")?.value);
        const tag = pickFirstString(document.getElementById("logTag")?.value, "Sin etiqueta") || "Sin etiqueta";
        const league = pickFirstString(document.getElementById("logLeague")?.value, "Sin liga") || "Sin liga";
        const confidence = pickFirstNumber(document.getElementById("logConfidence")?.value);
        const evValue = pickFirstNumber(document.getElementById("logEV")?.value, calc.ev);
        const normalizedPreview = normalizePickRecord({ odds, closingOdds, stake, result, probability, evValue });
        const entry = {
          id: uid("bet"),
          date: new Date().toISOString(),
          stake,
          odds,
          closingOdds,
          impliedCloseProb: normalizedPreview.impliedCloseProb,
          probability,
          pickType,
          league,
          tag,
          confidence,
          pMkt: 1/odds,
          result,
          ev: calc.ev,
          evValue,
          clvDelta: normalizedPreview.clvDelta,
          roiContribution: normalizedPreview.roiContribution,
          resultNormalized: normalizedPreview.resultNormalized,
          profit,
          bankBefore,
          bankAfter: st.bank,
          planDayIndex: dayIndex
        };
        st.entries.push(entry);
        saveDb(db);
        out.innerHTML = `✅ Apuesta guardada. Profit ${profit>=0?"+":""}S/${profit.toFixed(2)} · bank S/${st.bank.toFixed(2)}`;
        setTimeout(()=>render("bitacora"), 220);
      };

      const recalcBitacoraBanks = ()=>{
        if(!st.entries.length) return;
        const first = st.entries[0] || {};
        let running = Number(first.bankBefore);
        if(!Number.isFinite(running)){
          const firstAfter = Number(first.bankAfter);
          const firstProfit = Number(first.profit);
          running = Number.isFinite(firstAfter) && Number.isFinite(firstProfit)
            ? firstAfter - firstProfit
            : (Number(st.planStartBank) || Number(st.bank) || 0);
        }
        st.entries.forEach((entry, idx)=>{
          const odds = Math.max(1.01, Number(entry.odds) || 1.01);
          const stake = Math.max(st.minUnit, Number(entry.stake) || st.minUnit);
          const result = ["win", "loss", "push"].includes(entry.result) ? entry.result : "push";
          const probability = clamp(Number(entry.probability) || 0.5, 0.01, 0.99);
          const profit = result === "win" ? stake * (odds - 1) : (result === "loss" ? -stake : 0);
          entry.stake = stake;
          entry.odds = odds;
          entry.result = result;
          entry.probability = probability;
          entry.profit = profit;
          entry.ev = (probability * odds) - 1;
          entry.evValue = Number.isFinite(Number(entry.evValue)) ? Number(entry.evValue) : entry.ev;
          const normalized = normalizePickRecord(entry, idx);
          entry.resultNormalized = normalized.resultNormalized;
          entry.roiContribution = normalized.roiContribution;
          entry.clvDelta = normalized.clvDelta;
          entry.impliedCloseProb = normalized.impliedCloseProb;
          entry.bankBefore = running;
          running += profit;
          entry.bankAfter = running;
          entry.planDayIndex = Number(entry.planDayIndex) || idx + 1;
        });
        st.bank = Math.max(0, running);
      };

      const openBitacoraEditModal = (entryId)=>{
        const entry = st.entries.find(item=>item.id===entryId);
        if(!entry) return;
        const backdrop = document.createElement("div");
        backdrop.className = "fl-modal-backdrop";
        backdrop.innerHTML = `
          <div class="fl-modal" style="max-width:620px;">
            <div class="fl-row" style="justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div>
                <div class="fl-modal-title">Editar apuesta</div>
                <div class="fl-mini">Ajusta datos o elimina el registro si fue error.</div>
              </div>
              <button class="fl-btn" id="closeEditBet">Cerrar</button>
            </div>
            <div class="fl-modal-grid">
              <div class="fl-field"><label>Fecha</label><input id="editBetDate" type="datetime-local" class="fl-input" value="${(entry.date||"").slice(0,16)}"></div>
              <div class="fl-field"><label>Tipo</label><select id="editBetType" class="fl-select"><option>1X2</option><option>DNB</option><option>Doble oportunidad</option><option>Under/Over</option></select></div>
              <div class="fl-field"><label>Stake</label><input id="editBetStake" type="number" min="${st.minUnit}" step="0.5" class="fl-input" value="${Number(entry.stake||st.minUnit).toFixed(2)}"></div>
              <div class="fl-field"><label>Cuota</label><input id="editBetOdds" type="number" min="1.01" step="0.01" class="fl-input" value="${Number(entry.odds||1.5).toFixed(2)}"></div>
              <div class="fl-field"><label>pFinal</label><input id="editBetProb" type="number" min="0.01" max="0.99" step="0.01" class="fl-input" value="${clamp(Number(entry.probability)||0.5,0.01,0.99).toFixed(2)}"></div>
              <div class="fl-field"><label>Resultado</label><select id="editBetResult" class="fl-select"><option value="win">win</option><option value="loss">loss</option><option value="push">push</option></select></div>
              <div class="fl-field"><label>Cuota cierre</label><input id="editBetCloseOdds" type="number" min="1.01" step="0.01" class="fl-input" value="${Number(entry.closingOdds||0).toFixed(2)}"></div>
              <div class="fl-field"><label>EV pick</label><input id="editBetEv" type="number" step="0.01" class="fl-input" value="${Number(entry.evValue ?? entry.ev ?? 0).toFixed(3)}"></div>
              <div class="fl-field"><label>Liga</label><input id="editBetLeague" type="text" class="fl-input" value="${entry.league || ""}"></div>
              <div class="fl-field"><label>Tag</label><input id="editBetTag" type="text" class="fl-input" value="${entry.tag || ""}"></div>
              <div class="fl-field"><label>Confianza (0-1)</label><input id="editBetConfidence" type="number" min="0" max="1" step="0.01" class="fl-input" value="${Number(entry.confidence || 0).toFixed(2)}"></div>
            </div>
            <div class="fl-row" style="justify-content:space-between;margin-top:12px;">
              <button class="fl-btn" id="deleteEditBet" style="border-color:#da3633;color:#ff7b72;">Borrar</button>
              <div class="fl-row">
                <span id="editBetStatus" class="fl-mini"></span>
                <button class="fl-btn" id="saveEditBet">Guardar cambios</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(backdrop);
        const close = ()=>backdrop.remove();
        backdrop.addEventListener("click", (ev)=>{ if(ev.target===backdrop) close(); });
        backdrop.querySelector("#closeEditBet").onclick = close;
        backdrop.querySelector("#editBetType").value = entry.pickType || "1X2";
        backdrop.querySelector("#editBetResult").value = entry.result || "push";

        backdrop.querySelector("#saveEditBet").onclick = ()=>{
          entry.date = String(backdrop.querySelector("#editBetDate").value || entry.date || new Date().toISOString()).trim();
          entry.pickType = backdrop.querySelector("#editBetType").value || "1X2";
          entry.stake = Math.max(st.minUnit, Number(backdrop.querySelector("#editBetStake").value) || st.minUnit);
          entry.odds = Math.max(1.01, Number(backdrop.querySelector("#editBetOdds").value) || 1.01);
          entry.probability = clamp(Number(backdrop.querySelector("#editBetProb").value) || 0.5, 0.01, 0.99);
          entry.result = backdrop.querySelector("#editBetResult").value || "push";
          entry.closingOdds = pickFirstNumber(backdrop.querySelector("#editBetCloseOdds")?.value);
          entry.evValue = pickFirstNumber(backdrop.querySelector("#editBetEv")?.value, entry.ev);
          entry.league = pickFirstString(backdrop.querySelector("#editBetLeague")?.value, entry.league, 'Sin liga') || 'Sin liga';
          entry.tag = pickFirstString(backdrop.querySelector("#editBetTag")?.value, entry.tag, 'Sin etiqueta') || 'Sin etiqueta';
          entry.confidence = pickFirstNumber(backdrop.querySelector("#editBetConfidence")?.value);
          recalcBitacoraBanks();
          saveDb(db);
          close();
          render("bitacora");
        };

        backdrop.querySelector("#deleteEditBet").onclick = ()=>{
          st.entries = st.entries.filter(item=>item.id!==entryId);
          recalcBitacoraBanks();
          saveDb(db);
          close();
          render("bitacora");
        };
      };

      content.querySelectorAll("[data-edit-log]").forEach(btn=>{
        btn.onclick = ()=>openBitacoraEditModal(btn.getAttribute("data-edit-log"));
      });
      return;
    }


    if(view==="market"){
      db.marketTracker = Array.isArray(db.marketTracker) ? db.marketTracker.map(ensureMarketMatchState) : [];
      const todayKey = new Date().toISOString().slice(0,10);
      const upcoming = db.tracker.filter(m=>(m.date||"") >= todayKey || (!Number.isFinite(m.homeGoals) && !Number.isFinite(m.awayGoals)));
      const trackerOptions = upcoming.map(m=>{
        const home = db.teams.find(t=>t.id===m.homeId)?.name || "Local";
        const away = db.teams.find(t=>t.id===m.awayId)?.name || "Visitante";
        const lg = db.leagues.find(l=>l.id===m.leagueId)?.name || "Liga";
        return `<option value="${m.id}">${m.date || "sin fecha"} · ${home} vs ${away} (${lg})</option>`;
      }).join("");

      const rows = db.marketTracker.map(row=>({ row, metrics: marketRecordMetrics(row) }));
      const settled = rows.filter(r=>r.row.settlement && Number.isFinite(r.metrics.clv));
      const edgeGlobal = rows.length ? rows.reduce((acc,r)=>acc+r.metrics.edge,0)/rows.length : 0;
      const clvAvg = settled.length ? settled.reduce((acc,r)=>acc+r.metrics.clv,0)/settled.length : 0;
      const adelantado = rows.length ? rows.filter(r=>r.metrics.convergence===true).length / rows.length : 0;
      const evTomado = rows.filter(r=>r.row.apuestaTomada).map(r=>(r.row.apuestaTomada.probModelo * r.row.apuestaTomada.cuota) - 1);
      const evTomadoAvg = evTomado.length ? evTomado.reduce((a,b)=>a+b,0)/evTomado.length : 0;
      const roiRealNum = settled.reduce((acc,r)=>{
        const bet = r.row.apuestaTomada;
        const result = r.row.settlement?.resultadoReal;
        if(!bet || !bet.stake) return acc;
        const won = result === r.metrics.side;
        return acc + (won ? bet.stake*(bet.cuota-1) : -bet.stake);
      }, 0);
      const totalStake = settled.reduce((acc,r)=>acc+(Number(r.row.apuestaTomada?.stake)||0),0);
      const roiReal = totalStake>0 ? roiRealNum/totalStake : 0;
      const roiEsperado = totalStake>0 ? settled.reduce((acc,r)=>{
        const bet = r.row.apuestaTomada;
        return acc + (((bet.probModelo*bet.cuota)-1) * bet.stake);
      },0)/totalStake : 0;

      const cards = rows.map(({ row, metrics })=>{
        const sideLabel = metrics.side === "home" ? "1" : (metrics.side === "draw" ? "X" : "2");
        const latest = row.cuotas[row.cuotas.length-1] || null;
        const firstTs = row.cuotas[0]?.timestamp?.slice(5,16) || "inicio";
        const lastTs = latest?.timestamp?.slice(5,16) || "actual";
        const chartPoints = row.cuotas.map((q, idx)=>{
          const mkt = marketProbsFromOdds(q);
          const pMkt = metrics.side === "home" ? mkt?.pH : (metrics.side === "draw" ? mkt?.pD : mkt?.pA);
          const odd = Number(q[metrics.side]) || 0;
          const ev = odd>1 ? (metrics.modelP * odd)-1 : 0;
          return { idx, pMkt: pMkt || 0, ev };
        });
        const modelLine = sparklinePath(chartPoints.map(()=>metrics.modelP), 620, 160, -0.2, 1);
        const marketLine = sparklinePath(chartPoints.map(p=>p.pMkt), 620, 160, -0.2, 1);
        const evLine = sparklinePath(chartPoints.map(p=>p.ev), 620, 160, -0.2, 1);
        const badges = [];
        if(metrics.convergence===true) badges.push('<span class="fl-chip ok">🟢 Mercado converge</span>');
        if(metrics.convergence===false) badges.push('<span class="fl-chip bad">🔴 Mercado se aleja</span>');
        if(metrics.marketState === "early_money") badges.push('<span class="fl-chip bad">🔴 Dinero temprano</span>');
        if(metrics.marketState === "stable") badges.push('<span class="fl-chip ok">🟢 Flujo orgánico</span>');
        if(metrics.marketState === "volatile") badges.push('<span class="fl-chip warn">🟠 Volátil / ruido</span>');
        if(metrics.volatility > 0.04) badges.push('<span class="fl-chip warn">⚡ Alta volatilidad</span>');
        if(row.cuotas.length>=3 && row.cuotas.slice(-3).every(q=>((metrics.modelP*(Number(q[metrics.side])||0))-1) > 0)) badges.push('<span class="fl-chip ok">🎯 EV persistente 3 ticks</span>');
        const velocityLabel = Math.abs(metrics.velocity) > 0.01 ? "Alta" : (Math.abs(metrics.velocity) > 0.004 ? "Media" : "Baja");
        const directionLabel = metrics.drift < 0 ? "a favor de este lado" : "en contra de este lado";
        const signal = metrics.strategySignal;
        const scoreColor = metrics.stabilityScore >= 70 ? "#3fb950" : (metrics.stabilityScore >= 40 ? "#f2cc60" : "#ff7b72");
        const gaugeDegree = Math.round((metrics.stabilityScore/100) * 360);
        return `
          <div class="fl-card">
            <div class="fl-row" style="justify-content:space-between;">
              <div><b>${row.fecha || "sin fecha"}</b> · ${row.liga || "Liga"} · ${marketRowLabel(db, row)}</div>
              <div class="fl-row" style="gap:6px;">
                <div class="fl-chip">Side ${sideLabel}</div>
                <button class="fl-btn" data-delete-market="${row.matchId}" style="border-color:#da3633;color:#ff7b72;">Borrar</button>
              </div>
            </div>
            <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:8px;">
              <div><div class="fl-mini">Prob modelo vs mercado</div><b>${(metrics.modelP*100).toFixed(1)}% / ${(metrics.marketP*100).toFixed(1)}%</b></div>
              <div><div class="fl-mini">EV actual</div><b style="color:${(metrics.evCurrent||0)>0?'#3fb950':'#ff7b72'}">${((metrics.evCurrent||0)*100).toFixed(2)}%</b></div>
              <div><div class="fl-mini">Edge</div><b style="color:${metrics.edge>0?'#3fb950':'#ff7b72'}">${(metrics.edge*100).toFixed(2)}%</b></div>
              <div><div class="fl-mini">Drift cuota</div><b style="color:${metrics.drift<0?'#3fb950':'#f2cc60'}">${(metrics.drift*100).toFixed(2)}%</b></div>
              <div><div class="fl-mini">Convergencia modelo-mercado</div><b style="color:${(metrics.convergenceDelta||0)>=0?'#3fb950':'#ff7b72'}">${metrics.convergenceDelta===null?'-':`${metrics.convergenceDelta>=0?'+':''}${(metrics.convergenceDelta*100).toFixed(2)} pp`}</b></div>
              <div><div class="fl-mini">CLV</div><b style="color:${(metrics.clv||0)>0?'#3fb950':'#ff7b72'}">${metrics.clv===null?'-':metrics.clv.toFixed(3)}</b></div>
            </div>
            <div class="fl-card" style="margin-top:8px;border:1px solid #2d333b;background:#0d1117;">
              <div class="fl-row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <div>
                  <div class="fl-mini">Estado del mercado</div>
                  <b>${metrics.marketStateLabel}</b>
                  <div class="fl-mini" style="margin-top:4px;">Velocidad: <b>${velocityLabel}</b> (${(metrics.velocity*100).toFixed(2)}%/h) · Persistencia: <b>${metrics.persistence}</b> snapshots · Dirección ${directionLabel}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:54px;height:54px;border-radius:50%;background:conic-gradient(${scoreColor} ${gaugeDegree}deg,#30363d ${gaugeDegree}deg);display:grid;place-items:center;">
                    <div style="width:38px;height:38px;border-radius:50%;background:#111827;display:grid;place-items:center;font-size:11px;font-weight:700;color:${scoreColor};">${Math.round(metrics.stabilityScore)}%</div>
                  </div>
                  <div class="fl-mini">Market Stability<br/><b style="color:${scoreColor}">${Math.round(metrics.stabilityScore)}%</b> · ${metrics.stabilityBand}</div>
                </div>
              </div>
            </div>
            <div class="fl-mini" style="margin:8px 0;">${firstTs} → ${lastTs}</div>
            <svg viewBox="0 0 620 160" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px;">
              <path d="${modelLine}" fill="none" stroke="#58a6ff" stroke-width="2"></path>
              <path d="${marketLine}" fill="none" stroke="#f2cc60" stroke-width="2"></path>
              <path d="${evLine}" fill="none" stroke="#3fb950" stroke-width="2"></path>
            </svg>
            <div class="fl-row" style="margin-top:8px;">${badges.join(' ') || '<span class="fl-chip">Sin señales todavía</span>'}</div>
            <div class="fl-mini" style="margin-top:8px;"><b>Señal:</b> ${signal}</div>
          </div>
        `;
      }).join("");

      content.innerHTML = `
        <div class="fl-card">
          <div style="font-size:20px;font-weight:900;">📈 Market Tracker</div>
          <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:8px;">
            <div><div class="fl-mini">EDGE GLOBAL</div><b style="color:${edgeGlobal>0?'#3fb950':'#ff7b72'}">${(edgeGlobal*100).toFixed(2)}%</b></div>
            <div><div class="fl-mini">CLV promedio</div><b style="color:${clvAvg>0?'#3fb950':'#ff7b72'}">${(clvAvg*100).toFixed(2)}%</b></div>
            <div><div class="fl-mini">Modelo adelantado</div><b>${(adelantado*100).toFixed(1)}%</b></div>
            <div><div class="fl-mini">EV promedio tomado</div><b>${(evTomadoAvg*100).toFixed(2)}%</b></div>
            <div><div class="fl-mini">ROI real / esperado</div><b>${(roiReal*100).toFixed(1)}% / ${(roiEsperado*100).toFixed(1)}%</b></div>
          </div>
        </div>
        <div class="fl-card">
          <div class="fl-row" style="flex-wrap:wrap;">
            <select id="mkMatch" class="fl-select"><option value="">Partido de tracker (opcional)</option>${trackerOptions}</select>
            <input id="mkDate" type="date" class="fl-input" />
            <input id="mkLeague" class="fl-input" placeholder="Liga" style="min-width:130px;" />
            <input id="mkLambdaH" type="number" step="0.01" class="fl-input" placeholder="λ home" style="width:90px;" />
            <input id="mkLambdaA" type="number" step="0.01" class="fl-input" placeholder="λ away" style="width:90px;" />
            <input id="mkPH" type="number" step="0.01" class="fl-input" placeholder="p home" style="width:90px;" />
            <input id="mkPD" type="number" step="0.01" class="fl-input" placeholder="p draw" style="width:90px;" />
            <input id="mkPA" type="number" step="0.01" class="fl-input" placeholder="p away" style="width:90px;" />
            <button class="fl-btn" id="mkSaveMatch">Guardar partido market</button>
          </div>
          <div class="fl-row" style="margin-top:8px;flex-wrap:wrap;">
            <select id="mkTarget" class="fl-select">${db.marketTracker.map(r=>`<option value="${r.matchId}">${r.fecha || "sin fecha"} · ${marketRowLabel(db, r)}</option>`).join('')}</select>
            <input id="mkOddH" type="number" step="0.01" class="fl-input" placeholder="cuota 1" style="width:88px;" />
            <input id="mkOddD" type="number" step="0.01" class="fl-input" placeholder="cuota X" style="width:88px;" />
            <input id="mkOddA" type="number" step="0.01" class="fl-input" placeholder="cuota 2" style="width:88px;" />
            <button class="fl-btn" id="mkAddTick">Agregar snapshot cuota</button>
            <select id="mkSide" class="fl-select"><option value="home">1</option><option value="draw">X</option><option value="away">2</option></select>
            <input id="mkBetOdd" type="number" step="0.01" class="fl-input" placeholder="cuota tomada" style="width:110px;" />
            <input id="mkBetStake" type="number" step="0.1" class="fl-input" placeholder="stake" style="width:90px;" />
            <button class="fl-btn" id="mkSaveBet">Guardar apuesta</button>
          </div>
          <div class="fl-row" style="margin-top:8px;flex-wrap:wrap;">
            <input id="mkCloseH" type="number" step="0.01" class="fl-input" placeholder="cierre 1" style="width:88px;" />
            <input id="mkCloseD" type="number" step="0.01" class="fl-input" placeholder="cierre X" style="width:88px;" />
            <input id="mkCloseA" type="number" step="0.01" class="fl-input" placeholder="cierre 2" style="width:88px;" />
            <select id="mkResult" class="fl-select"><option value="">resultado real</option><option value="home">home</option><option value="draw">draw</option><option value="away">away</option></select>
            <button class="fl-btn" id="mkCloseMatch">Cerrar mercado</button>
            <span id="mkOut" class="fl-mini"></span>
          </div>
        </div>
        ${cards || '<div class="fl-card">Sin partidos en market tracker todavía.</div>'}
      `;

      const findTarget = ()=> db.marketTracker.find(r=>r.matchId===document.getElementById("mkTarget")?.value);
      document.getElementById("mkSaveMatch").onclick = ()=>{
        const trId = document.getElementById("mkMatch").value;
        const tr = db.tracker.find(m=>m.id===trId);
        const exists = db.marketTracker.find(r=>r.matchId===(trId || document.getElementById("mkDate").value));
        if(exists){ document.getElementById("mkOut").textContent = "Ya existe ese matchId."; return; }
        const row = ensureMarketMatchState({
          matchId: trId || uid("mkt"),
          fecha: document.getElementById("mkDate").value || tr?.date || "",
          liga: document.getElementById("mkLeague").value || db.leagues.find(l=>l.id===tr?.leagueId)?.name || "",
          label: tr ? `${db.teams.find(t=>t.id===tr.homeId)?.name || "Local"} vs ${db.teams.find(t=>t.id===tr.awayId)?.name || "Visitante"}` : "",
          lambda: { home: pickFirstNumber(document.getElementById("mkLambdaH").value), away: pickFirstNumber(document.getElementById("mkLambdaA").value) },
          probModel: {
            home: pickFirstNumber(document.getElementById("mkPH").value) ?? 0.33,
            draw: pickFirstNumber(document.getElementById("mkPD").value) ?? 0.34,
            away: pickFirstNumber(document.getElementById("mkPA").value) ?? 0.33
          },
          cuotas: tr?.oddsHome>1 && tr?.oddsDraw>1 && tr?.oddsAway>1 ? [{ timestamp: new Date().toISOString(), home: tr.oddsHome, draw: tr.oddsDraw, away: tr.oddsAway }] : []
        });
        db.marketTracker.unshift(row);
        saveDb(db);
        render("market");
      };
      document.getElementById("mkAddTick").onclick = ()=>{
        const target = findTarget();
        if(!target) return;
        const home = pickFirstNumber(document.getElementById("mkOddH").value);
        const draw = pickFirstNumber(document.getElementById("mkOddD").value);
        const away = pickFirstNumber(document.getElementById("mkOddA").value);
        if(!(home>1 && draw>1 && away>1)) return;
        target.cuotas.push({ timestamp: new Date().toISOString(), home, draw, away });
        target.cuotas = ensureMarketMatchState(target).cuotas;
        saveDb(db);
        render("market");
      };
      document.getElementById("mkSaveBet").onclick = ()=>{
        const target = findTarget();
        if(!target) return;
        const side = document.getElementById("mkSide").value;
        const cuota = pickFirstNumber(document.getElementById("mkBetOdd").value);
        const stake = pickFirstNumber(document.getElementById("mkBetStake").value);
        if(!(cuota>1) || !(stake>0)) return;
        target.apuestaTomada = {
          side,
          cuota,
          probModelo: target.probModel?.[side] || 0.33,
          stake,
          timestamp: new Date().toISOString()
        };
        saveDb(db);
        render("market");
      };
      content.querySelectorAll("[data-delete-market]").forEach((btn)=>btn.onclick = ()=>{
        const matchId = btn.getAttribute("data-delete-market");
        if(!matchId) return;
        const target = db.marketTracker.find((row)=>row.matchId===matchId);
        const displayName = target ? marketRowLabel(db, target) : matchId;
        if(!confirm(`¿Borrar ${displayName} del market tracker?`)) return;
        db.marketTracker = db.marketTracker.filter((row)=>row.matchId!==matchId);
        saveDb(db);
        render("market");
      });
      document.getElementById("mkCloseMatch").onclick = ()=>{
        const target = findTarget();
        const out = document.getElementById("mkOut");
        if(!target){ out.textContent = "Selecciona partido."; return; }
        const ch = pickFirstNumber(document.getElementById("mkCloseH").value);
        const cd = pickFirstNumber(document.getElementById("mkCloseD").value);
        const ca = pickFirstNumber(document.getElementById("mkCloseA").value);
        if(ch>1 && cd>1 && ca>1) target.closingOdds = { home: ch, draw: cd, away: ca };
        const metrics = marketRecordMetrics(target);
        target.settlement = {
          resultadoReal: document.getElementById("mkResult").value || null,
          cuotaCierre: target.closingOdds?.[metrics.side] || null,
          CLV: metrics.clv,
          EVInicial: metrics.evInitial,
          EVFinal: metrics.evCurrent
        };
        saveDb(db);
        render("market");
      };
      return;
    }


    if(view==="versus"){
      db.versus ||= { homeAdvantage: 1.1, paceFactor: 1, sampleSize: 20, marketBlend: 0.35, matchday: 20, tableContextTrust: 0.45, tableContext: {} };
      db.versus.tableContext ||= {};
      ensureLearningState(db);
      db.versus.marketBlend = clamp(Number(db.learning.marketTrust) || Number(db.versus.marketBlend) || 0.35, 0, 0.8);
      if(!db.settings.selectedLeagueId && db.leagues[0]) db.settings.selectedLeagueId = db.leagues[0].id;
      const leagueOptions = db.leagues
        .slice()
        .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }))
        .map(l=>`<option value="${l.id}" ${db.settings.selectedLeagueId===l.id?"selected":""}>${l.name}</option>`)
        .join("");
      const teamsForLeague = db.settings.selectedLeagueId ? getTeamsForLeague(db, db.settings.selectedLeagueId) : db.teams;
      const options = teamsForLeague
        .slice()
        .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }))
        .map(t=>`<option value="${t.id}">${t.name}</option>`)
        .join("");
      const pendingPredictions = db.predictions.filter(p=>!p.resolved).slice(-20).reverse();
      const pendingOptions = pendingPredictions.map(p=>{
        const home = db.teams.find(t=>t.id===p.homeId)?.name || "Local";
        const away = db.teams.find(t=>t.id===p.awayId)?.name || "Visitante";
        return `<option value="${p.id}">${p.date || "sin fecha"} · ${home} vs ${away}</option>`;
      }).join("");
      const globalTraining = computeGlobalTrainingSize(db.teams, db.tracker);
      const recentMetrics = recentWindowMetrics(db, 10);
      const globalBrier = db.learning.metrics?.global?.brierScore;
      const health = modelHealthEmoji(globalBrier);

      content.innerHTML = `
        <div class="fl-card fl-vs-layout">
          <div>
            <div class="fl-row" style="margin-bottom:8px;">
              <select id="vsLeague" class="fl-select" style="max-width:220px;"><option value="">Liga</option>${leagueOptions}</select>
            </div>
            <div class="fl-row" style="margin-bottom:8px;">
              <select id="vsHome" class="fl-select"><option value="">Home</option>${options}</select>
              <select id="vsAway" class="fl-select"><option value="">Away</option>${options}</select>
            </div>
            <div class="fl-row" style="margin-bottom:8px;">
              <input id="vsHA" class="fl-input" type="number" step="0.05" value="${db.versus.homeAdvantage}" title="Home Advantage" />
              <input id="vsPace" class="fl-input" type="number" step="0.05" value="${db.versus.paceFactor || 1}" title="Pace Factor" />
              <input id="vsN" class="fl-input" type="number" step="1" min="5" max="40" value="${db.versus.sampleSize || 20}" title="Muestra N" />
              <input id="vsBlend" class="fl-input" type="number" step="0.05" min="0" max="0.8" value="${db.versus.marketBlend || 0.35}" title="Blend mercado" />
              <button class="fl-btn" id="runVs">Simular</button>
            </div>
            <div class="fl-row">
              <input id="vsOddH" class="fl-input" type="number" step="0.01" placeholder="Cuota 1" style="width:120px" />
              <input id="vsOddD" class="fl-input" type="number" step="0.01" placeholder="Cuota X" style="width:120px" />
              <input id="vsOddA" class="fl-input" type="number" step="0.01" placeholder="Cuota 2" style="width:120px" />
            </div>
            <div class="fl-row" style="margin-top:8px;">
              <input id="vsMatchday" class="fl-input" type="number" min="1" max="50" value="${db.versus.matchday || 20}" title="Jornada" style="width:120px" />
              <input id="vsCtxTrust" class="fl-input" type="number" step="0.05" min="0" max="1" value="${db.versus.tableContextTrust || 0.45}" title="Peso contexto tabla" style="width:170px" />
              <input id="vsHomePos" class="fl-input" type="number" min="1" max="20" placeholder="Pos local" style="width:120px" />
              <select id="vsHomeObj" class="fl-select" style="width:140px"><option value="">Obj local</option><option value="title">title</option><option value="europe">europe</option><option value="mid">mid</option><option value="survival">survival</option><option value="relegation">relegation</option><option value="cupFocus">cupFocus</option></select>
              <input id="vsAwayPos" class="fl-input" type="number" min="1" max="20" placeholder="Pos visita" style="width:120px" />
              <select id="vsAwayObj" class="fl-select" style="width:140px"><option value="">Obj visita</option><option value="title">title</option><option value="europe">europe</option><option value="mid">mid</option><option value="survival">survival</option><option value="relegation">relegation</option><option value="cupFocus">cupFocus</option></select>
            </div>
            <div id="vsOut" style="margin-top:10px;" class="fl-muted">Selecciona dos equipos.</div>
            <div class="fl-row" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
              <button class="fl-btn" id="prematchGenerate">Generar previa editorial</button>
              <button class="fl-btn" id="prematchRegenerate">Regenerar</button>
              <label class="fl-mini" style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="prematchDebugToggle" /> Ver insights JSON</label>
            </div>
            <div id="prematchOut" class="fl-card" style="margin-top:8px;padding:10px;display:none;"></div>
            <div class="fl-row" style="margin-top:8px;">
              <button class="fl-btn" id="runVsV2">Simular v2 (momentum)</button>
              <button class="fl-btn" id="saveVsV2Profile">Guardar v2 en perfiles</button>
            </div>
            <div id="vsV2Out" style="margin-top:8px;" class="fl-mini">Simulación por bloques IDD pendiente.</div>
            <div class="fl-row" style="margin-top:8px;">
              <button class="fl-btn" id="saveVsPrediction">Guardar predicción</button>
              <span id="vsSaveStatus" class="fl-muted"></span>
            </div>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:6px;">Matriz de marcador exacto (0-5)</div>
            <div id="vsMatrix" class="fl-vs-grid"></div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Entrenar modelo (Training Dock)</div>
          <div class="fl-kpi" style="margin-bottom:8px;">
            <div><span>Dataset global</span><b>${globalTraining.matches}</b></div>
            <div><span>Stats/xG</span><b>${globalTraining.withStats}/${globalTraining.withXG}</b></div>
            <div><span>Salud modelo</span><b>${health}</b></div>
          </div>
          <div class="fl-mini" style="margin-bottom:8px;">Conf actual: <b>${(clamp(Number(db.learning.metrics?.global?.nMatches || 0)/120, 0.18, 0.92)*100).toFixed(0)}%</b> · Brier (10): <b>${recentMetrics.brier===null?'-':recentMetrics.brier.toFixed(3)}</b> · λ error (10): <b>${recentMetrics.lambdaError===null?'-':recentMetrics.lambdaError.toFixed(3)}</b></div>
          <div class="fl-row" style="margin-bottom:8px;">
            <select id="fbPrediction" class="fl-select"><option value="">Predicción pendiente</option>${pendingOptions}</select>
            <span id="fbUseful" class="fl-chip">Selecciona partido</span>
          </div>
          <div class="fl-mini" style="margin-bottom:6px;">✅ Misión 1: Resultado (1 clic)</div>
          <div class="fl-row" style="margin-bottom:8px;">
            <button class="fl-btn" data-outcome="home">Local</button>
            <button class="fl-btn" data-outcome="draw">Empate</button>
            <button class="fl-btn" data-outcome="away">Visita</button>
            <input id="fbOutcome" class="fl-input" placeholder="Resultado" style="width:120px" readonly />
          </div>
          <div class="fl-mini" style="margin-bottom:6px;">🎯 Misión 2: Marcador</div>
          <div class="fl-row" style="margin-bottom:8px;">
            <input id="fbHG" type="number" class="fl-input" min="0" max="9" placeholder="Goles local" style="width:140px" />
            <input id="fbAG" type="number" class="fl-input" min="0" max="9" placeholder="Goles visita" style="width:140px" />
            <button class="fl-btn" data-score="0-0">0-0</button><button class="fl-btn" data-score="1-0">1-0</button><button class="fl-btn" data-score="1-1">1-1</button><button class="fl-btn" data-score="2-1">2-1</button>
          </div>
          <div class="fl-mini" style="margin-bottom:6px;">🧠 Misión 3: Lectura + contexto</div>
          <div class="fl-row" style="margin-bottom:8px;">
            <select id="fbReading" class="fl-select" style="width:170px"><option value="">¿Quién jugó mejor?</option><option value="home">Local mejor</option><option value="draw">Parejo</option><option value="away">Visita mejor</option></select>
            <select id="fbRed" class="fl-select" style="width:120px"><option value="0">Roja: No</option><option value="1">Roja: Sí</option></select>
            <select id="fbInjury" class="fl-select" style="width:140px"><option value="0">Lesión: No</option><option value="1">Lesión: Sí</option></select>
            <select id="fbTrap" class="fl-select" style="width:170px"><option value="0">Rotación trampa: No</option><option value="1">Rotación trampa: Sí</option></select>
            <button class="fl-btn" id="applyFeedback">Entrenar con este partido</button>
          </div>
          <div id="fbOut" class="fl-muted" style="margin-top:8px;">Guarda evidencia automática + calibración online (T y λ) de forma incremental.</div>
        </div>
      `;

      const renderMatrix = (matrix, best, maxGoals)=>{
        const grid = document.getElementById("vsMatrix");
        if(!grid) return;
        grid.style.gridTemplateColumns = `repeat(${maxGoals + 2}, 1fr)`;
        const cells = [];
        cells.push('<div class="fl-vs-cell head">L/A</div>');
        for(let a=0;a<=maxGoals;a++) cells.push(`<div class="fl-vs-cell head">${a}</div>`);
        for(let h=0;h<=maxGoals;h++){
          cells.push(`<div class="fl-vs-cell head">${h}</div>`);
          for(let a=0;a<=maxGoals;a++){
            const hot = best && h===best.h && a===best.a ? "hot" : "";
            const zone = h>a ? "zone-home" : (h===a ? "zone-draw" : "zone-away");
            cells.push(`<div class="fl-vs-cell ${zone} ${hot}">${(matrix[h][a]*100).toFixed(1)}%</div>`);
          }
        }
        grid.innerHTML = cells.join("");
      };

      let lastSimulation = null;
      let lastSimulationV2 = null;
      let lastPrematchPayload = null;

      const renderPrematchPreview = (payload = null)=>{
        const out = document.getElementById('prematchOut');
        const toggle = document.getElementById('prematchDebugToggle');
        if(!out) return;
        if(!payload){
          out.style.display = 'none';
          out.classList.remove('b2-reveal-enter','b2-reveal-show');
          out.innerHTML = '';
          return;
        }
        const editorial = payload.editorial || {};
        const sections = Array.isArray(editorial.sections) ? editorial.sections : [];
        const debugOn = Boolean(toggle?.checked);
        out.style.display = 'block';
        out.classList.remove('b2-reveal-show');
        out.classList.add('b2-reveal-enter');
        out.innerHTML = `
          <div style="font-weight:900;font-size:16px;">📰 ${editorial.headline || 'Previa editorial'}</div>
          <div class="fl-mini" style="margin-top:8px;display:grid;gap:8px;">
            ${sections.map((section)=>`<div><b>${section.title}</b><div>${section.text}</div></div>`).join('')}
          </div>
          ${renderCSIBlock(payload.insights?.csi || null)}
          ${renderRQIBlock(payload.insights?.rqi || null)}
          ${renderFSIBlock(payload.insights?.fsi || null)}
          ${debugOn ? `<details style="margin-top:8px;"><summary style="cursor:pointer;">Insights JSON</summary><pre class="fl-mini" style="white-space:pre-wrap;overflow:auto;max-height:280px;">${JSON.stringify(payload.insights || {}, null, 2)}</pre></details>` : ''}
        `;
      };

      const buildPrematchPayload = ({ homeId, awayId, selectedLeagueId, market })=>{
        const homeTeam = db.teams.find((t)=>t.id===homeId);
        const awayTeam = db.teams.find((t)=>t.id===awayId);
        const brainV2State = loadBrainV2();
        const homeReadiness = computeMatchReadinessEngine(db, homeId, { brainV2: brainV2State, teamName: homeTeam?.name || '', leagueId: selectedLeagueId });
        const awayReadiness = computeMatchReadinessEngine(db, awayId, { brainV2: brainV2State, teamName: awayTeam?.name || '', leagueId: selectedLeagueId });
        const baseData = collectPrematchData({
          db,
          brainV2: brainV2State,
          homeId,
          awayId,
          leagueId: selectedLeagueId,
          market,
          readiness: { home: homeReadiness, away: awayReadiness }
        });
        const insights = buildPrematchInsights(baseData);
        const editorial = composePrematchEditorial(insights);
        return { insights, editorial };
      };

      const syncTableContextInputs = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const homeCtx = db.versus.tableContext?.[homeId] || {};
        const awayCtx = db.versus.tableContext?.[awayId] || {};
        document.getElementById("vsHomePos").value = homeCtx.pos || "";
        document.getElementById("vsAwayPos").value = awayCtx.pos || "";
        document.getElementById("vsHomeObj").value = homeCtx.objective || "";
        document.getElementById("vsAwayObj").value = awayCtx.objective || "";
      };

      document.getElementById("vsHome").onchange = syncTableContextInputs;
      document.getElementById("vsAway").onchange = syncTableContextInputs;

      document.getElementById('prematchDebugToggle').onchange = ()=>renderPrematchPreview(lastPrematchPayload);
      const handlePrematchGenerate = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const selectedLeagueId = document.getElementById("vsLeague")?.value || "";
        if(!homeId || !awayId || homeId===awayId){
          const out = document.getElementById('prematchOut');
          if(out){
            out.style.display = 'block';
            out.textContent = 'Selecciona dos equipos distintos para generar la previa.';
          }
          return;
        }
        const oddH = document.getElementById("vsOddH").value;
        const oddD = document.getElementById("vsOddD").value;
        const oddA = document.getElementById("vsOddA").value;
        const market = clean1x2Probs(oddH, oddD, oddA);
        const payload = buildPrematchPayload({ homeId, awayId, selectedLeagueId, market: market ? { ...market, oddH, oddD, oddA } : null });
        lastPrematchPayload = payload;
        renderPrematchPreview(payload);
      };
      document.getElementById('prematchGenerate').onclick = handlePrematchGenerate;
      document.getElementById('prematchRegenerate').onclick = handlePrematchGenerate;

      document.querySelectorAll("button[data-outcome]").forEach((btn)=>{
        btn.onclick = ()=>{
          document.getElementById("fbOutcome").value = btn.getAttribute("data-outcome") || "";
        };
      });
      document.querySelectorAll("button[data-score]").forEach((btn)=>{
        btn.onclick = ()=>{
          const [h,a] = (btn.getAttribute("data-score") || "0-0").split("-");
          document.getElementById("fbHG").value = h;
          document.getElementById("fbAG").value = a;
        };
      });
      const refreshUsefulMatch = ()=>{
        const predId = document.getElementById("fbPrediction").value;
        const chip = document.getElementById("fbUseful");
        const prediction = db.predictions.find(p=>p.id===predId);
        if(!prediction){
          chip.className = "fl-chip";
          chip.textContent = "Selecciona partido";
          return;
        }
        const divergence = calcPredictionDivergence(prediction);
        if(divergence > 0.12){
          chip.className = "fl-chip ok";
          chip.textContent = `🔥 Partido útil para entrenar · divergencia ${divergence.toFixed(2)}`;
        }else{
          chip.className = "fl-chip warn";
          chip.textContent = `Partido normal · entreno ligero ${divergence.toFixed(2)}`;
        }
      };
      document.getElementById("fbPrediction").onchange = refreshUsefulMatch;
      refreshUsefulMatch();

      const vsLeagueEl = document.getElementById("vsLeague");
      if(vsLeagueEl){
        vsLeagueEl.onchange = ()=>{
          db.settings.selectedLeagueId = vsLeagueEl.value || "";
          saveDb(db);
          render("versus");
        };
      }

      document.getElementById("runVsV2").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const out = document.getElementById("vsV2Out");
        if(!homeId || !awayId || homeId===awayId){
          out.textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        const homeTeam = db.teams.find(t=>t.id===homeId);
        const awayTeam = db.teams.find(t=>t.id===awayId);
        const homeProfile = getOrCreateDiagProfile(db, homeId, homeTeam?.name || "Local");
        const awayProfile = getOrCreateDiagProfile(db, awayId, awayTeam?.name || "Visitante");
        const simCfg = db.versus.simV2 || defaultDb.versus.simV2;
        const plan = buildMatchPlan(homeProfile, awayProfile, {
          homeAdv: clamp((Number(document.getElementById("vsHA").value) || db.versus.homeAdvantage || 1.1) - 1, 0, 0.3),
          leagueGoalsAvg: simCfg.leagueGoalsAvg,
          baseGoalRatePerBlock: simCfg.baseGoalRatePerBlock,
          globalVolatility: simCfg.globalVolatility
        });
        const sim = simulateMatchV2(plan);
        lastSimulationV2 = { sim, homeId, awayId };
        const blocks = sim.blocks.map(b=>`${b.t0}-${b.t1}: ${b.iddHome.toFixed(2)} (${b.events.map(e=>e.type + (e.shock?"⚡":"")).join(",") || "-"})`).join(" · ");
        out.innerHTML = `
          <div><b>Score v2:</b> ${sim.score.home}-${sim.score.away}</div>
          <div><b>Quiebre:</b> ${sim.diagnostic.breakBlock}</div>
          <div><b>Patrones:</b> ${(sim.diagnostic.patterns.join(", ") || "sin etiqueta")}</div>
          <div>${sim.diagnostic.text.map(t=>`• ${t}`).join("<br/>")}</div>
          <div style="margin-top:6px;"><b>IDD velas local:</b> ${sim.candlesHome.map(c=>`${c.label}:${c.close.toFixed(2)}`).join(" | ")}</div>
          <div style="margin-top:6px;"><b>Bloques:</b> ${blocks}</div>
        `;
      };

      document.getElementById("saveVsV2Profile").onclick = ()=>{
        const out = document.getElementById("vsV2Out");
        if(!lastSimulationV2){
          out.textContent = "❌ Ejecuta Simular v2 primero.";
          return;
        }
        const { sim, homeId, awayId } = lastSimulationV2;
        const homeTeam = db.teams.find(t=>t.id===homeId);
        const awayTeam = db.teams.find(t=>t.id===awayId);
        const currentHome = getOrCreateDiagProfile(db, homeId, homeTeam?.name || "Local");
        const currentAway = getOrCreateDiagProfile(db, awayId, awayTeam?.name || "Visitante");
        db.diagProfiles[homeId] = applyMatchToTeamProfile(currentHome, sim.diagnostic, "for");
        db.diagProfiles[awayId] = applyMatchToTeamProfile(currentAway, sim.diagnostic, "against");
        saveDb(db);
        out.innerHTML += `<div style="margin-top:6px;color:#3fb950;">✅ Rasgos de ambos equipos actualizados (EMA).</div>`;
      };

      document.getElementById("runVs").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const homeName = db.teams.find(t=>t.id===homeId)?.name || "Local";
        const awayName = db.teams.find(t=>t.id===awayId)?.name || "Visitante";
        const selectedLeagueId = document.getElementById("vsLeague")?.value || "";
        db.versus.homeAdvantage = Number(document.getElementById("vsHA").value)||1.1;
        db.versus.paceFactor = Number(document.getElementById("vsPace").value)||1;
        db.versus.sampleSize = Number(document.getElementById("vsN").value)||20;
        db.versus.marketBlend = clamp(Number(document.getElementById("vsBlend").value)||0.35, 0, 0.8);
        db.versus.matchday = clamp(Number(document.getElementById("vsMatchday").value)||20, 1, 50);
        db.versus.tableContextTrust = clamp(Number(document.getElementById("vsCtxTrust").value)||0.45, 0, 1);
        db.learning.marketTrust = db.versus.marketBlend;
        saveDb(db);
        if(!homeId || !awayId || homeId===awayId) return;

        const homePos = pickFirstNumber(document.getElementById("vsHomePos").value);
        const awayPos = pickFirstNumber(document.getElementById("vsAwayPos").value);
        const homeObjective = pickFirstString(document.getElementById("vsHomeObj").value);
        const awayObjective = pickFirstString(document.getElementById("vsAwayObj").value);
        if(homePos!==null || homeObjective){
          db.versus.tableContext[homeId] = {
            ...(db.versus.tableContext[homeId] || {}),
            ...(homePos!==null ? { pos: clamp(homePos, 1, 20) } : {}),
            ...(homeObjective ? { objective: homeObjective } : {})
          };
        }
        if(awayPos!==null || awayObjective){
          db.versus.tableContext[awayId] = {
            ...(db.versus.tableContext[awayId] || {}),
            ...(awayPos!==null ? { pos: clamp(awayPos, 1, 20) } : {}),
            ...(awayObjective ? { objective: awayObjective } : {})
          };
        }
        saveDb(db);
        const oddH = document.getElementById("vsOddH").value;
        const oddD = document.getElementById("vsOddD").value;
        const oddA = document.getElementById("vsOddA").value;
        const market = clean1x2Probs(oddH, oddD, oddA);
        const result = versusModel(db, homeId, awayId, {
          leagueId: selectedLeagueId,
          matchday: db.versus.matchday,
          tableContextTrust: db.versus.tableContextTrust,
          marketOdds: { oddH, oddD, oddA }
        });
        const baseLambdaHome = result.lHome;
        const baseLambdaAway = result.lAway;

        const b3LeagueId = selectedLeagueId || db.teams.find(t=>t.id===homeId)?.leagueId || db.teams.find(t=>t.id===awayId)?.leagueId || "";
        const homeRatings = computeB3TeamRatings(db, homeId, b3LeagueId, "home", db.versus.sampleSize || 20);
        const awayRatings = computeB3TeamRatings(db, awayId, b3LeagueId, "away", db.versus.sampleSize || 20);
        const homeMatches = db.tracker
          .filter(g=>(g.homeId===homeId || g.awayId===homeId) && (!b3LeagueId || g.leagueId===b3LeagueId))
          .slice(-(db.versus.sampleSize || 20));
        const awayMatches = db.tracker
          .filter(g=>(g.homeId===awayId || g.awayId===awayId) && (!b3LeagueId || g.leagueId===b3LeagueId))
          .slice(-(db.versus.sampleSize || 20));
        const homeTraining = computeTrainingStats(homeMatches);
        const awayTraining = computeTrainingStats(awayMatches);
        const training = {
          totalMatches: homeTraining.totalMatches + awayTraining.totalMatches,
          withStats: homeTraining.withStats + awayTraining.withStats,
          withXG: homeTraining.withXG + awayTraining.withXG,
          completeness: (homeTraining.completeness + awayTraining.completeness) / 2
        };
        const homeIntel = computeTeamIntelligencePanel(db, homeId);
        const awayIntel = computeTeamIntelligencePanel(db, awayId);
        const momHome = computeMomentumAdj(homeIntel, awayIntel);
        const momAway = computeMomentumAdj(awayIntel, homeIntel);

        const drawBoost = clamp(
          ((result.tableContext.home.pressure + result.tableContext.away.pressure - 1) * 0.05)
          - ((result.tableContext.home.riskMode + result.tableContext.away.riskMode) * 0.015),
          -0.04,
          0.04
        );
        const psychVol = clamp(
          0.9 + ((homeIntel.psych.volatility + awayIntel.psych.volatility)/200) * 0.3
          + ((homeIntel.psych.aggressiveness + awayIntel.psych.aggressiveness)/200) * 0.08,
          0.9,
          1.2
        );
        const matchChaos = clamp((homeIntel.psych.volatility + awayIntel.psych.volatility + homeIntel.psych.aggressiveness + awayIntel.psych.aggressiveness) / 400, 0, 1);
        const riskTilt = clamp((result.tableContext.home.riskMode - result.tableContext.away.riskMode) * 0.05, -0.05, 0.05);

        let lHome0 = result.leagueCtx.avgGoalsHome
          * homeRatings.attack
          * awayRatings.defenseWeakness
          * (1 + ((db.versus.homeAdvantage || 1.1) - 1))
          * (1 + momHome)
          * (1 + riskTilt);
        let lAway0 = result.leagueCtx.avgGoalsAway
          * awayRatings.attack
          * homeRatings.defenseWeakness
          * (1 + momAway)
          * (1 - riskTilt);
        ({ lHome: lHome0, lAway: lAway0 } = applyDrawBoostToLambdas(lHome0, lAway0, drawBoost));

        const pModelDist = probsFromLambdas(clamp(lHome0, 0.05, 4.5), clamp(lAway0, 0.05, 4.5), result.maxGoals);
        const pModel = { pH: pModelDist.pHome, pD: pModelDist.pDraw, pA: pModelDist.pAway };
        const conf = computeB3Confidence({
          samples: training.withStats,
          completeness: training.completeness,
          consistency01: (homeRatings.consistency + awayRatings.consistency) / 2
        });
        const blendWeight = (db.versus.marketBlend || 0.35) * (market ? 1 : 0);
        const effConf = market ? clamp(conf * (0.75 + blendWeight*0.7), 0.2, 0.88) : conf;
        const pBlend = blend1x2Probs(pModel, market, effConf);
        const leagueTemperature = getLeagueTemperature(db, b3LeagueId || "global");
        const pFinal = applyTemperatureTo1x2(pBlend, leagueTemperature);

        const brainV2 = loadBrainV2();
        const homeReadiness = computeMatchReadinessEngine(db, homeId, { brainV2, teamName: db.teams.find((t)=>t.id===homeId)?.name || "", leagueId: b3LeagueId || "" });
        const awayReadiness = computeMatchReadinessEngine(db, awayId, { brainV2, teamName: db.teams.find((t)=>t.id===awayId)?.name || "", leagueId: b3LeagueId || "" });
        const readinessDelta = clamp((homeReadiness.readinessScore - awayReadiness.readinessScore) / 100, -0.35, 0.35);
        let pMre = {
          pH: clamp(pFinal.pH + readinessDelta * 0.18, 0.05, 0.9),
          pD: clamp(pFinal.pD - Math.abs(readinessDelta) * 0.08, 0.05, 0.6),
          pA: clamp(pFinal.pA - readinessDelta * 0.18, 0.05, 0.9)
        };
        const pMreSum = pMre.pH + pMre.pD + pMre.pA;
        pMre = { pH: pMre.pH / pMreSum, pD: pMre.pD / pMreSum, pA: pMre.pA / pMreSum };
        const fragileHome = ["fragil", "roto"].includes(homeReadiness.mentalState);
        const fragileAway = ["fragil", "roto"].includes(awayReadiness.mentalState);
        const emotionalTrigger = (fragileHome && homeReadiness.emotionalRisk > 0.6) || (fragileAway && awayReadiness.emotionalRisk > 0.6);
        const fragilityChaosBoost = homeReadiness.mentalState === "fragil" ? 0.12 : homeReadiness.mentalState === "roto" ? 0.20 : 0;
        const emotionalChaosBoost = emotionalTrigger ? 0.15 : 0;
        const collapseScenario = emotionalTrigger ? "equilibrio inestable" : "equilibrio base";

        const adjusted = adjustLambdasToMatchProbs({ lHome: lHome0, lAway: lAway0 }, pMre, result.maxGoals);
        result.lHome = adjusted.lHome;
        result.lAway = adjusted.lAway;
        const calibrated = probsFromLambdas(result.lHome, result.lAway, result.maxGoals);
        result.matrix = applyVolatilityToMatrix(calibrated.matrix, psychVol);
        const adjustedMatchChaos = clamp(matchChaos + fragilityChaosBoost + emotionalChaosBoost, 0, 1);
        result.matrix = applyChaosToMatrix(result.matrix, adjustedMatchChaos);
        const distSummary = summarizeMatrix(result.matrix);
        result.pHome = distSummary.pHome;
        result.pDraw = distSummary.pDraw;
        result.pAway = distSummary.pAway;
        result.best = distSummary.best;
        result.factors.breakdown.oddsCalibration = {
          applied: !!market,
          shift: ((adjusted.lHome - lHome0) + (adjusted.lAway - lAway0))/2,
          confidence: effConf,
          pModel,
          pFinal,
          pMre,
          pMarket: market,
          readiness: { home: homeReadiness, away: awayReadiness, delta: readinessDelta }
        };
        result.factors.breakdown.b3 = {
          homeRatings,
          awayRatings,
          training,
          momentum: { home: momHome, away: momAway },
          drawBoost,
          volatility: psychVol,
          matchChaos: adjustedMatchChaos,
          riskTilt,
          confidence: effConf
        };
        const globalTraining = computeGlobalTrainingSize(db.teams, db.tracker);
        result.factors.breakdown.marketMultiplier = ((result.lHome / Math.max(0.05, baseLambdaHome)) + (result.lAway / Math.max(0.05, baseLambdaAway))) / 2;
        const dominant = topScoreCells(result.matrix, 3);
        const btts = bttsProbability(result.matrix);
        const awayZero = result.matrix.reduce((acc,row)=>acc + (row[0] || 0), 0);
        const breakdown = result.factors.breakdown;

        const marketLine = market
          ? `<div class="fl-muted" style="margin-top:6px;">Mercado limpio → 1: <b>${(market.pH*100).toFixed(1)}%</b> · X: <b>${(market.pD*100).toFixed(1)}%</b> · 2: <b>${(market.pA*100).toFixed(1)}%</b></div>`
          : "";

        const homeFacts = result.teams.homeData.form5;
        const awayFacts = result.teams.awayData.form5;
        const narrative = `Forma últimos 5: local ${homeFacts.points} pts (${homeFacts.gf}-${homeFacts.ga}) y visitante ${awayFacts.points} pts (${awayFacts.gf}-${awayFacts.ga}). `
          + `En esta liga el promedio es ${result.leagueCtx.avgGoalsHome.toFixed(2)}-${result.leagueCtx.avgGoalsAway.toFixed(2)} goles (L/V).`;
        const explainers = [
          `El local sube λ por ataque reciente (${((breakdown.homeAttackBoost-1)*100).toFixed(0)}%) y debilidad defensiva rival (${((breakdown.awayDefenseWeakness-1)*100).toFixed(0)}%).`,
          `El visitante se ajusta por su ataque fuera (${((breakdown.awayAttackPenalty-1)*100).toFixed(0)}%) y la defensa local (${((breakdown.homeDefenseStrength-1)*100).toFixed(0)}%).`,
          breakdown.oddsCalibration.applied
            ? `B³ blend: modelo ${(breakdown.oddsCalibration.pModel.pH*100).toFixed(1)}/${(breakdown.oddsCalibration.pModel.pD*100).toFixed(1)}/${(breakdown.oddsCalibration.pModel.pA*100).toFixed(1)} vs mercado ${(breakdown.oddsCalibration.pMarket.pH*100).toFixed(1)}/${(breakdown.oddsCalibration.pMarket.pD*100).toFixed(1)}/${(breakdown.oddsCalibration.pMarket.pA*100).toFixed(1)} con conf ${(breakdown.oddsCalibration.confidence*100).toFixed(0)}%.`
            : "Sin cuotas, no se aplicó calibración de mercado.",
          `Entrenamiento modelo: ${breakdown.b3?.training?.withStats || 0}/${breakdown.b3?.training?.totalMatches || 0} con stats, xG ${breakdown.b3?.training?.withXG || 0}, completitud ${((breakdown.b3?.training?.completeness || 0)*100).toFixed(0)}%, conf ${((breakdown.b3?.confidence || 0)*100).toFixed(0)}%.`,
          `Estadísticas guardadas: impacto ataque local ×${(breakdown.statsAttackHome || 1).toFixed(2)} y visitante ×${(breakdown.statsAttackAway || 1).toFixed(2)} (muestras ${breakdown.statsSample?.home || 0}/${breakdown.statsSample?.away || 0}).`,
          `Dataset global: ${globalTraining.matches} partidos | ${globalTraining.withStats} con stats | ${globalTraining.withXG} con xG.`,
          `Contexto tabla jornada ${result.tableContext.matchday}: pressure ${result.tableContext.home.pressure.toFixed(2)} / ${result.tableContext.away.pressure.toFixed(2)}, risk ${result.tableContext.home.riskMode.toFixed(2)} / ${result.tableContext.away.riskMode.toFixed(2)} → empate +${(result.tableContext.drawBoost*100).toFixed(1)}%.`
        ];
        const dominantTxt = dominant.map(c=>`${c.h}-${c.a} (${(c.p*100).toFixed(1)}%)`).join(", ");
        const bttsTxt = `BTTS: ${(btts*100).toFixed(1)}% (Away=0 en ${(awayZero*100).toFixed(1)}%)`;
        const totalLambda = result.lHome + result.lAway;
        const lambdaGap = Math.abs(result.lHome - result.lAway);
        const balance = totalLambda > 0 ? clamp(1 - (lambdaGap / totalLambda), 0, 1) : 0;
        const baseBalanceLabel = balance >= 0.72 ? "Alto" : (balance >= 0.45 ? "Medio" : "Bajo");
        const balanceLabel = emotionalTrigger ? "Inestable" : baseBalanceLabel;
        const partyProfile = [];
        partyProfile.push(totalLambda > 2.7 ? `Partido abierto (λ total: ${totalLambda.toFixed(2)})` : `Partido controlado (λ total: ${totalLambda.toFixed(2)})`);
        if((result.lHome - result.lAway) > 0.7) partyProfile.push("Local ofensivo fuerte");
        if((result.lAway - result.lHome) > 0.7) partyProfile.push("Visitante ofensivo fuerte");
        if(result.lAway >= 0.95) partyProfile.push("Visitante con probabilidad alta de marcar");
        if(btts > 0.5) partyProfile.push(`Alta probabilidad de BTTS (${(btts*100).toFixed(1)}%)`);
        if(result.pDraw > 0.28) partyProfile.push(`Empate estructural alto (${(result.pDraw*100).toFixed(1)}%)`);

        let homeOutcomeCells = 0;
        let drawOutcomeCells = 0;
        const threshold = 0.01;
        for(let h=0; h<=result.maxGoals; h++){
          for(let a=0; a<=result.maxGoals; a++){
            if((result.matrix[h][a] || 0) < threshold) continue;
            if(h>a) homeOutcomeCells += 1;
            else if(h===a) drawOutcomeCells += 1;
          }
        }
        const drawTop = topScoreCells(result.matrix, result.maxGoals + 1).filter(c=>c.h===c.a).sort((x,y)=>y.p-x.p);
        const drawLead = drawTop[0];
        const drawLeadShare = result.pDraw > 0 ? ((drawLead?.p || 0) / result.pDraw) * 100 : 0;
        const concentrationTxt = `Home Win está distribuido en ${homeOutcomeCells} marcadores (≥${(threshold*100).toFixed(0)}%). Empate en ${drawOutcomeCells}, liderado por ${drawLead ? `${drawLead.h}-${drawLead.a}` : "-"} (${drawLeadShare.toFixed(1)}% del bloque empate).`;
        const dominantLabel = result.pHome >= result.pDraw && result.pHome >= result.pAway
          ? "🏠 Local"
          : (result.pDraw >= result.pAway ? "🤝 Empate" : "✈️ Visita");
        const autoRead = `El ${dominantLabel.replace(/^[^ ]+ /, "").toLowerCase()} es favorito en el agregado (${(Math.max(result.pHome, result.pDraw, result.pAway)*100).toFixed(1)}%), pero ${(result.lAway >= 0.95 ? "el visitante tiene buena probabilidad de marcar" : "el flujo ofensivo está más repartido")}. El ${result.best.h}-${result.best.a} es el marcador individual más frecuente, aunque el conjunto de marcadores ${result.pHome >= result.pAway ? "favorables al local" : "favorables al visitante"} domina la distribución.`;
        const dominantWidth = Math.max(result.pHome, result.pDraw, result.pAway) || 1;

        const teamStrengthHome = Math.round(teamStrength(db, homeId) * 50);
        const teamStrengthAway = Math.round(teamStrength(db, awayId) * 50);
        const dominanceDelta = teamStrengthHome - teamStrengthAway;
        const dominanceLeader = dominanceDelta===0 ? "Empate" : (dominanceDelta>0 ? homeName : awayName);
        const predictedWinnerName = result.pHome >= result.pDraw && result.pHome >= result.pAway
          ? homeName
          : (result.pAway >= result.pDraw ? awayName : "Empate");
        const predictedWinnerProb = Math.max(result.pHome, result.pDraw, result.pAway);
        const efficiencyLine = dominanceDelta===0
          ? "Dominancia neutral"
          : ((dominanceDelta>0 && predictedWinnerName===homeName) || (dominanceDelta<0 && predictedWinnerName===awayName)
              ? "Modelo alineado con dominancia"
              : "Modelo contradice dominancia");

        const multiplierLines = [
          `Base liga: ${breakdown.leagueBase.home.toFixed(2)}`,
          `Ataque local: ×${breakdown.homeAttackBoost.toFixed(2)}`,
          `Defensa rival: ×${breakdown.awayDefenseWeakness.toFixed(2)}`,
          `Bias local: ×${(1 + (breakdown.teamBias.home.attack || 0)).toFixed(2)}`,
          `Stats: ×${((breakdown.statsAttackHome || 1) * (breakdown.statsAttackAway || 1)).toFixed(2)}`,
          `Table draw boost: +${((breakdown.drawBoost || 0)*100).toFixed(1)}%`,
          `B³ draw/vol/chaos: ${(breakdown.b3?.drawBoost*100 || 0).toFixed(1)}% / x${(breakdown.b3?.volatility || 1).toFixed(2)} / ${(adjustedMatchChaos*100).toFixed(0)}%`,
          `Mercado: ×${(breakdown.marketMultiplier || 1).toFixed(2)}`
        ];

        const createdAt = new Date().toISOString();
        const dateOnly = createdAt.slice(0,10);
        const leagueKey = db.teams.find(t=>t.id===homeId)?.leagueId || "global";
        const matrixTop = topScoreCells(result.matrix, 6);
        const predictionId = uid("pred");
        lastSimulation = {
          id: predictionId,
          predictionId,
          createdAt,
          updatedAt: createdAt,
          date: dateOnly,
          matchKey: `${homeId}-${awayId}-${dateOnly}`,
          leagueId: leagueKey,
          leagueKey,
          homeId,
          awayId,
          teamIds: { homeId, awayId },
          lambdaHome: result.lHome,
          lambdaAway: result.lAway,
          pHome: result.pHome,
          pDraw: result.pDraw,
          pAway: result.pAway,
          pModel,
          pFinal: pMre,
          pMarket: market || null,
          matchReadiness: { home: homeReadiness, away: awayReadiness, delta: readinessDelta, chaosBoost: fragilityChaosBoost, emotionalChaosBoost, collapseScenario },
          confidence: effConf,
          best: result.best,
          dominant,
          btts,
          breakdown,
          matrix: result.matrix,
          matrixTop,
          odds: market || null,
          marketOdds: market || null,
          features: {
            pace: result.factors.pace,
            homeAdv: result.factors.homeAdv,
            teamStrength: { home: teamStrength(db, homeId), away: teamStrength(db, awayId) },
            formMomentum: { home: result.factors.homeForm.momentum, away: result.factors.awayForm.momentum }
          },
          resolved: false
        };

        document.getElementById("vsOut").innerHTML = `
          <div>λ Home: <b>${result.lHome.toFixed(2)}</b> · λ Away: <b>${result.lAway.toFixed(2)}</b></div>
          <div style="margin-top:10px;font-weight:800;">RESULTADO MÁS PROBABLE (AGREGADO)</div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Home Win</span><b>${(result.pHome*100).toFixed(1)}%</b></div>
            <div><span>Draw</span><b>${(result.pDraw*100).toFixed(1)}%</b></div>
            <div><span>Away Win</span><b>${(result.pAway*100).toFixed(1)}%</b></div>
          </div>
          <div class="fl-vs-bars">
            <div class="fl-vs-bar"><span>Local</span><div class="fl-vs-bar-track"><div class="fl-vs-bar-fill" style="width:${(result.pHome/dominantWidth*100).toFixed(1)}%"></div></div><b>${(result.pHome*100).toFixed(1)}%</b></div>
            <div class="fl-vs-bar"><span>Empate</span><div class="fl-vs-bar-track"><div class="fl-vs-bar-fill" style="width:${(result.pDraw/dominantWidth*100).toFixed(1)}%"></div></div><b>${(result.pDraw*100).toFixed(1)}%</b></div>
            <div class="fl-vs-bar"><span>Visita</span><div class="fl-vs-bar-track"><div class="fl-vs-bar-fill" style="width:${(result.pAway/dominantWidth*100).toFixed(1)}%"></div></div><b>${(result.pAway*100).toFixed(1)}%</b></div>
          </div>
          <div style="margin-top:10px;font-weight:800;">⚡ MATCH READINESS ENGINE</div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Estado local</span><b>${homeReadiness.mentalState.toUpperCase()} (${homeReadiness.readinessScore})</b></div>
            <div><span>Estado visita</span><b>${awayReadiness.mentalState.toUpperCase()} (${awayReadiness.readinessScore})</b></div>
            <div><span>Volatilidad</span><b>${homeReadiness.volatility}/${awayReadiness.volatility}</b></div>
          </div>
          <div class="fl-muted" style="margin-top:6px;">${db.teams.find(t=>t.id===homeId)?.name || 'Local'}: confianza ${homeReadiness.confidence}% · cohesión ${homeReadiness.tacticalCohesion}% · XI estable ${homeReadiness.lineupStability}% · química ${homeReadiness.chemistry}% · claridad DT ${homeReadiness.coachClarity}%.</div>
          <div class="fl-muted" style="margin-top:6px;">${db.teams.find(t=>t.id===awayId)?.name || 'Visita'}: confianza ${awayReadiness.confidence}% · cohesión ${awayReadiness.tacticalCohesion}% · XI estable ${awayReadiness.lineupStability}% · química ${awayReadiness.chemistry}% · claridad DT ${awayReadiness.coachClarity}%.</div>
          <div class="fl-muted" style="margin-top:6px;">Veredicto: ${db.teams.find(t=>t.id===homeId)?.name || 'Local'} ${homeReadiness.verdict} · ${db.teams.find(t=>t.id===awayId)?.name || 'Visita'} ${awayReadiness.verdict}. Ajuste caos MNE local +${(fragilityChaosBoost*100).toFixed(0)}%${emotionalTrigger ? ` · gatillo emocional +${(emotionalChaosBoost*100).toFixed(0)}% (${collapseScenario})` : ""}.</div>
          <div class="fl-mini" style="margin-top:6px;">${db.teams.find(t=>t.id===homeId)?.name || "Local"}: ${homeReadiness?.evidence?.raw?.totalMatches ?? 0} juegos en memoria · ${db.teams.find(t=>t.id===awayId)?.name || "Visita"}: ${awayReadiness?.evidence?.raw?.totalMatches ?? 0} juegos en memoria · fuente ${homeReadiness?.evidence?.source || "brainV2.memories"} · filtro ${homeReadiness?.evidence?.filterLabel || "all competitions"} · fallback ${homeReadiness?.evidence?.fallback ? "sí" : "no"}</div>
          <div style="margin-top:10px;font-weight:800;">MARCADOR MÁS FRECUENTE INDIVIDUAL</div>
          <div style="margin-top:6px;"><b>${result.best.h} - ${result.best.a}</b> (${(result.best.p*100).toFixed(1)}%)</div>
          <div class="fl-muted" style="margin-top:6px;">⚠ Esto no implica que el empate sea el resultado dominante. Es la celda individual más alta en la matriz.</div>
          <div style="margin-top:10px;font-weight:800;">Perfil del partido</div>
          <div class="fl-muted" style="margin-top:6px;">• ${partyProfile.join("<br/>• ")}</div>
          <div class="fl-muted" style="margin-top:6px;">Equilibrio del partido: <b>${balanceLabel}</b> (Desbalance λ: ${lambdaGap.toFixed(2)} · Índice: ${(balance*100).toFixed(1)}%)</div>
          <div class="fl-muted" style="margin-top:6px;">Concentración del resultado: ${concentrationTxt}</div>
          <div class="fl-muted" style="margin-top:6px;">Marcadores dominantes: <b>${dominantTxt}</b></div>
          <div style="margin-top:10px;font-weight:800;">Eficiencia vs Dominancia</div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Team Strength</span><b>${teamStrengthHome} · ${teamStrengthAway}</b></div>
            <div><span>Dominance</span><b>${dominanceDelta>=0?'+':''}${dominanceDelta} ${dominanceLeader}</b></div>
            <div><span>Predicted winner</span><b>${predictedWinnerName} ${(predictedWinnerProb*100).toFixed(1)}%</b></div>
          </div>
          <div class="fl-muted" style="margin-top:6px;">Efficiency: <b>${efficiencyLine}</b></div>
          <div class="fl-muted" style="margin-top:6px;">${bttsTxt}</div>
          <div class="fl-muted" style="margin-top:6px;">Lectura automática: ${autoRead}</div>
          <div class="fl-muted" style="margin-top:6px;">Corners esperados: <b>${result.cornersExpected.toFixed(1)}</b> · Tarjetas esperadas: <b>${result.cardsExpected.toFixed(1)}</b></div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Training size</span><b>${training.withStats}/${training.totalMatches}</b></div>
            <div><span>Completeness</span><b>${(training.completeness*100).toFixed(0)}%</b></div>
            <div><span>Conf</span><b>${(effConf*100).toFixed(0)}%</b></div>
          </div>
          <div class="fl-muted" style="margin-top:6px;">Entrenamiento: ${training.withStats}/${training.totalMatches} | xG: ${training.withXG} | Comp: ${(training.completeness*100).toFixed(0)}% | Conf: ${(effConf*100).toFixed(0)}%</div>
          <div class="fl-muted" style="margin-top:6px;">${narrative}</div>
          <div class="fl-muted" style="margin-top:6px;">• ${explainers.join("<br/>• ")}</div>
          <div class="fl-muted" style="margin-top:6px;">Contribuciones λ local → <b>${multiplierLines.join(" · ")}</b></div>
          ${marketLine}
        `;

        renderMatrix(result.matrix, result.best, result.maxGoals);
      };

      document.getElementById("saveVsPrediction").onclick = ()=>{
        const status = document.getElementById("vsSaveStatus");
        if(!lastSimulation){
          status.textContent = "❌ Ejecuta una simulación primero.";
          return;
        }
        db.predictions.push({ ...lastSimulation });
        saveDb(db);
        status.textContent = "✅ Predicción guardada para feedback.";
      };

      document.getElementById("applyFeedback").onclick = ()=>{
        const predId = document.getElementById("fbPrediction").value;
        const homeGoals = pickFirstNumber(document.getElementById("fbHG").value);
        const awayGoals = pickFirstNumber(document.getElementById("fbAG").value);
        const reading = pickFirstString(document.getElementById("fbReading").value);
        const outcome = pickFirstString(document.getElementById("fbOutcome").value);
        const out = document.getElementById("fbOut");
        if(!predId || homeGoals===null || awayGoals===null){
          out.textContent = "❌ Selecciona predicción y resultado real.";
          return;
        }
        const prediction = db.predictions.find(p=>p.id===predId && !p.resolved);
        if(!prediction){
          out.textContent = "❌ Predicción no encontrada.";
          return;
        }
        const beforeRecent = recentWindowMetrics(db, 10);
        const confBefore = clamp(Number(db.learning.metrics?.global?.nMatches || 0)/120, 0.18, 0.92);
        const flags = {
          redCard: document.getElementById("fbRed").value === "1",
          injuries: document.getElementById("fbInjury").value === "1",
          rotation: document.getElementById("fbTrap").value === "1"
        };

        prediction.resolved = true;
        prediction.actual = { homeGoals, awayGoals, reading, outcome };
        prediction.updatedAt = new Date().toISOString();
        prediction.goalError = { home: homeGoals - prediction.lambdaHome, away: awayGoals - prediction.lambdaAway };
        prediction.flags = flags;

        const metrics = updateLearningFromResult(db, prediction, { homeGoals, awayGoals, reading, outcome, flags });
        prediction.logLoss = metrics.logLoss;
        prediction.brierScore = metrics.brier;
        prediction.learningUpdate = {
          leagueScaleBefore: metrics.leagueScaleBefore,
          leagueScaleAfter: metrics.leagueScale,
          homeBiasBefore: metrics.homeBiasBefore,
          homeBiasAfter: metrics.homeBias,
          awayBiasBefore: metrics.awayBiasBefore,
          awayBiasAfter: metrics.awayBias,
          confidence: metrics.confidence,
          effectiveLr: { league: metrics.lrEffectiveLeague, team: metrics.lrEffectiveTeam },
          temperature: { before: metrics.temperatureBefore, after: metrics.temperatureAfter }
        };
        saveDb(db);

        const afterRecent = recentWindowMetrics(db, 10);
        const confAfter = clamp(Number(db.learning.metrics?.global?.nMatches || 0)/120, 0.18, 0.92);
        out.innerHTML = `✅ Entrenamiento aplicado. Error goles: <b>${prediction.goalError.home.toFixed(2)}</b> / <b>${prediction.goalError.away.toFixed(2)}</b> · log-loss <b>${metrics.logLoss.toFixed(3)}</b> · brier <b>${metrics.brier.toFixed(3)}</b><br/>`
          + `🧠 leagueScale ${metrics.leagueScaleBefore.home.toFixed(3)}→${metrics.leagueScale.home.toFixed(3)} / ${metrics.leagueScaleBefore.away.toFixed(3)}→${metrics.leagueScale.away.toFixed(3)} · T liga ${metrics.temperatureBefore.toFixed(2)}→${metrics.temperatureAfter.toFixed(2)}.<br/>`
          + `📈 Impacto: Conf ${(confBefore*100).toFixed(0)}%→${(confAfter*100).toFixed(0)}% · Brier(10) ${beforeRecent.brier===null?'-':beforeRecent.brier.toFixed(3)}→${afterRecent.brier===null?'-':afterRecent.brier.toFixed(3)} · λ error(10) ${beforeRecent.lambdaError===null?'-':beforeRecent.lambdaError.toFixed(3)}→${afterRecent.lambdaError===null?'-':afterRecent.lambdaError.toFixed(3)}.`;
        render("versus");
      };
    }

    if(view==="brain"){
    content.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:900;font-size:18px;margin-bottom:8px;">🧠 Consola del Cerebro — Capa de Percepción</div>
        <div class="fl-muted" style="margin-bottom:12px;">
          Ingresa las métricas de dos equipos para construir sus Vectores de Estado normalizados.
          El cerebro procesa ambos y calcula una ventaja relativa (duelo de vectores) en tiempo real.
        </div>
        <div class="fl-card" style="margin-bottom:12px;padding:10px;border-left:4px solid #58a6ff;background:#0d1117;">
          <div style="font-weight:800;margin-bottom:6px;">✅ Proceso recomendado (modo simple)</div>
          <ol class="fl-mini" style="margin:0;padding-left:16px;line-height:1.6;">
            <li><b>Pega</b> un pack JSON en <i>"JSON de entrenamiento"</i>.</li>
            <li><b>Build Dataset</b> para convertir partidos en ejemplos de aprendizaje.</li>
            <li><b>Train</b> para entrenar el modelo híbrido y guardarlo automáticamente.</li>
            <li><b>Pre/Live Predict</b> para ver pronóstico pre-partido vs en vivo.</li>
            <li><b>Explain</b> para entender qué variables/tokens movieron la predicción.</li>
          </ol>
          <div class="fl-mini" style="margin-top:8px;color:#8b949e;line-height:1.5;">
            Sugerencia: usa solo <b>Cerebro Real v2 — Híbrido</b> como sistema principal. Los módulos de abajo quedan como apoyo/diagnóstico.
          </div>
        </div>
        <div class="fl-card" style="margin-bottom:12px;padding:10px;border-left:4px solid #3fb950;background:#0d1117;">
          <div style="font-weight:800;margin-bottom:8px;">🧠 Cerebro Real v2 — Híbrido (tabular + secuencias)</div>
          <div class="fl-grid two" style="gap:10px;">
            <div>
              <label class="fl-muted">JSON de entrenamiento (matches / teams)
                <textarea id="hybridBrainJson" class="fl-text" style="min-height:110px;margin-top:4px;" placeholder='{"matches":[...]}'></textarea>
              </label>
              <label class="fl-muted">Texto Live / Pre-match para inferencia
                <textarea id="hybridBrainText" class="fl-text" style="min-height:70px;margin-top:4px;" placeholder="SHOT_ON_TARGET minute 68, BIG_CHANCE, RED_CARD..."></textarea>
              </label>
            </div>
            <div>
              <label class="fl-muted">Features tabulares (JSON)
                <textarea id="hybridBrainTabular" class="fl-text" style="min-height:150px;margin-top:4px;" placeholder='{"elo_home":1540,"elo_away":1490,"minute":0,"is_live_slice":0}'></textarea>
              </label>
            </div>
          </div>
          <div class="fl-row" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
            <button class="fl-btn" id="hybridBuildDataset">Build Dataset</button>
            <button class="fl-btn" id="hybridTrain">Train</button>
            <button class="fl-btn secondary" id="hybridEvaluate">Evaluate</button>
            <button class="fl-btn secondary" id="hybridLoad">Load</button>
            <button class="fl-btn secondary" id="hybridPredict">Pre/Live Predict</button>
            <button class="fl-btn secondary" id="hybridExplain">Explain</button>
            <button class="fl-btn secondary" id="hybridVisionPreview">Preview Vision</button>
          </div>
          <div id="hybridBrainLogs" class="fl-mini" style="margin-top:8px;white-space:pre-wrap;line-height:1.5;">Modelo híbrido listo para dataset builder.</div>
        </div>
        <div class="fl-card" style="margin-bottom:12px;padding:10px;border-left:4px solid #58a6ff;background:#0d1117;">
          <div style="font-weight:800;margin-bottom:8px;">🧠 CEREBRO REAL (TensorFlow)</div>
          <div class="fl-row" style="gap:8px;flex-wrap:wrap;">
            <button class="fl-btn" id="tfBrainBuildDataset">BUILD DATASET</button>
            <button class="fl-btn" id="tfBrainTrain">TRAIN BRAIN</button>
            <button class="fl-btn secondary" id="tfBrainLoad">LOAD BRAIN</button>
            <button class="fl-btn secondary" id="tfBrainPredict">SIMULAR A vs B</button>
          </div>
          <div id="tfBrainStatus" class="fl-mini" style="margin-top:8px;white-space:pre-wrap;line-height:1.5;">Estado: listo para construir dataset desde tracker.</div>
          <div class="fl-grid two" style="margin-top:8px;gap:8px;">
            <div class="fl-card" style="padding:8px;">
              <div class="fl-mini">Panel 1 · Brain status</div>
              <div id="tfBrainMeta" class="fl-mini" style="white-space:pre-wrap;"></div>
            </div>
            <div class="fl-card" style="padding:8px;">
              <div class="fl-mini">Panel 2 · Dataset preview</div>
              <div id="tfBrainDatasetPreview" class="fl-mini" style="white-space:pre-wrap;"></div>
            </div>
          </div>
          <div class="fl-card" style="margin-top:8px;padding:8px;">
            <div class="fl-mini">Panel 3/4 · Training console + example reasoning</div>
            <div id="tfBrainConsole" class="fl-mini" style="white-space:pre-wrap;"></div>
          </div>
        </div>
        <div class="fl-grid two" style="margin-bottom:12px;">
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Equipo A (Local · ej. Everton)</div>
            <div class="fl-grid" style="gap:6px;margin-bottom:10px;">
              <label class="fl-muted">Liga
                <select id="brainLeagueSelectA" class="fl-select" style="width:100%;margin-top:4px;"></select>
              </label>
              <label class="fl-muted">Equipo
                <select id="brainTeamSelectA" class="fl-select" style="width:100%;margin-top:4px;"></select>
              </label>
              <button class="fl-btn secondary" id="brainAutoloadA" type="button">📥 Cargar datos reales A</button>
              <div id="brainAutoStatusA" class="fl-mini">Selecciona liga/equipo para autocompletar métricas.</div>
            </div>
            <div class="fl-grid" style="gap:6px;">
              <label class="fl-muted">Pulse (0-100) <input id="brainPulseA" type="number" min="0" max="100" value="70" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Fatiga (0-100) <input id="brainFatigaA" type="number" min="0" max="100" value="40" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Resiliencia (0-100) <input id="brainResilienciaA" type="number" min="0" max="100" value="65" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Agresividad (0-100) <input id="brainAgresividadA" type="number" min="0" max="100" value="55" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Volatilidad (0-100) <input id="brainVolatilidadA" type="number" min="0" max="100" value="40" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Edad Media (17-40) <input id="brainEdadA" type="number" min="17" max="40" value="26" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Importancia Torneo (0-1) <input id="brainImportanciaA" type="number" min="0" max="1" step="0.05" value="0.8" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Días Descanso (0-14) <input id="brainDescansoA" type="number" min="0" max="14" value="3" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Momentum (-1 a 1) <input id="brainMomentumA" type="number" min="-1" max="1" step="0.05" value="0.3" class="fl-input" style="width:80px;margin-left:8px;"></label>
            </div>
          </div>
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Equipo B (Visitante · ej. Burnley)</div>
            <div class="fl-grid" style="gap:6px;margin-bottom:10px;">
              <label class="fl-muted">Liga
                <select id="brainLeagueSelectB" class="fl-select" style="width:100%;margin-top:4px;"></select>
              </label>
              <label class="fl-muted">Equipo
                <select id="brainTeamSelectB" class="fl-select" style="width:100%;margin-top:4px;"></select>
              </label>
              <button class="fl-btn secondary" id="brainAutoloadB" type="button">📥 Cargar datos reales B</button>
              <div id="brainAutoStatusB" class="fl-mini">Selecciona liga/equipo para autocompletar métricas.</div>
            </div>
            <div class="fl-grid" style="gap:6px;">
              <label class="fl-muted">Pulse (0-100) <input id="brainPulseB" type="number" min="0" max="100" value="64" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Fatiga (0-100) <input id="brainFatigaB" type="number" min="0" max="100" value="48" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Resiliencia (0-100) <input id="brainResilienciaB" type="number" min="0" max="100" value="60" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Agresividad (0-100) <input id="brainAgresividadB" type="number" min="0" max="100" value="52" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Volatilidad (0-100) <input id="brainVolatilidadB" type="number" min="0" max="100" value="44" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Edad Media (17-40) <input id="brainEdadB" type="number" min="17" max="40" value="27" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Importancia Torneo (0-1) <input id="brainImportanciaB" type="number" min="0" max="1" step="0.05" value="0.8" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Días Descanso (0-14) <input id="brainDescansoB" type="number" min="0" max="14" value="3" class="fl-input" style="width:80px;margin-left:8px;"></label>
              <label class="fl-muted">Momentum (-1 a 1) <input id="brainMomentumB" type="number" min="-1" max="1" step="0.05" value="0.1" class="fl-input" style="width:80px;margin-left:8px;"></label>
            </div>
          </div>
        </div>
        <div class="fl-grid two" style="margin-bottom:12px;">
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Relato Equipo A (NLP)</div>
            <textarea id="brainRelatoA" class="fl-text" style="min-height:140px;"
              placeholder="Relato del Equipo A, p.ej.:&#10;45' Gol tras contraataque&#10;60' Presión alta"></textarea>
          </div>
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Relato Equipo B (NLP)</div>
            <textarea id="brainRelatoB" class="fl-text" style="min-height:140px;"
              placeholder="Relato del Equipo B, p.ej.:&#10;50' Defensa cansada&#10;75' Errores en salida"></textarea>
          </div>
        </div>
        <div class="fl-row" style="margin-bottom:12px;">
          <button class="fl-btn" id="brainInitModel">1️⃣ 🧠 Inicializar Modelo TF.js</button>
          <button class="fl-btn" id="brainProcess">2️⃣ ⚡ Procesar Vector de Estado</button>
          <button class="fl-btn danger" id="brainResetMemory">🧹 Reiniciar cerebro</button>
          <button class="fl-btn secondary" id="brainExportMemory">📤 Exportar memoria</button>
          <button class="fl-btn secondary" id="brainImportMemory">📥 Importar memoria</button>
          <input id="brainImportFile" type="file" accept="application/json" style="display:none;" />
          <label class="fl-muted" style="display:flex;align-items:center;gap:6px;">
            Modo
            <select id="brainTrainingMode" class="fl-select">
              <option value="pre">Pre-Partido</option>
              <option value="live">Live</option>
              <option value="historico">Históricos</option>
            </select>
          </label>
          <label class="fl-muted" style="display:flex;align-items:center;gap:6px;" id="brainHistoricalDateWrap">
            Fecha del partido
            <input id="brainHistoricalDate" type="date" class="fl-input">
          </label>
          <label class="fl-muted" style="display:flex;align-items:center;gap:6px;">
            Resultado real (Local/Empate/Visitante)
            <select id="brainResultadoReal" class="fl-select">
              <option value="local">Local</option>
              <option value="empate">Empate</option>
              <option value="visitante">Visitante</option>
            </select>
          </label>
          <button class="fl-btn" id="brainLearnOne">3️⃣ ✅ Validar y Aprender</button>
          <button class="fl-btn" id="brainLearnBatch">4️⃣ 📚 Entrenar Lote (últimos 10)</button>
          <span id="brainModelStatus" class="fl-muted" style="margin-left:8px;"></span>
        </div>
        <div class="fl-grid two" style="margin-bottom:12px;">
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:6px;">📉 Curva de loss (online)</div>
            <div id="brainLossChart" style="height:90px;border:1px solid #2d333b;border-radius:8px;background:#0d1117;padding:4px;"></div>
          </div>
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:6px;">🧾 Snapshots de entrenamiento (máx. 10)</div>
            <div id="brainSnapshots" class="fl-muted" style="font-size:12px;display:grid;gap:4px;"></div>
          </div>
        </div>
        <div class="fl-card" style="margin-bottom:12px;padding:10px;background:#0d1117;border-left:4px solid #58a6ff;">
          <div style="font-weight:800;margin-bottom:6px;">🩺 Health Check del Brain</div>
          <div id="brainHealthCheck" class="fl-muted" style="font-size:12px;line-height:1.6;">
            Inicializa o restaura un modelo para calcular capacidad, confianza e integridad.
          </div>
        </div>
        <div id="brainMonitor" style="display:none;">
          <div style="font-weight:800;margin-bottom:8px;">📊 Monitor del Cerebro — Datos Normalizados</div>
          <div id="brainVectorDisplay" class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:10px;"></div>
          <div class="fl-card" style="background:#0d1117;padding:10px;">
            <div class="fl-muted" style="margin-bottom:4px;">Tensor de entrada comparativo (A y B)</div>
            <code id="brainTensorDisplay" style="font-size:12px;color:#58a6ff;word-break:break-all;"></code>
          </div>
          <div id="brainComparisonOut" class="fl-card" style="margin-top:10px;background:#111722;padding:10px;display:none;"></div>
          <div class="fl-card" style="margin-top:10px;background:#0d1117;border-top:2px solid #58a6ff;padding:10px;">
            <div class="fl-title" style="color:#58a6ff;font-size:16px;">🎙️ Informe del Analista Senior</div>
            <div id="reporte-texto" style="font-style:italic;line-height:1.6;color:#c9d1d9;">Esperando datos del Córtex...</div>
            <button id="brainReadReport" type="button" class="fl-btn" style="margin-top:8px;">🔊 Escuchar de nuevo</button>
          </div>
          <div id="brainModelOut" style="margin-top:10px;display:none;" class="fl-card">
            <div style="font-weight:800;margin-bottom:6px;">🔬 Salida de la Capa de Percepción (3 probabilidades por equipo)</div>
            <div class="fl-muted" style="margin-bottom:4px;">Predicción softmax [Local, Empate, Visitante] para A y B:</div>
            <code id="brainLayerOutput" style="font-size:11px;color:#3fb950;word-break:break-all;"></code>
          </div>
        </div>
      </div>
      <details class="fl-card" style="margin-top:12px;">
        <summary style="font-weight:900;font-size:18px;margin-bottom:8px;cursor:pointer;">🧠 Sistemas de apoyo (legacy/experimental)</summary>
        <div style="font-weight:900;font-size:16px;margin:8px 0;">🧠 Cerebelo — Capa de Refinamiento</div>
        <div class="fl-muted" style="margin-bottom:12px;">
          Ingresa la predicción del Córtex (Capa 3) y el resultado del Simulador Estadístico.
          El Cerebelo compara ambas fuentes y emite un veredicto refinado con indicador de coherencia.
        </div>
        <div class="fl-grid two" style="margin-bottom:12px;">
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Predicción del Córtex (Capa 3)</div>
            <div class="fl-grid" style="gap:6px;">
              <label class="fl-muted">P(Local) <input id="cerebeloIAVictoria" type="number" min="0" max="1" step="0.01" value="0.70" class="fl-input" style="width:90px;margin-left:8px;"></label>
              <label class="fl-muted">P(Empate) <input id="cerebeloIAEmpate" type="number" min="0" max="1" step="0.01" value="0.20" class="fl-input" style="width:90px;margin-left:8px;"></label>
              <label class="fl-muted">P(Visitante) <input id="cerebeloIADerrota" type="number" min="0" max="1" step="0.01" value="0.10" class="fl-input" style="width:90px;margin-left:8px;"></label>
            </div>
          </div>
          <div class="fl-card" style="padding:10px;">
            <div style="font-weight:800;margin-bottom:8px;">Resultado del Simulador Estadístico</div>
            <div class="fl-grid" style="gap:6px;">
              <label class="fl-muted">P(Local) <input id="cerebeloSimVictoria" type="number" min="0" max="1" step="0.01" value="0.30" class="fl-input" style="width:90px;margin-left:8px;"></label>
              <label class="fl-muted">P(Empate) <input id="cerebeloSimEmpate" type="number" min="0" max="1" step="0.01" value="0.40" class="fl-input" style="width:90px;margin-left:8px;"></label>
              <label class="fl-muted">P(Visitante) <input id="cerebeloSimDerrota" type="number" min="0" max="1" step="0.01" value="0.30" class="fl-input" style="width:90px;margin-left:8px;"></label>
            </div>
          </div>
        </div>
        <div class="fl-row" style="margin-bottom:12px;">
          <button class="fl-btn" id="cerebeloRefinar">🔬 Refinar con Cerebelo</button>
        </div>
        <div id="cerebeloResult" style="display:none;">
          <div id="cerebeloSemaforo" class="fl-card" style="padding:12px;margin-bottom:10px;text-align:center;font-size:20px;font-weight:900;"></div>
          <div class="fl-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;" id="cerebeloProbs"></div>
          <div class="fl-card" style="background:#0d1117;padding:10px;">
            <div class="fl-muted" style="margin-bottom:4px;font-size:12px;">Detalle del Veredicto</div>
            <div id="cerebeloDetalle" style="font-size:12px;color:#c9d1d9;line-height:1.6;"></div>
          </div>
        </div>
      </details>
    `;


    const hybridLogsEl = document.getElementById("hybridBrainLogs");
    const hybridJsonEl = document.getElementById("hybridBrainJson");
    const hybridTextEl = document.getElementById("hybridBrainText");
    const hybridTabularEl = document.getElementById("hybridBrainTabular");

    function renderHybridStatus(extra=""){
      if(!hybridLogsEl) return;
      const status = hybridBrain.modelStatus();
      const metrics = status.metrics || {};
      hybridLogsEl.textContent = [
        `Brain status: ${status.loaded ? "Loaded" : "Not trained"}`,
        `Features version: ${status.featureSchemaVersion}`,
        `Total matches: ${hybridBrain.matchIds?.length || 0}`,
        `Total live slices: ${Math.max(0, (hybridBrain.examples?.length || 0) - (hybridBrain.matchIds?.length || 0))}`,
        `Samples: ${status.sampleCount || 0}`,
        `Vocab size: ${status.vocabSize || 0}`,
        `Val accuracy: ${Number.isFinite(metrics.valAcc) ? metrics.valAcc.toFixed(3) : "-"}`,
        `Val logloss: ${Number.isFinite(metrics.valLogLoss) ? metrics.valLogLoss.toFixed(3) : "-"}`,
        `Val goals MAE: ${Number.isFinite(metrics.valGoalsMae) ? metrics.valGoalsMae.toFixed(3) : "-"}`,
        `Brier score: ${Number.isFinite(metrics.brier) ? metrics.brier.toFixed(3) : "-"}`,
        `ECE: ${Number.isFinite(metrics.ece) ? metrics.ece.toFixed(3) : "-"}`,
        `Temperature: ${Number.isFinite(status.temperature) ? status.temperature.toFixed(3) : "-"}`,
        status.trainedAt ? `Last trained: ${status.trainedAt}` : "Last trained: -",
        status.trainingReport?.datasetStats ? `Report train/val: ${status.trainingReport.datasetStats.nTrain}/${status.trainingReport.datasetStats.nVal}` : "Report train/val: -",
        extra
      ].filter(Boolean).join("\n");
    }

    if(hybridTabularEl && !hybridTabularEl.value.trim()){
      hybridTabularEl.value = JSON.stringify({ elo_home: 1540, elo_away: 1490, form_points_home: 11, form_points_away: 7, minute: 0, is_live_slice: 0 }, null, 2);
    }

    document.getElementById("hybridBuildDataset")?.addEventListener("click", ()=>{
      try{
        const pack = HybridBrainService.parsePack(hybridJsonEl?.value || "{}");
        const meta = hybridBrain.buildDataset(pack);
        renderHybridStatus(`Dataset construido con ${meta.sampleCount} ejemplos.`);
      }catch(err){
        renderHybridStatus(`❌ Build Dataset error: ${err.message}`);
      }
    });

    document.getElementById("hybridTrain")?.addEventListener("click", async ()=>{
      try{
        renderHybridStatus("⏳ Training...");
        const metrics = await hybridBrain.train({ epochs: 14, batchSize: 32, trainRatio: 0.8 });
        await hybridBrain.save();
        renderHybridStatus(`✅ Train completado · acc=${(metrics.valAcc || 0).toFixed(3)} · logloss=${Number.isFinite(metrics.valLogLoss) ? metrics.valLogLoss.toFixed(3) : "-"} · brier=${Number.isFinite(metrics.brier) ? metrics.brier.toFixed(3) : "-"} · ece=${Number.isFinite(metrics.ece) ? metrics.ece.toFixed(3) : "-"}`);
      }catch(err){
        renderHybridStatus(`❌ Train error: ${err.message}`);
      }
    });

    document.getElementById("hybridEvaluate")?.addEventListener("click", async ()=>{
      try{
        if(!hybridBrain.examples?.length) throw new Error("Primero construye el dataset.");
        if(!hybridBrain.model) throw new Error("Primero entrena o carga el modelo.");
        const split = hybridBrain.splitExamplesByMatch(hybridBrain.examples, { trainFrac: 0.8, seed: 1337 });
        const metrics = await hybridBrain.evaluateSplit(split.val);
        const cm = metrics.confusionMatrix.map((row)=>row.join(" ")).join(" | ");
        renderHybridStatus(
          `🧪 Evaluate val: brier=${metrics.brier.toFixed(3)} · ece=${metrics.ece.toFixed(3)} · goalsMAE=${metrics.goalsMae.toFixed(3)}
` +
          `📊 Confusion matrix [H,D,A]: ${cm}`
        );
      }catch(err){
        renderHybridStatus(`❌ Evaluate error: ${err.message}`);
      }
    });

    document.getElementById("hybridLoad")?.addEventListener("click", async ()=>{
      try{
        await hybridBrain.load();
        renderHybridStatus("✅ Modelo híbrido restaurado desde local storage/IndexedDB.");
      }catch(err){
        renderHybridStatus(`⚠️ Load warning: ${err.message}`);
      }
    });

    document.getElementById("hybridPredict")?.addEventListener("click", async ()=>{
      try{
        const tabular = JSON.parse(hybridTabularEl?.value || "{}");
        const text = hybridTextEl?.value || "";
        const pre = await hybridBrain.predict({ tabular: { ...tabular, is_live_slice: 0 }, text: "" });
        const live = await hybridBrain.predict({ tabular: { ...tabular, is_live_slice: 1 }, text });
        const delta = estimateLiveDelta(pre.probs, live.probs);
        renderHybridStatus(
          `🎯 Pre-match: ${inferOutcomeLabel(pre.probs)} | H:${(pre.probs.homeWin*100).toFixed(1)} D:${(pre.probs.draw*100).toFixed(1)} A:${(pre.probs.awayWin*100).toFixed(1)}
` +
          `📡 Live: ${inferOutcomeLabel(live.probs)} | H:${(live.probs.homeWin*100).toFixed(1)} D:${(live.probs.draw*100).toFixed(1)} A:${(live.probs.awayWin*100).toFixed(1)}
` +
          `⚡ ΔP softmax [H,D,A]: ${delta.map((v)=>v.toFixed(3)).join(", ")}
` +
          `⚽ xG esperado pre/live: ${pre.goals.home.toFixed(2)}-${pre.goals.away.toFixed(2)} / ${live.goals.home.toFixed(2)}-${live.goals.away.toFixed(2)}`
        );
      }catch(err){
        renderHybridStatus(`❌ Predict error: ${err.message}`);
      }
    });

    document.getElementById("hybridVisionPreview")?.addEventListener("click", ()=>{
      try{
        const tabular = JSON.parse(hybridTabularEl?.value || "{}");
        const text = hybridTextEl?.value || "";
        const vision = hybridBrain.previewVision({ tabular, text, liveMinute: Number(tabular?.minute || 0) || null });
        const rows = vision.channels.map((row)=>`C${row.channel}: min=${row.min.toFixed(3)} max=${row.max.toFixed(3)} mean=${row.mean.toFixed(3)}`).join("\n");
        renderHybridStatus(`👁️ Vision tensor ${vision.shape.join("x")}\n${rows}`);
      }catch(err){
        renderHybridStatus(`❌ Vision preview error: ${err.message}`);
      }
    });

    document.getElementById("hybridExplain")?.addEventListener("click", async ()=>{
      try{
        const tabular = JSON.parse(hybridTabularEl?.value || "{}");
        const text = hybridTextEl?.value || "";
        const explanation = await hybridBrain.explainPrediction({ tabular, text });
        const reasons = explanation.topFeatures.map((row)=>`${row.feature}: ${row.deltaHomeWin>=0?"+":""}${row.deltaHomeWin.toFixed(3)}`).join(" | ");
        renderHybridStatus(`🧩 Top features: ${reasons}
🔎 Tokens/eventos: ${(explanation.keywords || []).join(", ") || "none"}`);
      }catch(err){
        renderHybridStatus(`❌ Explain error: ${err.message}`);
      }
    });

    renderHybridStatus();

    let tfBrainModel = null;
    let tfBrainDataset = { examples: [], featureSchema: [] };
    let tfBrainMeta = {};

    const tfBrainStatusEl = document.getElementById("tfBrainStatus");
    const tfBrainMetaEl = document.getElementById("tfBrainMeta");
    const tfBrainPreviewEl = document.getElementById("tfBrainDatasetPreview");
    const tfBrainConsoleEl = document.getElementById("tfBrainConsole");

    function tfBrainLog(message = ""){
      if(tfBrainStatusEl) tfBrainStatusEl.textContent = message;
    }

    function renderTfBrainPanels(extra = ""){
      if(tfBrainMetaEl){
        tfBrainMetaEl.textContent = [
          `Matches learned: ${tfBrainMeta.samples || 0}`,
          `Features: ${tfBrainMeta.features || tfBrainDataset.featureSchema.length || 0}`,
          `Accuracy: ${Number.isFinite(tfBrainMeta.accuracy) ? tfBrainMeta.accuracy.toFixed(3) : "-"}`,
          `Last trained: ${tfBrainMeta.trainedAt || "-"}`
        ].join("\n");
      }
      if(tfBrainPreviewEl){
        const sample = tfBrainDataset.examples[0];
        tfBrainPreviewEl.textContent = sample
          ? `samples=${tfBrainDataset.examples.length}\nfeatures[0]=${JSON.stringify(sample.features.slice(0, 12))}\nlabel_result=${JSON.stringify(sample.label_result)}\nlabel_goals=${JSON.stringify(sample.label_goals)}`
          : "Dataset vacío";
      }
      if(tfBrainConsoleEl && extra){
        tfBrainConsoleEl.textContent = `${extra}\n${tfBrainConsoleEl.textContent || ""}`.trim();
      }
    }

    function mapTrackerToBrainMatch(match = {}){
      const statsRows = Array.isArray(match.stats) ? match.stats : [];
      const findStat = (aliases = [], side = "home")=>{
        for(const row of statsRows){
          const category = String(row?.category || row?.label || row?.name || "").toLowerCase();
          if(!aliases.some((alias)=>category.includes(alias))) continue;
          const block = row?.[side] || {};
          return block?.main ?? block?.value ?? row?.[`${side}Value`] ?? row?.[side] ?? 0;
        }
        return 0;
      };
      return {
        id: match.id,
        scoreFT: { home: Number(match.homeGoals) || 0, away: Number(match.awayGoals) || 0 },
        stats: {
          home: {
            xg: Number(match.homeXg ?? match.xgHome ?? findStat(["xg"], "home")) || 0,
            shots: Number(findStat(["remates totales", "shots total", "shots"], "home")) || 0,
            shots_on_target: Number(findStat(["remates a puerta", "shot on target"], "home")) || 0,
            possession: findStat(["posesi", "possession"], "home"),
            big_chances: Number(findStat(["grandes ocasiones", "big chances"], "home")) || 0,
            corners: Number(findStat(["córner", "corner"], "home")) || 0,
            passes: Number(findStat(["pases", "passes"], "home")) || 0,
            touches_box: Number(findStat(["toques en el área", "touches in box"], "home")) || 0,
            xa: Number(findStat(["asistencias esperadas", "xa"], "home")) || 0,
            xgot: Number(findStat(["xgot"], "home")) || 0
          },
          away: {
            xg: Number(match.awayXg ?? match.xgAway ?? findStat(["xg"], "away")) || 0,
            shots: Number(findStat(["remates totales", "shots total", "shots"], "away")) || 0,
            shots_on_target: Number(findStat(["remates a puerta", "shot on target"], "away")) || 0,
            possession: findStat(["posesi", "possession"], "away"),
            big_chances: Number(findStat(["grandes ocasiones", "big chances"], "away")) || 0,
            corners: Number(findStat(["córner", "corner"], "away")) || 0,
            passes: Number(findStat(["pases", "passes"], "away")) || 0,
            touches_box: Number(findStat(["toques en el área", "touches in box"], "away")) || 0,
            xa: Number(findStat(["asistencias esperadas", "xa"], "away")) || 0,
            xgot: Number(findStat(["xgot"], "away")) || 0
          }
        },
        narrative: { home: match.note || "", away: match.noteAway || "" },
        homeId: match.homeId,
        awayId: match.awayId
      };
    }

    document.getElementById("tfBrainBuildDataset")?.addEventListener("click", ()=>{
      const mapped = (db.tracker || []).map(mapTrackerToBrainMatch);
      tfBrainDataset = buildTrainingDataset(mapped, { orientation: "home-away", includeNarrative: true });
      tfBrainLog(`Dataset listo con ${tfBrainDataset.examples.length} partidos.`);
      renderTfBrainPanels();
    });

    document.getElementById("tfBrainTrain")?.addEventListener("click", async ()=>{
      try{
        if(typeof tf === "undefined") throw new Error("TensorFlow.js no cargado");
        if(!tfBrainDataset.examples.length){
          const mapped = (db.tracker || []).map(mapTrackerToBrainMatch);
          tfBrainDataset = buildTrainingDataset(mapped, { orientation: "home-away", includeNarrative: true });
        }
        if(!tfBrainDataset.examples.length) throw new Error("No hay muestras para entrenar");
        tfBrainModel = createTensorflowBrainModel(tf, tfBrainDataset.featureSchema.length);
        tfBrainConsoleEl.textContent = "";
        const history = await trainTensorflowBrainModel({
          tfRef: tf,
          model: tfBrainModel,
          dataset: tfBrainDataset,
          epochs: 50,
          batchSize: 16,
          learningRate: 0.001,
          onEpoch: (epoch, logs)=>{
            const line = `epoch ${epoch+1} · loss=${Number(logs?.loss||0).toFixed(4)} · acc=${Number(logs?.result_accuracy||logs?.result_acc||0).toFixed(4)}`;
            renderTfBrainPanels(line);
          }
        });
        const accHist = history?.history?.result_accuracy || history?.history?.result_acc || [];
        const accuracy = accHist.length ? Number(accHist[accHist.length - 1]) : null;
        tfBrainMeta = {
          samples: tfBrainDataset.examples.length,
          teams: new Set((db.tracker || []).flatMap((m)=>[m.homeId, m.awayId]).filter(Boolean)).size,
          trainedAt: new Date().toISOString(),
          accuracy: Number.isFinite(accuracy) ? accuracy : null
        };
        await saveBrainArtifacts({ model: tfBrainModel, meta: tfBrainMeta, featureSchema: tfBrainDataset.featureSchema, profile: "footballlab_real" });
        tfBrainLog("✅ Brain entrenado y guardado en IndexedDB.");
        renderTfBrainPanels();
      }catch(err){
        tfBrainLog(`❌ ${err.message}`);
      }
    });

    document.getElementById("tfBrainLoad")?.addEventListener("click", async ()=>{
      try{
        const payload = await loadBrainArtifacts({ tfRef: tf, profile: "footballlab_real" });
        tfBrainModel = payload.model;
        tfBrainMeta = payload.meta || {};
        tfBrainDataset.featureSchema = payload.featureSchema || [];
        tfBrainLog("✅ Brain cargado desde IndexedDB.");
        renderTfBrainPanels();
      }catch(err){
        tfBrainLog(`⚠️ ${err.message}`);
      }
    });

    document.getElementById("tfBrainPredict")?.addEventListener("click", ()=>{
      try{
        if(!tfBrainModel) throw new Error("Entrena o carga el Brain primero");
        const homeId = brainSelectors?.A?.team?.value;
        const awayId = brainSelectors?.B?.team?.value;
        const profileHome = buildTeamProfile((db.tracker || []).map(mapTrackerToBrainMatch), homeId);
        const profileAway = buildTeamProfile((db.tracker || []).map(mapTrackerToBrainMatch), awayId);
        const liveNarrative = {
          home: document.getElementById("brainRelatoA")?.value || "",
          away: document.getElementById("brainRelatoB")?.value || ""
        };
        const vector = buildFeatureVectorFromProfiles(profileHome, profileAway, liveNarrative);
        const prediction = inferWithBrain({ model: tfBrainModel, featureVector: vector });
        const nA = extractNarrativeFeatures(liveNarrative.home);
        const nB = extractNarrativeFeatures(liveNarrative.away);
        renderTfBrainPanels(
          `Prediction ${homeId || "Home"} vs ${awayId || "Away"}\n` +
          `Home win ${(prediction.result[0]*100).toFixed(1)}% · Draw ${(prediction.result[1]*100).toFixed(1)}% · Away win ${(prediction.result[2]*100).toFixed(1)}%\n` +
          `Expected goals ${prediction.goals.home.toFixed(2)}-${prediction.goals.away.toFixed(2)}\n` +
          `Top factors: xG diff=${vector[0].toFixed(2)}, shots diff=${vector[1].toFixed(2)}, big chances diff=${vector[4].toFixed(2)}\n` +
          `Live events Δ: shots=${nA.shot-nB.shot}, corners=${nA.corner-nB.corner}, cards=${(nA.yellow+nA.red)-(nB.yellow+nB.red)}`
        );
      }catch(err){
        tfBrainLog(`❌ ${err.message}`);
      }
    });

    renderTfBrainPanels();

    const LABELS = [
      "Pulse","Fatiga","Resiliencia","Agresividad",
      "Volatilidad","Edad Media","Importancia Torneo",
      "Días Descanso","Momentum"
    ];

    const NARRATIVA_SINTESIS = {
      escenariosVictoria: [
        "domina las probabilidades con un sólido {percent}%",
        "se perfila como favorito estadístico en el duelo del Hill Dickinson",
        "mantiene la ventaja en el modelo predictivo"
      ],
      alertasRacha: {
        critica: "la carga psicológica de {racha} derrotas consecutivas pesa más que la táctica",
        estable: "llegan en un momento de forma equilibrado",
        ascendente: "el momentum positivo de los últimos encuentros es su mejor arma"
      },
      conectores: ["Sin embargo", "Por otro lado", "A pesar de esto"]
    };

    const brainSelectors = {
      A: {
        league: document.getElementById("brainLeagueSelectA"),
        team: document.getElementById("brainTeamSelectA"),
        status: document.getElementById("brainAutoStatusA")
      },
      B: {
        league: document.getElementById("brainLeagueSelectB"),
        team: document.getElementById("brainTeamSelectB"),
        status: document.getElementById("brainAutoStatusB")
      }
    };

    function avgAgeForTeam(teamId){
      const ages = db.players
        .filter((p)=>p.teamId===teamId)
        .map((p)=>Number(p.age ?? p.edad))
        .filter(Number.isFinite);
      return ages.length ? average(ages, 26) : 26;
    }

    function restDaysForTeam(teamId, options = {}){
      const tracker = Array.isArray(options?.tracker) ? options.tracker : db.tracker;
      const referenceDate = String(options?.referenceDate || "").trim();
      const referenceTs = parseSortableDate(referenceDate);
      const useHistoricalReference = Number.isFinite(referenceTs);
      const latest = tracker
        .filter((m)=>m.homeId===teamId || m.awayId===teamId)
        .filter((m)=>{
          if(!useHistoricalReference) return true;
          const matchTs = parseSortableDate(m.date);
          return Number.isFinite(matchTs) && matchTs < referenceTs;
        })
        .slice()
        .sort((a, b)=>parseSortableDate(b.date) - parseSortableDate(a.date))[0];
      if(!latest) return 3;
      const latestTs = parseSortableDate(latest.date);
      if(!Number.isFinite(latestTs)) return 3;
      const nowTs = useHistoricalReference ? referenceTs : Date.now();
      const diff = Math.floor((nowTs - latestTs) / 86400000);
      return clamp(diff, 0, 14);
    }

    function filterTrackerBeforeDate(tracker = [], dateStr = ""){
      const targetTs = parseSortableDate(dateStr);
      if(!Number.isFinite(targetTs)) return Array.isArray(tracker) ? tracker.slice() : [];
      return (Array.isArray(tracker) ? tracker : []).filter((match)=>{
        const matchTs = parseSortableDate(match?.date);
        return Number.isFinite(matchTs) && matchTs < targetTs;
      });
    }

    function estimatedTournamentImportance(leagueId){
      const type = normalizeCompetitionType(getCompetitionById(db, leagueId)?.type);
      if(type === "continental") return 0.95;
      if(type === "cup") return 0.85;
      if(type === "friendly") return 0.45;
      return 0.8;
    }

    function setInputValue(inputId, value, decimals = 0){
      const el = document.getElementById(inputId);
      if(!el) return;
      const next = Number(value);
      if(!Number.isFinite(next)) return;
      el.value = decimals > 0 ? next.toFixed(decimals) : String(Math.round(next));
    }

    function getRecentTeamFeatureWindow(teamId, options = {}){
      const tracker = Array.isArray(options?.tracker) ? options.tracker : db.tracker;
      const historicalDate = String(options?.historicalDate || "").trim();
      const referenceTs = parseSortableDate(historicalDate);
      const trackerWindow = tracker
        .filter((m)=>m.homeId===teamId || m.awayId===teamId)
        .filter((m)=>{
          if(!Number.isFinite(referenceTs)) return true;
          const matchTs = parseSortableDate(m.date);
          return Number.isFinite(matchTs) && matchTs < referenceTs;
        })
        .slice()
        .sort(compareByDateAsc)
        .filter((m)=>Boolean(m?.featureSnapshots?.[teamId]?.features))
        .slice(-3)
        .map((match)=>({
          matchId: match.id,
          date: match.date,
          features: match?.featureSnapshots?.[teamId]?.features || {}
        }));
      if(trackerWindow.length){
        trackerWindow._source = "tracker";
        return trackerWindow;
      }
      const profileWindow = getTeamBrainFeatures(teamId, historicalDate);
      profileWindow._source = "team_profile";
      return profileWindow;
    }

    function summarizeTeamFeatureWindow(window = []){
      if(!Array.isArray(window) || !window.length) return null;
      const avg = (key, fallback)=>{
        const list = window.map((row)=>Number(row?.features?.[key])).filter(Number.isFinite);
        return list.length ? average(list, fallback) : fallback;
      };
      const latest = window[window.length - 1] || null;
      return {
        pulse: avg("pulse", NaN),
        fatiga: avg("fatiga", NaN),
        resiliencia: avg("resiliencia", NaN),
        agresividad: avg("agresividad", NaN),
        volatilidad: avg("volatilidad", NaN),
        momentum: avg("momentum", NaN),
        importancia: avg("importancia", NaN),
        descanso: avg("descanso", NaN),
        edadMedia: avg("edadMedia", NaN),
        sampleSize: window.length,
        latestDate: latest?.date || "",
        latestMatchId: latest?.matchId || "",
        daysSinceLast: Number.isFinite(parseSortableDate(latest?.date))
          ? Math.max(0, Math.round((Date.now() - parseSortableDate(latest.date)) / 86400000))
          : 0
      };
    }

    function describeBrainAutoloadSources(teamId, leagueId, intel, momentumSigned, options = {}){
      const tracker = Array.isArray(options?.tracker) ? options.tracker : db.tracker;
      const playerCount = db.players.filter((p)=>p.teamId===teamId).length;
      const playedMatches = tracker.filter((m)=>m.homeId===teamId || m.awayId===teamId).length;
      const competitionType = normalizeCompetitionType(getCompetitionById(db, leagueId)?.type) || "league";
      const heatList = Array.isArray(intel?.playerHeat?.list) ? intel.playerHeat.list : [];
      const narrativeEvents = Number(intel?.playerHeat?.summary?.narrativeEvents) || 0;
      const playersWithNarrative = heatList.filter((p)=>Number(p?.events) > 0).length;
      const narrativeCoverage = playerCount > 0 ? (playersWithNarrative / playerCount) : 0;
      const psychAdj = intel?.playerHeat?.summary?.psychAdjustments || {};
      const narrativeSignal = clamp(narrativeEvents / Math.max(1, playedMatches * 8), 0, 1);
      const narrativeQuality = narrativeSignal < 0.25
        ? "baja (posible ruido por poca muestra)"
        : narrativeSignal < 0.6
          ? "media"
          : "alta";
      const dateScope = options?.historicalDate
        ? ` (corte pre-partido ${options.historicalDate})`
        : "";

      return [
        `Fuentes${dateScope}: ${playedMatches} partidos tracker + ${playerCount} jugadores + relato normalizado.`,
        `Narrativa usada: eventos=${narrativeEvents}, jugadores impactados=${playersWithNarrative}/${Math.max(playerCount, 1)} (${(narrativeCoverage*100).toFixed(0)}%), señal=${narrativeQuality}.`,
        `Ajustes desde narrativa → agre:${(Number(psychAdj.aggressiveness)||0).toFixed(1)}, res:${(Number(psychAdj.resilience)||0).toFixed(1)}, vol:${(Number(psychAdj.volatility)||0).toFixed(1)}, fat:${(Number(psychAdj.fatigue)||0).toFixed(1)}.`,
        `Pulse plantilla=${Math.round(Number(intel?.psych?.playerPulse) || 0)}; momentum5=${((Number(intel?.metrics?.momentum5) || 0.5) * 100).toFixed(0)}% → input ${momentumSigned.toFixed(2)}.`,
        `Importancia torneo derivada por tipo de competencia: ${competitionType}.`
      ].join(" ");
    }

    function buildTeamProfileStatusHtml(team, teamId, quality = null){
      const teamPackIndex = getJsonStorage(TEAM_PACKS_INDEX_KEY);
      const manifest = teamPackIndex?.[teamId] || {};
      const rangeFrom = manifest?.range?.from || quality?.rangeFrom || "-";
      const rangeTo = manifest?.range?.to || quality?.rangeTo || "-";
      const cutoff = manifest?.cutoffDate || rangeTo || "-";
      const matches = Number.isFinite(manifest?.matches) ? manifest.matches : (quality?.sampleSize || 0);
      const pctStats = Number.isFinite(quality?.pctStats) ? quality.pctStats : 1;
      const pctNarrative = Number.isFinite(quality?.pctNarrative) ? quality.pctNarrative : 1;
      const pctSnapshots = Number.isFinite(quality?.pctSnapshots) ? quality.pctSnapshots : 1;
      const score = Number.isFinite(quality?.score) ? quality.score : Math.round((Number(quality?.consistency) || 1) * 100);
      const coverage = Number.isFinite(quality?.coverage) ? quality.coverage : 1;
      const recency = Number.isFinite(quality?.recency) ? quality.recency : 1;
      const daysSinceLast = Number.isFinite(quality?.daysSinceLast) ? quality.daysSinceLast : 0;
      const completeness = Number.isFinite(quality?.completeness) ? quality.completeness : 1;
      const consistency = Number.isFinite(quality?.consistency) ? quality.consistency : 1;
      const missingCriticalRate = Number.isFinite(quality?.missingCriticalRate) ? quality.missingCriticalRate : 0;
      const duplicateMatchIdRate = Number.isFinite(quality?.duplicateMatchIdRate) ? quality.duplicateMatchIdRate : 0;
      const unorderedDateRate = Number.isFinite(quality?.unorderedDateRate) ? quality.unorderedDateRate : 0;
      return [
        `Equipo: <b>${team?.name || "-"}</b>`,
        `Rango: <b>${rangeFrom}</b> → <b>${rangeTo}</b>`,
        `Cutoff: <b>${cutoff}</b>`,
        `Partidos: <b>${matches}</b> · Stats: <b>${Math.round(pctStats*100)}%</b> · Relato: <b>${Math.round(pctNarrative*100)}%</b> · Snapshots: <b>${Math.round(pctSnapshots*100)}%</b>`,
        `<b>Conozco al ${team?.name || "equipo"}: ${score}%</b>`,
        "Estoy usando los datos desde el perfil del equipo.",
        `Cobertura: ${coverage.toFixed(2)} · Recencia: ${recency.toFixed(2)} (hace ${daysSinceLast} días) · Completitud: ${completeness.toFixed(2)} · Consistencia: ${consistency.toFixed(2)}`,
        `Checks críticos → missingCriticalRate: ${missingCriticalRate.toFixed(2)} · duplicateMatchIdRate: ${duplicateMatchIdRate.toFixed(2)} · unorderedDateRate: ${unorderedDateRate.toFixed(2)}`
      ].join("<br>");
    }

    function fillBrainMetricsFromTeam(teamId, leagueId, side = "A"){
      const team = db.teams.find((row)=>row.id===teamId);
      const statusEl = brainSelectors[side]?.status;
      if(!team){
        if(statusEl) statusEl.textContent = "❌ Equipo no encontrado.";
        return;
      }
      const modeMeta = getBrainModeMeta();
      const historicalTracker = modeMeta.mode === "historico"
        ? filterTrackerBeforeDate(db.tracker, modeMeta.historicalDate)
        : db.tracker;
      const dbForCalc = modeMeta.mode === "historico"
        ? { ...db, tracker: historicalTracker }
        : db;
      const intel = computeTeamIntelligencePanel(dbForCalc, teamId);
      const momentumSigned = clamp((Number(intel.metrics?.momentum5) || 0.5) * 2 - 1, -1, 1);
      const ajusteContextual = obtenerAjusteContextual(db, teamId);

      const recentFeatureWindow = getRecentTeamFeatureWindow(teamId, {
        tracker: historicalTracker,
        historicalDate: modeMeta.mode === "historico" ? modeMeta.historicalDate : ""
      });
      const featureSource = recentFeatureWindow?._source || "baseline";
      const featuresSummary = summarizeTeamFeatureWindow(recentFeatureWindow);

      const pulseBase = Number.isFinite(featuresSummary?.pulse)
        ? featuresSummary.pulse
        : (intel.psych?.playerPulse ?? 50);
      const fatigaBase = Number.isFinite(featuresSummary?.fatiga)
        ? featuresSummary.fatiga
        : (intel.psych?.fatigue ?? 40);
      const resilienciaBase = Number.isFinite(featuresSummary?.resiliencia)
        ? featuresSummary.resiliencia
        : (intel.psych?.resilience ?? 50);
      const agresividadBase = Number.isFinite(featuresSummary?.agresividad)
        ? featuresSummary.agresividad
        : (intel.psych?.aggressiveness ?? 50);
      const volatilidadBase = Number.isFinite(featuresSummary?.volatilidad)
        ? featuresSummary.volatilidad
        : (intel.psych?.volatility ?? 50);
      const descansoBase = Number.isFinite(featuresSummary?.descanso)
        ? featuresSummary.descanso
        : restDaysForTeam(teamId, {
          tracker: historicalTracker,
          referenceDate: modeMeta.mode === "historico" ? modeMeta.historicalDate : ""
        });
      const momentumBase = Number.isFinite(featuresSummary?.momentum)
        ? featuresSummary.momentum
        : momentumSigned;

      const pulseAjustado = clamp(pulseBase + ajusteContextual.pulse * 100, 0, 100);
      const resilienciaAjustada = clamp(resilienciaBase + ajusteContextual.resiliencia * 100, 0, 100);
      const agresividadAjustada = clamp(agresividadBase + ajusteContextual.agresividad * 100, 0, 100);

      setInputValue(`brainPulse${side}`, pulseAjustado);
      setInputValue(`brainFatiga${side}`, fatigaBase);
      setInputValue(`brainResiliencia${side}`, resilienciaAjustada);
      setInputValue(`brainAgresividad${side}`, agresividadAjustada);
      setInputValue(`brainVolatilidad${side}`, volatilidadBase);
      setInputValue(`brainEdad${side}`, clamp(Number.isFinite(featuresSummary?.edadMedia) ? featuresSummary.edadMedia : avgAgeForTeam(teamId), 17, 40));
      setInputValue(`brainImportancia${side}`, estimatedTournamentImportance(leagueId), 2);
      setInputValue(`brainDescanso${side}`, descansoBase);
      setInputValue(`brainMomentum${side}`, momentumBase, 2);

      if(statusEl){
        if(featuresSummary && featureSource === "team_profile"){
          const quality = {
            sampleSize: featuresSummary.sampleSize,
            rangeFrom: recentFeatureWindow?.[0]?.date || "-",
            rangeTo: featuresSummary.latestDate || "-",
            score: Math.round((Number(intel?.metrics?.consistencyScore) || 0)),
            coverage: clamp((featuresSummary.sampleSize || 0) / 20, 0, 1),
            recency: clamp(Math.exp(-(Number.isFinite(featuresSummary.daysSinceLast) ? featuresSummary.daysSinceLast : 0) / 30), 0, 1),
            daysSinceLast: Number.isFinite(featuresSummary.daysSinceLast) ? featuresSummary.daysSinceLast : 0,
            completeness: 1,
            consistency: clamp((Number(intel?.metrics?.consistencyScore) || 0) / 100, 0, 1),
            pctStats: 1,
            pctNarrative: 1,
            pctSnapshots: 1,
            missingCriticalRate: 0,
            duplicateMatchIdRate: 0,
            unorderedDateRate: 0
          };
          statusEl.innerHTML = buildTeamProfileStatusHtml(team, teamId, quality);
        }else{
          const snapshotSourceMsg = featuresSummary
            ? `Métricas únicas activas: promedio de ${featuresSummary.sampleSize} partido(s)${featuresSummary.latestDate ? ` (último ${featuresSummary.latestDate})` : ""}.`
            : "Métricas únicas: sin snapshots calculados, usando baseline psicométrico.";
          statusEl.textContent = `✅ Métricas cargadas para ${team.name}. ${snapshotSourceMsg} Ajuste contextual -> pulse ${(ajusteContextual.pulse*100).toFixed(0)} pts, resiliencia ${(ajusteContextual.resiliencia*100).toFixed(0)} pts, agresividad ${(ajusteContextual.agresividad*100).toFixed(0)} pts. ${describeBrainAutoloadSources(teamId, leagueId, intel, momentumSigned, {
            tracker: historicalTracker,
            historicalDate: modeMeta.mode === "historico" ? modeMeta.historicalDate : ""
          })}`;
        }
      }
    }

    function pickNarrativeVariant(variants, seed = 0){
      if(!Array.isArray(variants) || !variants.length) return "";
      const idx = Math.abs(Math.round(seed * 1000)) % variants.length;
      return variants[idx] || variants[0];
    }

    function classifyRacha(rachaText){
      const text = String(rachaText || "").toLowerCase();
      const losingStreak = text.match(/(\d+)\s*(partidos?)?\s*(sin ganar|derrotas?)/i);
      if(losingStreak && Number(losingStreak[1]) >= 3) return "critica";
      if(/gan[óo]|victorias?|invicto|momentum|positiv/i.test(text)) return "ascendente";
      return "estable";
    }

    function getBestSpanishVoice(){
      const synth = window.speechSynthesis;
      if(!synth?.getVoices) return null;
      const voces = synth.getVoices() || [];
      return voces.find((voice)=>/natural/i.test(voice.name) && /^es(-|_)/i.test(voice.lang || ""))
        || voces.find((voice)=>/google/i.test(voice.name) && /^es(-|_)/i.test(voice.lang || ""))
        || voces.find((voice)=>/^es(-|_)/i.test(voice.lang || ""))
        || voces[0]
        || null;
    }

    function locutorAnalista(texto){
      if(!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined"){
        console.error("Tu navegador no soporta salida de voz.");
        return;
      }
      const frase = String(texto || "").trim();
      if(!frase) return;

      window.speechSynthesis.cancel();
      const lectura = new SpeechSynthesisUtterance(frase);
      lectura.lang = "es-ES";
      lectura.pitch = 0.85;
      lectura.rate = 0.95;
      lectura.volume = 1;

      const voz = getBestSpanishVoice();
      if(voz) lectura.voice = voz;

      window.speechSynthesis.speak(lectura);
    }

    function leerInformeActual(){
      const texto = document.getElementById("reporte-texto")?.textContent || "";
      locutorAnalista(texto);
    }

    if(window.speechSynthesis && typeof window.speechSynthesis.onvoiceschanged !== "undefined"){
      window.speechSynthesis.onvoiceschanged = ()=>{
        getBestSpanishVoice();
      };
    }

    function synthesizeMatchReport(homeTeam, awayTeam, cortexData = {}){
      const victoriaIA = clamp(Number(cortexData.victoriaIA) || 0, 0, 1);
      const edge = Number(cortexData.edge) || 0;
      const ventaja = Number(cortexData.ventaja) || 0;
      const peligro = clamp(Number(cortexData.peligro) || 0, 0, 1);
      const scoreHome = Number(cortexData.scoreHome) || 0;
      const scoreAway = Number(cortexData.scoreAway) || 0;
      const scoreDiff = scoreHome - scoreAway;
      const ctxHome = homeTeam?.contextoEstrategico || {};
      const ctxAway = awayTeam?.contextoEstrategico || {};
      const homeName = homeTeam?.name || "Equipo A";
      const awayName = awayTeam?.name || "Equipo B";

      const rachaTipo = classifyRacha(ctxHome.rachaLocal);
      const alertaRachaTpl = NARRATIVA_SINTESIS.alertasRacha[rachaTipo] || NARRATIVA_SINTESIS.alertasRacha.estable;
      const alertaRacha = alertaRachaTpl.replace("{racha}", String(ctxHome.rachaLocal || "3"));
      const connectorA = pickNarrativeVariant(NARRATIVA_SINTESIS.conectores, victoriaIA + peligro);
      const connectorB = pickNarrativeVariant(NARRATIVA_SINTESIS.conectores, edge + Math.abs(ventaja));
      const escenarioVictoria = pickNarrativeVariant(NARRATIVA_SINTESIS.escenariosVictoria, victoriaIA)
        .replace("{percent}", (victoriaIA * 100).toFixed(0));

      const contexto = `Contexto: duelo de realidades cruzadas entre ${homeName} y ${awayName}. ${homeName} intenta imponer localía mientras ${awayName} llega con presión competitiva.`;
      const formaActual = `Forma Actual: ${homeName} ${escenarioVictoria}. ${connectorA}, ${alertaRacha}.`;
      const historico = `Histórico: ${homeName} reporta racha local "${ctxHome.rachaLocal || "sin datos suficientes"}" y ${awayName} responde con patrón "${(ctxAway.patrones || ["sin patrón dominante"])[0]}".`;
      const factorX = `Factor X: las ausencias clave del local (${(ctxHome.ausenciasClave || []).join(", ") || "sin bajas críticas"}) y el asedio narrativo (${(peligro * 100).toFixed(0)}%) inclinan el ritmo del partido.`;
      const partidoLiquidado = scoreDiff >= 2
        ? `Con el segundo gol, el escenario cambia por completo. El patrón de racha queda oficialmente anulado por la realidad del marcador (${scoreHome}-${scoreAway}). Mi confianza en la victoria local sube al ${(victoriaIA * 100).toFixed(0)}%. El riesgo ahora es únicamente la fatiga acumulada (${peligro.toFixed(2)}).`
        : "";

      let veredicto = "Veredicto: ";
      if(edge > 0.05){
        veredicto += `${connectorB}, hay valor fuera del mercado principal: ${edge > 0.1 ? "Doble Oportunidad" : "Hándicap"} a favor de ${ventaja >= 0 ? homeName : awayName}.`;
      }else{
        veredicto += "el mercado está razonablemente ajustado y la lectura recomienda cautela pre-partido.";
      }

      return [contexto, formaActual, historico, factorX, partidoLiquidado, veredicto].filter(Boolean).join("\n\n");
    }

    function renderBrainTeamOptions(leagueId, side = "A"){
      const teamSelect = brainSelectors[side]?.team;
      if(!teamSelect) return;
      const teams = getTeamsForLeague(db, leagueId)
        .slice()
        .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      teamSelect.innerHTML = teams.length
        ? teams.map((team)=>`<option value="${team.id}">${team.name}</option>`).join("")
        : `<option value="">Sin equipos en esta liga</option>`;
      teamSelect.disabled = !teams.length;
    }

    function initBrainSelectorState(){
      const leagues = db.leagues
        .slice()
        .sort((a,b)=>String(a.name).localeCompare(String(b.name), "es", { sensitivity:"base" }));
      const fallbackLeagueId = leagues[0]?.id || "";
      const preferredLeagueId = leagues.some((league)=>league.id===db.settings.selectedLeagueId)
        ? db.settings.selectedLeagueId
        : fallbackLeagueId;
      ["A", "B"].forEach((side)=>{
        const leagueSelect = brainSelectors[side]?.league;
        if(!leagueSelect) return;
        leagueSelect.innerHTML = leagues.length
          ? leagues.map((league)=>`<option value="${league.id}">${league.name}</option>`).join("")
          : `<option value="">Sin ligas</option>`;
        leagueSelect.disabled = !leagues.length;
        if(preferredLeagueId) leagueSelect.value = preferredLeagueId;
        renderBrainTeamOptions(leagueSelect.value || preferredLeagueId, side);
      });
    }

    function normBrain(value, min, max){
      if(max===min) return 0;
      return Math.min(1, Math.max(0, (value - min) / (max - min)));
    }

    function getBrainVector(side = "A"){
      const pulse        = parseFloat(document.getElementById(`brainPulse${side}`).value)       || 0;
      const fatiga       = parseFloat(document.getElementById(`brainFatiga${side}`).value)      || 0;
      const resiliencia  = parseFloat(document.getElementById(`brainResiliencia${side}`).value) || 0;
      const agresividad  = parseFloat(document.getElementById(`brainAgresividad${side}`).value) ?? 50;
      const volatilidad  = parseFloat(document.getElementById(`brainVolatilidad${side}`).value) ?? 50;
      const edadMedia    = parseFloat(document.getElementById(`brainEdad${side}`).value)        || 26;
      const importancia  = parseFloat(document.getElementById(`brainImportancia${side}`).value) || 0.5;
      const diasDescanso = parseFloat(document.getElementById(`brainDescanso${side}`).value)    || 3;
      const momentum     = parseFloat(document.getElementById(`brainMomentum${side}`).value)    || 0;

      return [
        normBrain(pulse,       0, 100),
        normBrain(fatiga,      0, 100),
        normBrain(resiliencia, 0, 100),
        normBrain(agresividad, 0, 100),
        normBrain(volatilidad, 0, 100),
        normBrain(edadMedia,  17,  40),
        Math.min(1, Math.max(0, importancia)),
        normBrain(diasDescanso, 0, 14),
        normBrain(momentum,    -1,  1),
      ];
    }

    function getNarrativeMetrics(side = "A"){
      const texto = document.getElementById(`brainRelato${side}`)?.value || "";
      return extraerMetricasDelRelato(texto);
    }


    let brainModel = null;
    let ultimaMuestra = null;
    const brainTrainingHistory = [];
    const brainLossHistory = [];
    let latestPredictionConfidence = null;
    const brainTrainingContext = { mode: "pre", historicalDate: "" };
    const BRAIN_SNAPSHOTS_KEY_BASE = "brain-memory-carl-snapshots-v2";
    const BRAIN_LOSS_KEY_BASE = "brain-memory-carl-loss-v2";
    let activeBrainProfileId = "global";
    const BRAIN_WINDOW = 5;
    const BRAIN_VECTOR_SIZE = 9;
    const BRAIN_CONTEXT_SIZE = 3;
    const BRAIN_INPUT_SIZE = (BRAIN_WINDOW * BRAIN_VECTOR_SIZE * 2) + BRAIN_CONTEXT_SIZE;

    function toISODate(value){
      const raw = String(value || "").trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const parsed = new Date(raw);
      if(Number.isNaN(parsed.getTime())) return "";
      return parsed.toISOString().slice(0, 10);
    }

    function resolveMatchDate(modeMeta){
      const historical = modeMeta?.mode === "historico" ? toISODate(modeMeta?.historicalDate) : "";
      if(historical) return historical;
      return new Date().toISOString().slice(0, 10);
    }

    function buildContextVector({ mode = "pre", homeVector = [], awayVector = [] } = {}){
      const homeAdvantage = clamp((Number(db?.versus?.homeAdvantage) || 1.1) / 2, 0, 1);
      const modePressure = mode === "live" ? 1 : mode === "historico" ? 0.35 : 0.55;
      const importanceDelta = clamp(((Number(homeVector?.[6]) || 0.5) - (Number(awayVector?.[6]) || 0.5) + 1) / 2, 0, 1);
      return [homeAdvantage, modePressure, importanceDelta];
    }

    function createZeroVector(){
      return Array(BRAIN_VECTOR_SIZE).fill(0);
    }

    function buildTeamSequenceFromSamples(samples, teamId, targetMatchDate, currentVector){
      const safeDate = toISODate(targetMatchDate) || "9999-12-31";
      const history = (samples || [])
        .filter((sample)=>{
          if(!sample?.teamVectors || !teamId) return false;
          const rowDate = toISODate(sample.matchDate);
          return !!sample.teamVectors[teamId] && !!rowDate && rowDate < safeDate;
        })
        .sort((a,b)=>{
          const dCmp = String(a.matchDate || "").localeCompare(String(b.matchDate || ""));
          if(dCmp!==0) return dCmp;
          return (Number(a.capturedAt) || 0) - (Number(b.capturedAt) || 0);
        })
        .map((sample)=>sample.teamVectors[teamId].slice(0, BRAIN_VECTOR_SIZE));
      const merged = currentVector ? [...history, currentVector.slice(0, BRAIN_VECTOR_SIZE)] : history;
      const cut = merged.slice(-BRAIN_WINDOW);
      while(cut.length < BRAIN_WINDOW) cut.unshift(createZeroVector());
      return cut;
    }

    function flattenBrainInput(seqA, seqB, context = []){
      return [...seqA.flat(), ...seqB.flat(), ...context].slice(0, BRAIN_INPUT_SIZE);
    }

    function normalizeBrainSample(raw){
      if(!raw || typeof raw !== "object") return null;
      const normalized = {
        ...raw,
        x: Array.isArray(raw.x) ? raw.x.map(Number).filter((n)=>Number.isFinite(n)) : [],
        y: Array.isArray(raw.y) ? raw.y.map(Number).slice(0, 3) : []
      };
      if(normalized.x.length !== BRAIN_INPUT_SIZE || normalized.y.length !== 3) return null;
      normalized.matchDate = toISODate(raw.matchDate || raw?.meta?.historicalDate || raw?.meta?.matchDate) || resolveMatchDate(raw?.meta || {});
      normalized.capturedAt = Number(raw.capturedAt || raw.createdAt || Date.now()) || Date.now();
      return normalized;
    }

    function getBrainProfileId(){
      const teamA = brainSelectors?.A?.team?.value || "";
      const leagueA = brainSelectors?.A?.league?.value || "";
      if(teamA) return `team-${teamA}`;
      if(leagueA) return `league-${leagueA}`;
      return "global";
    }

    function getBrainTelemetryKeys(profileId = activeBrainProfileId){
      return {
        snapshotsKey: `${BRAIN_SNAPSHOTS_KEY_BASE}-${profileId}`,
        lossKey: `${BRAIN_LOSS_KEY_BASE}-${profileId}`
      };
    }

    function restoreBrainTelemetry(profileId = activeBrainProfileId){
      const { snapshotsKey, lossKey } = getBrainTelemetryKeys(profileId);
      const rawSnapshots = localStorage.getItem(snapshotsKey);
      const rawLoss = localStorage.getItem(lossKey);
      const snapshots = Array.isArray(safeParseJSON(rawSnapshots, []))
        ? safeParseJSON(rawSnapshots, []).map(normalizeBrainSample).filter(Boolean).slice(0, 120)
        : [];
      const losses = Array.isArray(safeParseJSON(rawLoss, []))
        ? safeParseJSON(rawLoss, []).map(Number).filter((n)=>Number.isFinite(n)).slice(-30)
        : [];
      brainTrainingHistory.splice(0, brainTrainingHistory.length, ...snapshots);
      brainLossHistory.splice(0, brainLossHistory.length, ...losses);
    }

    function persistBrainTelemetry(profileId = activeBrainProfileId){
      try{
        const { snapshotsKey, lossKey } = getBrainTelemetryKeys(profileId);
        localStorage.setItem(snapshotsKey, JSON.stringify(brainTrainingHistory.slice(0, 120)));
        localStorage.setItem(lossKey, JSON.stringify(brainLossHistory.slice(-30)));
      }catch(_err){
        // fallback silencioso: no bloquear la UI por cuota.
      }
    }

    function switchBrainProfile(nextProfileId = getBrainProfileId()){
      const resolved = nextProfileId || "global";
      if(resolved === activeBrainProfileId) return;
      persistBrainTelemetry(activeBrainProfileId);
      activeBrainProfileId = resolved;
      restoreBrainTelemetry(activeBrainProfileId);
      renderSnapshots();
      renderLossChart();
      renderBrainHealthCheck(`🧠 Perfil activo: <b>${activeBrainProfileId}</b>.`);
    }

    function computePredictionConfidence(prediction){
      if(!Array.isArray(prediction) || !prediction.length) return 0;
      const probs = prediction.map((v)=>Math.max(0, Number(v) || 0));
      const sum = probs.reduce((acc, v)=>acc + v, 0) || 1;
      const normalized = probs.map((v)=>v / sum);
      const entropy = -normalized.reduce((acc, p)=>acc + (p > 0 ? p * Math.log(p) : 0), 0);
      const maxEntropy = Math.log(normalized.length || 1);
      const certainty = maxEntropy > 0 ? 1 - (entropy / maxEntropy) : 0;
      const margin = Math.max(0, ...normalized) - [...normalized].sort((a,b)=>b-a)[1];
      return Math.max(0, Math.min(1, 0.75 * certainty + 0.25 * margin));
    }

    function getHealthCheck(){
      const snapshots = brainTrainingHistory.length;
      const losses = brainLossHistory.slice(-8);
      const latestLoss = losses.at(-1);
      const prevLoss = losses[0];
      const trend = (Number.isFinite(latestLoss) && Number.isFinite(prevLoss)) ? latestLoss - prevLoss : null;
      const capacityPct = Math.min(100, Math.round((snapshots / 120) * 100));
      const confidence = Math.round(((latestPredictionConfidence ?? 0) * 100));
      const quality = Number.isFinite(latestLoss)
        ? latestLoss < 0.35 ? "alta" : latestLoss < 0.7 ? "media" : "baja"
        : "sin datos";
      return {
        snapshots,
        capacityPct,
        latestLoss,
        trend,
        confidence,
        quality,
        ready: !!brainModel,
        profileId: activeBrainProfileId
      };
    }

    function renderBrainHealthCheck(extra = ""){
      const el = document.getElementById("brainHealthCheck");
      if(!el) return;
      const health = getHealthCheck();
      const trendText = health.trend == null
        ? "sin histórico suficiente"
        : health.trend < 0
          ? `mejora (${health.trend.toFixed(4)})`
          : health.trend > 0
            ? `empeora (+${health.trend.toFixed(4)})`
            : "estable";
      const modelState = health.ready ? "🟢 Modelo activo" : "🟡 Modelo no inicializado";
      const lossText = Number.isFinite(health.latestLoss) ? health.latestLoss.toFixed(4) : "n/a";
      el.innerHTML = [
        `<div>${modelState}</div>`,
        `<div>Perfil de memoria: <b>${health.profileId}</b>.</div>`,
        `<div>Capacidad usada: <b>${health.capacityPct}%</b> (${health.snapshots}/120 snapshots locales).</div>`,
        `<div>Loss reciente: <b>${lossText}</b> · tendencia: <b>${trendText}</b> · calidad: <b>${health.quality}</b>.</div>`,
        `<div>Confianza de predicción (entropía+margen): <b>${health.confidence}%</b>.</div>`,
        extra ? `<div style="color:#58a6ff;">${extra}</div>` : ""
      ].filter(Boolean).join("");
    }

    function toBase64FromArrayBuffer(buffer){
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for(let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    function fromBase64ToArrayBuffer(base64){
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for(let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    async function computeChecksum(text){
      if(typeof crypto === "undefined" || !crypto?.subtle){
        let hash = 0;
        for(let i = 0; i < text.length; i += 1){
          hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return `fallback-${Math.abs(hash)}`;
      }
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2, "0")).join("");
    }

    function syncBrainModelGlobal(model){
      ensureBrainModelCompiled(model);
      brainModel = model || null;
      if(typeof globalThis !== "undefined"){
        globalThis.modelo = brainModel;
      }
      renderBrainHealthCheck();
    }

    function ensureBrainModelCompiled(model){
      if(typeof tf === "undefined" || !model || typeof model.compile !== "function") return;
      if(model.optimizer) return;
      model.compile({ optimizer: tf.train.adam(0.002), loss: "categoricalCrossentropy", metrics: ["accuracy"] });
    }

    function brainModelInputSize(model){
      const shape = model?.inputs?.[0]?.shape;
      if(!Array.isArray(shape) || shape.length < 2) return null;
      return Number(shape[shape.length - 1]) || null;
    }

    async function createTemporalBrainModel(){
      const model = tf.sequential();
      model.add(tf.layers.dense({
        inputShape: [BRAIN_INPUT_SIZE],
        units: 96,
        activation: "relu",
        name: "percepcion_inicial"
      }));
      model.add(tf.layers.dropout({ rate: 0.18, name: "drop_regularizacion" }));
      model.add(tf.layers.dense({ units: 32, activation: "relu", name: "fusion_temporal" }));
      model.add(tf.layers.dense({ units: 3, activation: "softmax", name: "salida_partido" }));
      model.compile({ optimizer: tf.train.adam(0.002), loss: "categoricalCrossentropy", metrics: ["accuracy"] });
      return model;
    }

    async function bootstrapBrainModel(statusEl){
      if(typeof tf === "undefined") return;
      if(brainModel) return;
      const estado = statusEl || document.getElementById("brainModelStatus");
      const globalModel = (typeof globalThis !== "undefined") ? globalThis.modelo : null;
      if(globalModel){
        syncBrainModelGlobal(globalModel);
        if(estado) estado.textContent = "✅ Modelo conectado desde globalThis.modelo.";
        return;
      }
      try{
        const restoredModel = await tf.loadLayersModel("localstorage://brain-memory-carl");
        if(brainModelInputSize(restoredModel) !== BRAIN_INPUT_SIZE){
          const temporalModel = await createTemporalBrainModel();
          syncBrainModelGlobal(temporalModel);
          if(estado) estado.textContent = `♻️ Modelo restaurado incompatible (${brainModelInputSize(restoredModel) || "?"}). Se migró a temporal-safe ${BRAIN_INPUT_SIZE}.`;
        }else{
          syncBrainModelGlobal(restoredModel);
          if(estado) estado.textContent = "✅ Modelo restaurado automáticamente desde localStorage.";
        }
      }catch(_err){
        // El modelo aún no existe en localStorage: se creará manualmente al inicializar.
      }
    }

    function oneHotResultado(valor){
      if(valor === "local") return [1,0,0];
      if(valor === "empate") return [0,1,0];
      return [0,0,1];
    }

    function getBrainModeMeta(){
      const modeEl = document.getElementById("brainTrainingMode");
      const dateEl = document.getElementById("brainHistoricalDate");
      const mode = modeEl?.value || "pre";
      const historicalDate = String(dateEl?.value || "").trim();
      return {
        mode,
        historicalDate,
        modeLabel: mode === "live" ? "Live" : mode === "historico" ? "Histórico" : "Pre-Partido"
      };
    }

    function refreshBrainModeUI(){
      const { mode } = getBrainModeMeta();
      const wrap = document.getElementById("brainHistoricalDateWrap");
      if(wrap) wrap.style.display = mode === "historico" ? "inline-flex" : "none";
    }

    function renderSnapshots(){
      const el = document.getElementById("brainSnapshots");
      if(!el) return;
      if(!brainTrainingHistory.length){
        el.innerHTML = "Sin snapshots todavía. Procesa un vector y luego valida.";
        return;
      }
      el.innerHTML = brainTrainingHistory.map((muestra, idx)=>{
        const clase = muestra.y[0] ? "Local" : muestra.y[1] ? "Empate" : "Visitante";
        const metaMode = muestra?.meta?.modeLabel || "Pre-Partido";
        const metaDate = muestra?.meta?.historicalDate ? ` · ${muestra.meta.historicalDate}` : "";
        const matchDate = muestra.matchDate ? ` · matchDate ${muestra.matchDate}` : "";
        return `<div>#${idx+1} · ${metaMode}${metaDate}${matchDate} · ${clase} · x=[${muestra.x.slice(0, 12).map(v=>v.toFixed(2)).join(", ")}${muestra.x.length>12?", …":""}]</div>`;
      }).join("");
      persistBrainTelemetry();
      renderBrainHealthCheck();
    }

    function renderLossChart(){
      const chart = document.getElementById("brainLossChart");
      if(!chart) return;
      if(!brainLossHistory.length){
        chart.innerHTML = `<div class="fl-muted" style="font-size:12px;padding:8px;">Aún no hay entrenamientos.</div>`;
        return;
      }
      const w = 340;
      const h = 78;
      const min = Math.min(...brainLossHistory);
      const max = Math.max(...brainLossHistory);
      const span = Math.max(0.0001, max - min);
      const points = brainLossHistory.map((loss, i)=>{
        const x = (i / Math.max(1, brainLossHistory.length - 1)) * (w - 10) + 5;
        const y = h - (((loss - min) / span) * (h - 10) + 5);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(" ");
      chart.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">
        <polyline fill="none" stroke="#58a6ff" stroke-width="2" points="${points}" />
        <text x="6" y="12" fill="#9ca3af" font-size="10">min ${min.toFixed(4)}</text>
        <text x="6" y="24" fill="#9ca3af" font-size="10">max ${max.toFixed(4)}</text>
      </svg>`;
      persistBrainTelemetry();
      renderBrainHealthCheck();
    }

    async function persistBrainModel(statusEl){
      await brainModel.save("localstorage://brain-memory-carl");
      statusEl.textContent = "💾 Modelo actualizado y persistido en localstorage://brain-memory-carl";
    }

    async function aprenderConMuestra(muestra){
      ensureBrainModelCompiled(brainModel);
      const xs = tf.tensor2d([muestra.x]);
      const ys = tf.tensor2d([muestra.y]);
      const history = await brainModel.fit(xs, ys, {
        epochs: 5,
        shuffle: true,
        verbose: 0
      });
      xs.dispose();
      ys.dispose();
      const loss = history?.history?.loss?.at(-1);
      if(Number.isFinite(loss)){
        brainLossHistory.push(loss);
        if(brainLossHistory.length > 30) brainLossHistory.shift();
      }
      renderLossChart();
      return loss;
    }

    initBrainSelectorState();
    activeBrainProfileId = getBrainProfileId();
    restoreBrainTelemetry(activeBrainProfileId);
    renderSnapshots();
    renderLossChart();
    refreshBrainModeUI();
    bootstrapBrainModel();
    renderBrainHealthCheck();

    document.getElementById("brainTrainingMode")?.addEventListener("change", ()=>{
      const meta = getBrainModeMeta();
      brainTrainingContext.mode = meta.mode;
      brainTrainingContext.historicalDate = meta.historicalDate;
      refreshBrainModeUI();
    });

    document.getElementById("brainHistoricalDate")?.addEventListener("change", ()=>{
      const meta = getBrainModeMeta();
      brainTrainingContext.historicalDate = meta.historicalDate;
    });

    document.getElementById("brainResetMemory")?.addEventListener("click", async ()=>{
      const statusEl = document.getElementById("brainModelStatus");
      const ok = confirm("¿Reiniciar el cerebro? Se borrará el modelo local, snapshots y curva de loss.");
      if(!ok) return;
      try{
        if(typeof tf !== "undefined"){
          try{ await tf.io.removeModel("localstorage://brain-memory-carl"); }catch(_err){ /* modelo no existía */ }
        }
        if(brainModel && typeof brainModel.dispose === "function"){
          brainModel.dispose();
        }
        syncBrainModelGlobal(null);
        ultimaMuestra = null;
        latestPredictionConfidence = null;
        brainTrainingHistory.splice(0, brainTrainingHistory.length);
        brainLossHistory.splice(0, brainLossHistory.length);
        const { snapshotsKey, lossKey } = getBrainTelemetryKeys(activeBrainProfileId);
        localStorage.removeItem(snapshotsKey);
        localStorage.removeItem(lossKey);
        const modeEl = document.getElementById("brainTrainingMode");
        const dateEl = document.getElementById("brainHistoricalDate");
        if(modeEl) modeEl.value = "pre";
        if(dateEl) dateEl.value = "";
        brainTrainingContext.mode = "pre";
        brainTrainingContext.historicalDate = "";
        refreshBrainModeUI();
        renderSnapshots();
        renderLossChart();
        renderBrainHealthCheck("🧹 Cerebro reiniciado. Listo para entrenar limpio por modos.");
        if(statusEl) statusEl.textContent = "✅ Cerebro reiniciado: modelo y memoria local eliminados.";
      }catch(err){
        if(statusEl) statusEl.textContent = `❌ No se pudo reiniciar: ${err.message}`;
      }
    });

    document.getElementById("brainExportMemory")?.addEventListener("click", async ()=>{
      const statusEl = document.getElementById("brainModelStatus");
      if(typeof tf === "undefined" || !brainModel){
        statusEl.textContent = "❌ Inicializa el modelo antes de exportar.";
        return;
      }
      try{
        statusEl.textContent = "⏳ Exportando memoria del brain...";
        let artifacts = null;
        await brainModel.save(tf.io.withSaveHandler(async (modelArtifacts)=>{
          artifacts = modelArtifacts;
          return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON", modelTopologyBytes: 0, weightDataBytes: modelArtifacts?.weightData?.byteLength || 0 } };
        }));
        if(!artifacts){
          throw new Error("No se pudieron obtener artefactos del modelo.");
        }
        const payloadBase = {
          version: 1,
          exportedAt: new Date().toISOString(),
          modelTopology: artifacts.modelTopology,
          weightSpecs: artifacts.weightSpecs || [],
          weightDataBase64: toBase64FromArrayBuffer(artifacts.weightData || new ArrayBuffer(0)),
          trainingConfig: artifacts.trainingConfig || null,
          userDefinedMetadata: artifacts.userDefinedMetadata || null,
          snapshots: brainTrainingHistory.slice(0, 10),
          lossHistory: brainLossHistory.slice(-30),
          lastPredictionConfidence: latestPredictionConfidence
        };
        const checksum = await computeChecksum(JSON.stringify(payloadBase));
        const payload = { ...payloadBase, checksum };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `brain-memory-carl-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        renderBrainHealthCheck(`📤 Export OK · checksum ${checksum.slice(0, 12)}… · snapshots ${payload.snapshots.length}.`);
        statusEl.textContent = "✅ Memoria exportada. Guarda el JSON para evitar pérdidas.";
      }catch(err){
        statusEl.textContent = `❌ Error al exportar: ${err.message}`;
      }
    });

    document.getElementById("brainImportMemory")?.addEventListener("click", ()=>{
      document.getElementById("brainImportFile")?.click();
    });

    document.getElementById("brainImportFile")?.addEventListener("change", async (event)=>{
      const statusEl = document.getElementById("brainModelStatus");
      const input = event.target;
      const file = input?.files?.[0];
      if(!file) return;
      if(typeof tf === "undefined"){
        statusEl.textContent = "❌ TensorFlow.js no disponible para importar.";
        return;
      }
      try{
        statusEl.textContent = "⏳ Importando memoria...";
        const raw = await file.text();
        const payload = safeParseJSON(raw, null);
        if(!payload || !payload.modelTopology || !payload.weightDataBase64){
          throw new Error("Archivo inválido: falta topología o pesos.");
        }
        const expectedChecksum = payload.checksum;
        const { checksum: _checksum, ...basePayload } = payload;
        const currentChecksum = await computeChecksum(JSON.stringify(basePayload));
        const checksumMatch = !expectedChecksum || expectedChecksum === currentChecksum;
        const model = await tf.loadLayersModel(tf.io.fromMemory({
          modelTopology: payload.modelTopology,
          weightSpecs: payload.weightSpecs || [],
          weightData: fromBase64ToArrayBuffer(payload.weightDataBase64),
          trainingConfig: payload.trainingConfig || null,
          userDefinedMetadata: payload.userDefinedMetadata || null
        }));
        syncBrainModelGlobal(model);
        brainTrainingHistory.splice(0, brainTrainingHistory.length, ...((payload.snapshots || []).slice(0, 10)));
        brainLossHistory.splice(0, brainLossHistory.length, ...((payload.lossHistory || []).slice(-30)));
        const importedConfidence = Number(payload.lastPredictionConfidence);
        latestPredictionConfidence = Number.isFinite(importedConfidence) ? importedConfidence : null;
        renderSnapshots();
        renderLossChart();
        persistBrainTelemetry();
        await persistBrainModel(statusEl);
        const importedChecksum = await computeChecksum(JSON.stringify(basePayload));
        const postImportMatch = importedChecksum === currentChecksum;
        const integrityMsg = checksumMatch && postImportMatch
          ? "Integridad validada: no se perdió información."
          : "Importado con advertencia: checksum no coincide.";
        renderBrainHealthCheck(`📥 Import OK · ${integrityMsg} · snapshots ${brainTrainingHistory.length}.`);
        statusEl.textContent = `✅ Memoria importada. ${integrityMsg}`;
      }catch(err){
        statusEl.textContent = `❌ Error al importar: ${err.message}`;
      }finally{
        if(input) input.value = "";
      }
    });

    ["A", "B"].forEach((side)=>{
      const cfg = brainSelectors[side];
      cfg.league.onchange = ()=>{
        renderBrainTeamOptions(cfg.league.value, side);
        cfg.status.textContent = "Liga actualizada. Selecciona equipo y carga datos.";
        if(side === "A"){
          switchBrainProfile(getBrainProfileId());
        }
      };

      cfg.team.onchange = ()=>{
        if(side === "A"){
          switchBrainProfile(getBrainProfileId());
        }
      };

      document.getElementById(`brainAutoload${side}`).onclick = ()=>{
        const leagueId = cfg.league.value || "";
        const teamId = cfg.team.value || "";
        if(!leagueId || !teamId){
          cfg.status.textContent = "❌ Selecciona primero una liga y un equipo.";
          return;
        }
        fillBrainMetricsFromTeam(teamId, leagueId, side);
      };
    });

    function calcularVentajaRelativa(prediccionA, prediccionB){
      const ventaja = (prediccionA?.[0] || 0) - (prediccionB?.[0] || 0);
      if(ventaja > 0.20){
        return {
          ventaja,
          mensaje: "🔥 VENTAJA DOMINANTE: Equipo A está muy por encima del estado físico/mental del Equipo B.",
          tono: "#3fb950"
        };
      }
      if(ventaja > 0){
        return {
          ventaja,
          mensaje: "⚖️ EQUILIBRIO: Equipo A está mejor, pero el Equipo B tiene capacidad de resistencia.",
          tono: "#f2cc60"
        };
      }
      return {
        ventaja,
        mensaje: "⚠️ ALERTA: El Equipo B está mostrando mejores métricas críticas que el Equipo A.",
        tono: "#f85149"
      };
    }

    document.getElementById("brainProcess").onclick = async ()=>{
      const vectorA = getBrainVector("A");
      const vectorB = getBrainVector("B");
      const relatoA = getNarrativeMetrics("A");
      const relatoB = getNarrativeMetrics("B");
      const textoRelatoA = document.getElementById("brainRelatoA")?.value || "";
      const textoRelatoB = document.getElementById("brainRelatoB")?.value || "";
      const marcadorRelatoA = extraerMarcadorDesdeRelato(textoRelatoA);
      const marcadorRelatoB = extraerMarcadorDesdeRelato(textoRelatoB);
      const marcadorVivo = marcadorRelatoA || marcadorRelatoB || { home: 0, away: 0 };
      const blendedA = [...vectorA];
      const blendedB = [...vectorB];
      blendedA[8] = Math.min(1, Math.max(0, (blendedA[8] + relatoA.peligro) / 2));
      blendedB[8] = Math.min(1, Math.max(0, (blendedB[8] + relatoB.peligro) / 2));
      blendedA[3] = Math.min(1, Math.max(0, (blendedA[3] + relatoA.agresividad) / 2));
      blendedB[3] = Math.min(1, Math.max(0, (blendedB[3] + relatoB.agresividad) / 2));

      if(relatoA.golesDetectados > 0 || relatoB.golesDetectados > 0){
        blendedA[8] = 0.5;
        blendedB[8] = 0.5;
        const golDiff = (Number(marcadorVivo.home) || 0) - (Number(marcadorVivo.away) || 0);
        const resilienciaDelta = clamp(golDiff * 0.10, -0.10, 0.10);
        blendedA[2] = clamp(blendedA[2] + resilienciaDelta, 0, 1);
        blendedB[2] = clamp(blendedB[2] - resilienciaDelta, 0, 1);
        blendedA[8] = Math.max(blendedA[8], 0.45 + Math.min(0.25, relatoA.peligro * 0.4));
        blendedB[8] = Math.max(blendedB[8], 0.45 + Math.min(0.25, relatoB.peligro * 0.4));
      }

      const monitor = document.getElementById("brainMonitor");
      monitor.style.display = "block";

      const dispLabels = [...LABELS];
      dispLabels[3] = "Agresividad+Relato";
      dispLabels[8] = "Momentum+Relato";
      const vecDisplay = document.getElementById("brainVectorDisplay");
      vecDisplay.innerHTML = ["A", "B"].map((side)=>{
        const vec = side === "A" ? blendedA : blendedB;
        const relato = side === "A" ? relatoA : relatoB;
        const items = dispLabels.map((lbl, i)=>{
          const val = vec[i];
          const pct = (val * 100).toFixed(0);
          const color = val >= 0.7 ? "#3fb950" : val >= 0.4 ? "#f2cc60" : "#f85149";
          return `<div class="fl-card" style="padding:8px;background:#111722;">
            <div class="fl-muted" style="font-size:11px;">${lbl}</div>
            <div style="font-size:20px;font-weight:900;color:${color};">${val.toFixed(2)}</div>
            <div style="height:6px;border-radius:999px;background:#0d1117;border:1px solid #2d333b;margin-top:4px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;border-radius:999px;background:${color};"></div>
            </div>
          </div>`;
        }).join("");
        return `<div class="fl-card" style="padding:10px;">
          <div style="font-weight:900;margin-bottom:8px;">Equipo ${side}</div>
          <div class="fl-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">${items}</div>
          <div class="fl-muted" style="margin-top:8px;">Relato (peligro/agresividad): <b>${relato.peligro.toFixed(2)}</b> / <b>${relato.agresividad.toFixed(2)}</b> · ventana ${relato.minutoMax || 90}' (x${relato.factorTiempo.toFixed(2)})</div>
        </div>`;
      }).join("");

      const modeMeta = getBrainModeMeta();
      const matchDate = resolveMatchDate(modeMeta);
      if(modeMeta.mode === "historico" && !toISODate(modeMeta.historicalDate)){
        document.getElementById("brainModelStatus").textContent = "❌ En modo Históricos debes indicar la fecha del partido.";
        return;
      }
      const teamAId = brainSelectors?.A?.team?.value || "";
      const teamBId = brainSelectors?.B?.team?.value || "";
      const seqA = buildTeamSequenceFromSamples(brainTrainingHistory, teamAId, matchDate, blendedA);
      const seqB = buildTeamSequenceFromSamples(brainTrainingHistory, teamBId, matchDate, blendedB);
      const contextVector = buildContextVector({ mode: modeMeta.mode, homeVector: blendedA, awayVector: blendedB });
      const combinedInput = flattenBrainInput(seqA, seqB, contextVector);

      document.getElementById("brainTensorDisplay").textContent =
        `A seq[${seqA.length}x${BRAIN_VECTOR_SIZE}] | B seq[${seqB.length}x${BRAIN_VECTOR_SIZE}] | ctx=[${contextVector.map(v=>v.toFixed(3)).join(", ")}]`;

      const resultadoReal = oneHotResultado(document.getElementById("brainResultadoReal").value);
      brainTrainingContext.mode = modeMeta.mode;
      brainTrainingContext.historicalDate = modeMeta.historicalDate;
      ultimaMuestra = {
        x: combinedInput,
        y: resultadoReal,
        createdAt: Date.now(),
        capturedAt: Date.now(),
        matchDate,
        teamAId,
        teamBId,
        seqA,
        seqB,
        context: contextVector,
        teamVectors: {
          ...(teamAId ? { [teamAId]: blendedA.slice(0, BRAIN_VECTOR_SIZE) } : {}),
          ...(teamBId ? { [teamBId]: blendedB.slice(0, BRAIN_VECTOR_SIZE) } : {})
        },
        meta: {
          mode: modeMeta.mode,
          modeLabel: modeMeta.modeLabel,
          historicalDate: modeMeta.mode === "historico" ? modeMeta.historicalDate : "",
          matchDate
        }
      };

      let predA = [0, 0, 0];
      let predB = [0, 0, 0];

      if(brainModel && typeof tf !== "undefined"){
        try{
          const tCombined = tf.tensor2d([combinedInput]);
          const pCombined = brainModel.predict(tCombined);
          const rawCombined = await pCombined.data();
          predA = ajustarPrediccionPorMarcador(Array.from(rawCombined), marcadorVivo.home, marcadorVivo.away);
          predB = [predA[2], predA[1], predA[0]];
          latestPredictionConfidence = (computePredictionConfidence(predA) + computePredictionConfidence(predB)) / 2;
          renderBrainHealthCheck();

          document.getElementById("brainModelOut").style.display = "block";
          document.getElementById("brainLayerOutput").textContent =
            `A [${predA.map(v=>v.toFixed(4)).join(", ")}] · B [${predB.map(v=>v.toFixed(4)).join(", ")}]`;

          const iaVictoriaEl = document.getElementById("cerebeloIAVictoria");
          const iaEmpateEl = document.getElementById("cerebeloIAEmpate");
          const iaDerrotaEl = document.getElementById("cerebeloIADerrota");
          if(iaVictoriaEl && iaEmpateEl && iaDerrotaEl){
            iaVictoriaEl.value = Number(predA[0] || 0).toFixed(2);
            iaEmpateEl.value = Number(predA[1] || 0).toFixed(2);
            iaDerrotaEl.value = Number(predA[2] || 0).toFixed(2);
          }

          tCombined.dispose();
          pCombined.dispose();
        }catch(err){
          document.getElementById("brainModelStatus").textContent = `⚠ Predict error: ${err.message}`;
        }
      }

      const resumen = calcularVentajaRelativa(predA, predB);
      const porcentajeTug = (Math.min(1, Math.max(-1, resumen.ventaja / 0.6)) + 1) * 50;
      const comparisonEl = document.getElementById("brainComparisonOut");
      comparisonEl.style.display = "block";
      comparisonEl.innerHTML = `
        <div style="font-weight:900;font-size:15px;margin-bottom:6px;color:${resumen.tono};">Duelo de Vectores · ΔLocal(A) ${(resumen.ventaja >= 0 ? "+" : "") + resumen.ventaja.toFixed(2)}</div>
        <div class="fl-muted" style="margin-bottom:8px;">${resumen.mensaje}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:#58a6ff;">Equipo A</span>
          <div style="position:relative;flex:1;height:10px;border-radius:999px;border:1px solid #2d333b;background:linear-gradient(90deg,#1f6feb 0%,#30363d 50%,#f85149 100%);">
            <div style="position:absolute;top:-3px;left:calc(${porcentajeTug.toFixed(1)}% - 6px);width:12px;height:16px;border-radius:8px;background:#ffffff;"></div>
          </div>
          <span style="font-size:12px;color:#f85149;">Equipo B</span>
        </div>`;

      const selectedTeamA = db.teams.find((team)=>team.id === brainSelectors.A.team.value);
      const selectedTeamB = db.teams.find((team)=>team.id === brainSelectors.B.team.value);
      const reporteEl = document.getElementById("reporte-texto");
      if(reporteEl){
        const textoParaLeer = synthesizeMatchReport(selectedTeamA, selectedTeamB, {
          victoriaIA: predA[0] || 0,
          edge: (predA[0] || 0) - (parseFloat(document.getElementById("cerebeloSimVictoria")?.value) || 0),
          ventaja: resumen.ventaja,
          peligro: relatoA.peligro,
          scoreHome: marcadorVivo.home,
          scoreAway: marcadorVivo.away
        });
        reporteEl.textContent = textoParaLeer;
        locutorAnalista(textoParaLeer);
      }

      const cerebeloRefinarBtn = document.getElementById("cerebeloRefinar");
      if(cerebeloRefinarBtn) cerebeloRefinarBtn.click();
    };


    const brainReadReportBtn = document.getElementById("brainReadReport");
    if(brainReadReportBtn){
      brainReadReportBtn.onclick = ()=>{
        leerInformeActual();
      };
    }

    document.getElementById("brainInitModel").onclick = async ()=>{
      const statusEl = document.getElementById("brainModelStatus");
      if(typeof tf === "undefined"){
        statusEl.textContent = "❌ TensorFlow.js no cargado.";
        return;
      }
      try{
        statusEl.textContent = "⏳ Inicializando...";
        let model = null;
        try{
          model = await tf.loadLayersModel("localstorage://brain-memory-carl");
          if(brainModelInputSize(model) !== BRAIN_INPUT_SIZE){
            model = await createTemporalBrainModel();
            statusEl.textContent = `♻️ Modelo previo no compatible. Nuevo temporal-safe ${BRAIN_INPUT_SIZE} creado.`;
          }else{
            statusEl.textContent = "✅ Modelo restaurado desde localStorage.";
          }
        }catch(_err){
          model = await createTemporalBrainModel();
          statusEl.textContent = `✅ Modelo temporal seguro listo (${BRAIN_INPUT_SIZE}→96→32→3, softmax).`;
        }
        syncBrainModelGlobal(model);
      }catch(err){
        statusEl.textContent = `❌ ${err.message}`;
      }
    };

    document.getElementById("brainLearnOne").onclick = async ()=>{
      const statusEl = document.getElementById("brainModelStatus");
      if(typeof tf === "undefined" || !brainModel){
        statusEl.textContent = "❌ Inicializa el modelo antes de entrenar.";
        return;
      }
      if(!ultimaMuestra){
        statusEl.textContent = "❌ Primero procesa un vector de estado.";
        return;
      }
      try{
        const modeMeta = getBrainModeMeta();
        if(modeMeta.mode === "historico" && !modeMeta.historicalDate){
          statusEl.textContent = "❌ En modo Históricos debes indicar la fecha del partido.";
          return;
        }
        statusEl.textContent = "⏳ Aprendiendo de este partido...";
        ultimaMuestra.y = oneHotResultado(document.getElementById("brainResultadoReal").value);
        ultimaMuestra.meta = {
          mode: modeMeta.mode,
          modeLabel: modeMeta.modeLabel,
          historicalDate: modeMeta.mode === "historico" ? modeMeta.historicalDate : ""
        };
        const normalizedSample = normalizeBrainSample({ ...ultimaMuestra });
        if(!normalizedSample){
          statusEl.textContent = "❌ Muestra inválida: falta secuencia temporal completa.";
          return;
        }
        brainTrainingHistory.unshift(normalizedSample);
        if(brainTrainingHistory.length > 120) brainTrainingHistory.pop();
        renderSnapshots();
        const loss = await aprenderConMuestra(normalizedSample);
        await persistBrainModel(statusEl);
        statusEl.textContent += Number.isFinite(loss) ? ` · loss ${loss.toFixed(4)}` : "";
      }catch(err){
        statusEl.textContent = `❌ ${err.message}`;
      }
    };

    document.getElementById("brainLearnBatch").onclick = async ()=>{
      const statusEl = document.getElementById("brainModelStatus");
      if(typeof tf === "undefined" || !brainModel){
        statusEl.textContent = "❌ Inicializa el modelo antes de entrenar.";
        return;
      }
      if(!brainTrainingHistory.length){
        statusEl.textContent = "❌ No hay snapshots para entrenamiento en lote.";
        return;
      }
      try{
        ensureBrainModelCompiled(brainModel);
        statusEl.textContent = "⏳ Entrenando lote reciente...";
        const validBatch = brainTrainingHistory.filter((m)=>Array.isArray(m?.x) && m.x.length===BRAIN_INPUT_SIZE && Array.isArray(m?.y) && m.y.length===3);
        if(!validBatch.length){
          statusEl.textContent = "❌ No hay muestras válidas con secuencias temporales para entrenar.";
          return;
        }
        const xs = tf.tensor2d(validBatch.map(m=>m.x));
        const ys = tf.tensor2d(validBatch.map(m=>m.y));
        const history = await brainModel.fit(xs, ys, { epochs: 12, batchSize: Math.min(6, validBatch.length), shuffle: true, verbose: 0 });
        xs.dispose();
        ys.dispose();
        const losses = history?.history?.loss || [];
        losses.forEach((loss)=>{
          if(Number.isFinite(loss)) brainLossHistory.push(loss);
        });
        if(brainLossHistory.length > 30) brainLossHistory.splice(0, brainLossHistory.length - 30);
        renderLossChart();
        await persistBrainModel(statusEl);
      }catch(err){
        statusEl.textContent = `❌ ${err.message}`;
      }
    };

    const cerebelo = new Cerebelo();

    document.getElementById("cerebeloRefinar").onclick = ()=>{
      const iaVictoria = parseFloat(document.getElementById("cerebeloIAVictoria").value) || 0;
      const iaEmpate   = parseFloat(document.getElementById("cerebeloIAEmpate").value)   || 0;
      const iaDerrota  = parseFloat(document.getElementById("cerebeloIADerrota").value)  || 0;
      const simVictoria = parseFloat(document.getElementById("cerebeloSimVictoria").value) || 0;
      const simEmpate   = parseFloat(document.getElementById("cerebeloSimEmpate").value)   || 0;
      const simDerrota  = parseFloat(document.getElementById("cerebeloSimDerrota").value)  || 0;

      const prediccionIA       = [iaVictoria,  iaEmpate,  iaDerrota];
      const resultadoSimulador = [simVictoria, simEmpate, simDerrota];

      const veredicto = cerebelo.refinar(prediccionIA, resultadoSimulador);

      const semaforoColors = { verde: "#3fb950", amarillo: "#f2cc60", rojo: "#f85149" };
      const semaforoBg     = { verde: "#0d2a14", amarillo: "#2a2208", rojo: "#2a0d0d" };
      const sc = semaforoColors[veredicto.semaforo.color] || "#c9d1d9";
      const sb = semaforoBg[veredicto.semaforo.color]     || "#161b22";

      document.getElementById("cerebeloResult").style.display = "block";
      document.getElementById("cerebeloSemaforo").style.background = sb;
      document.getElementById("cerebeloSemaforo").style.borderLeft = `4px solid ${sc}`;
      document.getElementById("cerebeloSemaforo").innerHTML =
        `${veredicto.semaforo.emoji} <span style="color:${sc}">${veredicto.semaforo.mensaje}</span>`;

      const probLabels = ["Local","Empate","Visitante"];
      document.getElementById("cerebeloProbs").innerHTML = veredicto.resultadoFinal.map((val, i)=>{
        const pct   = (val * 100).toFixed(1);
        const color = val >= 0.5 ? "#3fb950" : val >= 0.3 ? "#f2cc60" : "#f85149";
        return `<div class="fl-card" style="padding:10px;background:#111722;text-align:center;">
          <div class="fl-muted" style="font-size:11px;margin-bottom:4px;">${probLabels[i]}</div>
          <div style="font-size:24px;font-weight:900;color:${color};">${pct}%</div>
          <div style="height:6px;border-radius:999px;background:#0d1117;border:1px solid #2d333b;margin-top:6px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;border-radius:999px;background:${color};"></div>
          </div>
        </div>`;
      }).join("");

      const aprendizajeMsg = veredicto.marcarParaAprendizaje
        ? "📌 Caso válido para entrenamiento (anomalía lógica — mayor peso en aprendizaje futuro)."
        : veredicto.tipoDiscrepancia === "ruido"
          ? "⚠️ Evento ruidoso — guardar solo si tienes etiqueta real confirmada."
          : "✅ Datos coherentes — Uso normal en entrenamiento.";

      document.getElementById("cerebeloDetalle").innerHTML =
        `<b>Confianza:</b> ${veredicto.confianza}<br>` +
        `<b>Tipo de discrepancia:</b> ${veredicto.tipoDiscrepancia}<br>` +
        `<b>Filtro de ruido:</b> ${aprendizajeMsg}`;
    };
  }

  }

  window.__FOOTBALL_LAB__ = {
    open(view="home", payload={}){ render(view, payload); },
    getDB(){ return loadDb(); },
    help: "window.__FOOTBALL_LAB__.open('liga'|'equipo'|'tracker'|'versus'|'bitacora'|'market'|'brain')"
  };

  return window.__FOOTBALL_LAB__;
}

window.initFootballLab = initFootballLab;

try{
  if(!window.__FOOTBALL_LAB__?.open){
    initFootballLab();
  }
}catch(e){
  console.warn("FootballLab auto-init failed", e);
}

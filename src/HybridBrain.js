const MODEL_STORAGE_KEY = "localstorage://brain-hybrid-v1";
const META_STORAGE_KEY = "brain/meta.json";
const NORMALIZER_STORAGE_KEY = "brain/normalizer.json";
const VOCAB_STORAGE_KEY = "brain/vocab.json";

import { buildMatchVisionTensor } from "./footballlab/brain/vision/vision_builder.js";
import { createVisionCnnBranch } from "./footballlab/brain/vision/vision_cnn_model.js";
import { VISION_TENSOR_SHAPE } from "./footballlab/brain/vision/vision_tensor.js";

export const FEATURE_SCHEMA_VERSION = "2026-03-hybrid-v1";

export const BASE_FEATURES = [
  "elo_home","elo_away","elo_diff",
  "form_points_home","form_points_away","form_points_diff",
  "goals_for_home","goals_for_away","goals_against_home","goals_against_away",
  "xg_for_home","xg_for_away","xg_against_home","xg_against_away",
  "shots_for_home","shots_for_away","shots_against_home","shots_against_away",
  "possession_home","possession_away","dangerous_attacks_home","dangerous_attacks_away",
  "corners_home","corners_away","cards_home","cards_away",
  "minute","is_live_slice","momentum_index_home","momentum_index_away"
];

const EVENT_KEYWORDS = ["shot","shot_on_target","big_chance","corner","red_card","yellow_card","dangerous_attack","goal"];

function cleanText(text=""){
  return String(text || "")
    .toLowerCase()
    .replace(/\b\d{1,3}\b/g, " <MINUTE> ")
    .replace(/[^a-záéíóúüñ<>_\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text=""){
  return cleanText(text).split(" ").filter(Boolean).slice(0, 120);
}

function softmax3(logits){
  const max = Math.max(...logits);
  const exps = logits.map((v)=>Math.exp(v - max));
  const sum = exps.reduce((a,b)=>a+b, 0) || 1;
  return exps.map((v)=>v / sum);
}

function argmax3(arr){
  let idx = 0;
  for(let i=1;i<arr.length;i++) if(arr[i] > arr[idx]) idx = i;
  return idx;
}

function oneHotOutcome(homeGoals=0, awayGoals=0){
  if(homeGoals > awayGoals) return [1,0,0];
  if(homeGoals === awayGoals) return [0,1,0];
  return [0,0,1];
}

function pickFeature(raw, key){
  const value = Number(raw?.[key]);
  const missing = Number.isFinite(value) ? 0 : 1;
  return { value: Number.isFinite(value) ? value : 0, missing };
}

function buildFeatureNames(){
  const out = [];
  BASE_FEATURES.forEach((feature)=>{
    out.push(feature, `${feature}_missing`);
  });
  return out;
}

export class HybridBrainService {
  constructor(){
    this.featureNames = buildFeatureNames();
    this.featureIndex = Object.fromEntries(this.featureNames.map((name, idx)=>[name, idx]));
    this.examples = [];
    this.matchIds = [];
    this.vocab = { "<PAD>": 0, "<UNK>": 1 };
    this.maxTokens = 50;
    this.model = null;
    this.norm = { mean: [], std: [] };
    this.meta = null;
  }

  buildDataset(pack={}){
    const matches = Array.isArray(pack?.matches) ? pack.matches : [];
    const examples = [];
    matches.forEach((match, matchIdx)=>{
      const matchId = String(match?.matchId || match?.id || `match_${matchIdx}`);
      const finalHome = Number(match?.finalHomeGoals ?? match?.score?.home ?? 0);
      const finalAway = Number(match?.finalAwayGoals ?? match?.score?.away ?? 0);
      const pre = this.toExample({
        rawFeatures: match?.preMatchFeatures || {},
        text: match?.preMatchText || "",
        yOutcome: oneHotOutcome(finalHome, finalAway),
        yGoals: [finalHome, finalAway],
        meta: { matchId, minute: 0, isLiveSlice: 0, timeline: match?.timeline || [], narrativeRaw: match?.narrativeRaw || "", liveAggregates: match?.liveAggregates || {} }
      });
      examples.push(pre);
      const timeline = Array.isArray(match?.timeline) ? match.timeline : [];
      const slices = [10,20,30,40,50,60,70,80];
      slices.forEach((minute)=>{
        const eventsUntil = timeline.filter((ev)=>Number(ev?.minute || 0) <= minute);
        if(!eventsUntil.length) return;
        const sliceFeatures = { ...(match?.liveAggregates?.[minute] || {}), minute, is_live_slice: 1 };
        const text = eventsUntil.slice(-50).map((ev)=>ev?.text || ev?.event || "").join(" ");
        examples.push(this.toExample({
          rawFeatures: sliceFeatures,
          text,
          yOutcome: oneHotOutcome(finalHome, finalAway),
          yGoals: [finalHome, finalAway],
          meta: { matchId, minute, isLiveSlice: 1, timeline: eventsUntil, narrativeRaw: text, liveAggregates: match?.liveAggregates || {}, liveMinute: minute }
        }));
      });
    });
    this.examples = examples;
    this.matchIds = [...new Set(examples.map((e)=>e.meta.matchId))];
    this.buildVocab(examples.map((e)=>e.tokens));
    this.meta = {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      trainedAt: "",
      sampleCount: examples.length,
      matchCount: this.matchIds.length,
      vocabSize: Object.keys(this.vocab).length,
      metrics: {}
    };
    return this.meta;
  }

  toExample({ rawFeatures={}, text="", yOutcome=[0,1,0], yGoals=[0,0], meta={} }){
    const x = [];
    BASE_FEATURES.forEach((feature)=>{
      const { value, missing } = pickFeature(rawFeatures, feature);
      x.push(value, missing);
    });
    const tokens = tokenize(text);
    const vision = buildMatchVisionTensor({
      timeline: meta?.timeline || [],
      narrativeRaw: meta?.narrativeRaw || text,
      liveAggregates: meta?.liveAggregates || {}
    }, meta?.liveMinute!=null ? { liveMinute: meta.liveMinute } : {});
    return { xTabular: x, tokens, xVision: vision.tensor, yOutcome, yGoals, meta };
  }

  buildVocab(tokenBatches=[]){
    const freq = new Map();
    tokenBatches.forEach((tokens)=>tokens.forEach((token)=>freq.set(token, (freq.get(token) || 0) + 1)));
    const sorted = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 3000);
    this.vocab = { "<PAD>": 0, "<UNK>": 1 };
    sorted.forEach(([token], i)=>{ this.vocab[token] = i + 2; });
  }

  encodeTokens(tokens=[]){
    const ids = tokens.slice(0, this.maxTokens).map((t)=>this.vocab[t] ?? 1);
    while(ids.length < this.maxTokens) ids.push(0);
    return ids;
  }

  splitByMatch(trainRatio=0.8){
    const ids = [...this.matchIds];
    const pivot = Math.max(1, Math.floor(ids.length * trainRatio));
    const trainSet = new Set(ids.slice(0, pivot));
    const train = this.examples.filter((e)=>trainSet.has(e.meta.matchId));
    const val = this.examples.filter((e)=>!trainSet.has(e.meta.matchId));
    return { train, val: val.length ? val : train.slice(-Math.max(1, Math.floor(train.length*0.2))) };
  }

  fitNormalizer(trainExamples=[]){
    const dim = this.featureNames.length;
    const mean = Array(dim).fill(0);
    const std = Array(dim).fill(1);
    if(!trainExamples.length){
      this.norm = { mean, std };
      return;
    }
    for(let j=0;j<dim;j++){
      const vals = trainExamples.map((e)=>e.xTabular[j]);
      const m = vals.reduce((a,b)=>a+b,0) / vals.length;
      const variance = vals.reduce((a,b)=>a + (b-m)*(b-m),0) / vals.length;
      mean[j] = m;
      std[j] = Math.sqrt(variance) || 1;
    }
    this.norm = { mean, std };
  }

  normalizeX(x=[]){
    return x.map((v,i)=>(v - this.norm.mean[i]) / this.norm.std[i]);
  }

  async createModel(){
    if(typeof tf === "undefined") throw new Error("TensorFlow.js no disponible");
    const tabInput = tf.input({ shape: [this.featureNames.length], name: "x_tabular" });
    let tab = tf.layers.dense({ units: 64, activation: "relu" }).apply(tabInput);
    tab = tf.layers.dropout({ rate: 0.2 }).apply(tab);
    tab = tf.layers.dense({ units: 32, activation: "relu" }).apply(tab);

    const textInput = tf.input({ shape: [this.maxTokens], dtype: "int32", name: "x_text" });
    let txt = tf.layers.embedding({ inputDim: Object.keys(this.vocab).length + 1, outputDim: 24 }).apply(textInput);
    txt = tf.layers.globalAveragePooling1d().apply(txt);
    txt = tf.layers.dense({ units: 24, activation: "relu" }).apply(txt);

    const { input: visionInput, embedding: visionEmbedding } = createVisionCnnBranch(tf, "x_vision");

    let fused = tf.layers.concatenate().apply([tab, txt, visionEmbedding]);
    fused = tf.layers.dense({ units: 48, activation: "relu" }).apply(fused);
    fused = tf.layers.dropout({ rate: 0.2 }).apply(fused);

    const outcome = tf.layers.dense({ units: 3, activation: "softmax", name: "outcome" }).apply(fused);
    const goals = tf.layers.dense({ units: 2, activation: "linear", name: "goals" }).apply(fused);

    this.model = tf.model({ inputs: [tabInput, textInput, visionInput], outputs: [outcome, goals], name: "hybrid_brain" });
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: { outcome: "categoricalCrossentropy", goals: tf.losses.huberLoss },
      lossWeights: { outcome: 1, goals: 0.5 },
      metrics: { outcome: ["accuracy"], goals: ["mae"] }
    });
    return this.model;
  }

  tensorsFromExamples(examples=[]){
    const xTab = examples.map((e)=>this.normalizeX(e.xTabular));
    const xText = examples.map((e)=>this.encodeTokens(e.tokens));
    const xVision = examples.map((e)=>e.xVision);
    const yOutcome = examples.map((e)=>e.yOutcome);
    const yGoals = examples.map((e)=>e.yGoals);
    return {
      xTab: tf.tensor2d(xTab),
      xText: tf.tensor2d(xText, [xText.length, this.maxTokens], "int32"),
      xVision: tf.tensor4d(xVision, [xVision.length, VISION_TENSOR_SHAPE.events, VISION_TENSOR_SHAPE.minutes, VISION_TENSOR_SHAPE.channels]),
      yOutcome: tf.tensor2d(yOutcome),
      yGoals: tf.tensor2d(yGoals)
    };
  }

  async train({ epochs=16, batchSize=32, trainRatio=0.8 }={}){
    if(!this.examples.length) throw new Error("Dataset vacío");
    if(!this.model) await this.createModel();
    const { train, val } = this.splitByMatch(trainRatio);
    this.fitNormalizer(train);
    const tr = this.tensorsFromExamples(train);
    const va = this.tensorsFromExamples(val);
    const history = await this.model.fit(
      [tr.xTab, tr.xText, tr.xVision],
      { outcome: tr.yOutcome, goals: tr.yGoals },
      {
        epochs,
        batchSize: Math.min(batchSize, train.length),
        validationData: [[va.xTab, va.xText, va.xVision], { outcome: va.yOutcome, goals: va.yGoals }],
        shuffle: true,
        verbose: 0
      }
    );
    Object.values(tr).forEach((t)=>t.dispose());
    Object.values(va).forEach((t)=>t.dispose());

    const valAcc = history.history?.val_outcome_accuracy?.at(-1) ?? null;
    const valLoss = history.history?.val_outcome_loss?.at(-1) ?? null;
    const valMae = history.history?.val_goals_mae?.at(-1) ?? null;
    this.meta = {
      ...(this.meta || {}),
      trainedAt: new Date().toISOString(),
      sampleCount: this.examples.length,
      metrics: { valAcc, valLogLoss: valLoss, valGoalsMae: valMae }
    };
    return this.meta.metrics;
  }

  async save(){
    if(!this.model) throw new Error("No hay modelo para guardar");
    await this.model.save(MODEL_STORAGE_KEY);
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(this.meta || {}));
    localStorage.setItem(NORMALIZER_STORAGE_KEY, JSON.stringify(this.norm));
    localStorage.setItem(VOCAB_STORAGE_KEY, JSON.stringify({ vocab: this.vocab, maxTokens: this.maxTokens }));
  }

  async load(){
    if(typeof tf === "undefined") throw new Error("TensorFlow.js no disponible");
    this.model = await tf.loadLayersModel(MODEL_STORAGE_KEY);
    const meta = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || "{}");
    const norm = JSON.parse(localStorage.getItem(NORMALIZER_STORAGE_KEY) || "{}");
    const vocabRaw = JSON.parse(localStorage.getItem(VOCAB_STORAGE_KEY) || "{}");
    if(norm?.mean?.length === this.featureNames.length) this.norm = norm;
    if(vocabRaw?.vocab) this.vocab = vocabRaw.vocab;
    if(Number.isFinite(vocabRaw?.maxTokens)) this.maxTokens = vocabRaw.maxTokens;
    this.meta = meta;
    return meta;
  }

  async predict({ tabular={}, text="", matchContext=null, liveMinute=null }={}){
    if(!this.model) throw new Error("Modelo no cargado");
    const ex = this.toExample({
      rawFeatures: tabular,
      text,
      yOutcome:[0,1,0],
      yGoals:[0,0],
      meta:{
        timeline: matchContext?.timeline || [],
        narrativeRaw: matchContext?.narrativeRaw || text,
        liveAggregates: matchContext?.liveAggregates || {},
        liveMinute
      }
    });
    const xTab = tf.tensor2d([this.normalizeX(ex.xTabular)]);
    const xText = tf.tensor2d([this.encodeTokens(ex.tokens)], [1, this.maxTokens], "int32");
    const xVision = tf.tensor4d([ex.xVision], [1, VISION_TENSOR_SHAPE.events, VISION_TENSOR_SHAPE.minutes, VISION_TENSOR_SHAPE.channels]);
    const [outcomeTensor, goalsTensor] = this.model.predict([xTab, xText, xVision]);
    const outcome = await outcomeTensor.data();
    const goals = await goalsTensor.data();
    tf.dispose([xTab, xText, xVision, outcomeTensor, goalsTensor]);
    return {
      probs: { homeWin: outcome[0], draw: outcome[1], awayWin: outcome[2] },
      goals: { home: goals[0], away: goals[1] },
      keywords: EVENT_KEYWORDS.filter((kw)=>text.toLowerCase().includes(kw)).slice(0,5)
    };
  }

  async explainPrediction({ tabular={}, text="" }={}){
    const base = await this.predict({ tabular, text });
    const baseline = base.probs.homeWin;
    const impacts = [];
    for(const feature of BASE_FEATURES){
      const muted = { ...tabular, [feature]: 0 };
      const pred = await this.predict({ tabular: muted, text });
      impacts.push({
        feature,
        deltaHomeWin: baseline - pred.probs.homeWin
      });
    }
    impacts.sort((a,b)=>Math.abs(b.deltaHomeWin) - Math.abs(a.deltaHomeWin));
    return { topFeatures: impacts.slice(0,5), keywords: base.keywords, probs: base.probs };
  }

  modelStatus(){
    return {
      loaded: Boolean(this.model),
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      sampleCount: this.meta?.sampleCount || 0,
      vocabSize: Object.keys(this.vocab).length,
      metrics: this.meta?.metrics || {},
      trainedAt: this.meta?.trainedAt || "",
      visionShape: [VISION_TENSOR_SHAPE.events, VISION_TENSOR_SHAPE.minutes, VISION_TENSOR_SHAPE.channels]
    };
  }

  static parsePack(rawText=""){
    const parsed = JSON.parse(rawText || "{}");
    if(Array.isArray(parsed)) return { matches: parsed };
    if(Array.isArray(parsed?.matches)) return parsed;
    const teams = Array.isArray(parsed?.teams) ? parsed.teams : [];
    const matches = teams.flatMap((team)=>Array.isArray(team?.matches) ? team.matches : []);
    return { matches };
  }
}

export function inferOutcomeLabel(probs={}){
  const arr = [probs.homeWin || 0, probs.draw || 0, probs.awayWin || 0];
  return ["Home","Draw","Away"][argmax3(arr)];
}

export function estimateLiveDelta(pre={}, live={}){
  const preArr = [pre.homeWin || 0, pre.draw || 0, pre.awayWin || 0];
  const liveArr = [live.homeWin || 0, live.draw || 0, live.awayWin || 0];
  return softmax3(liveArr.map((v,i)=>v - preArr[i]));
}

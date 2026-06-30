const FEATURE_KEYS = [
  "xg_diff",
  "shots_diff",
  "shots_on_target_diff",
  "possession_diff",
  "big_chances_diff",
  "corners_diff",
  "passes_diff",
  "touches_box_diff",
  "xgot_diff",
  "xa_diff"
];

const NARRATIVE_KEYS = [
  "shot_text_diff",
  "shot_on_target_text_diff",
  "big_chance_text_diff",
  "corner_text_diff",
  "foul_text_diff",
  "yellow_text_diff",
  "red_text_diff",
  "offside_text_diff",
  "save_text_diff"
];

export const STAT_MAP = {
  "Goles esperados (xG)": "xg",
  "Remates totales": "shots",
  "Remates a puerta": "shots_on_target",
  "Grandes ocasiones": "big_chances",
  "Córneres": "corners",
  "Posesión": "possession",
  "Toques en el área rival": "touches_box",
  "Asistencias esperadas (xA)": "xa",
  "xG a puerta (xGOT)": "xgot"
};

const DEFAULT_SCHEMA = [...FEATURE_KEYS, ...NARRATIVE_KEYS];

export function parsePercent(value){
  const raw = String(value ?? "").trim().replace("%", "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseNumber(value){
  if(typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim().replace(",", ".");
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function resultLabelToOneHot(homeGoals, awayGoals){
  if(homeGoals > awayGoals) return [1,0,0];
  if(homeGoals < awayGoals) return [0,0,1];
  return [0,1,0];
}

function normalizeStatsObject(stats = {}){
  const out = { ...stats };
  for(const [from, to] of Object.entries(STAT_MAP)){
    if(out[to] == null && out[from] != null) out[to] = out[from];
  }
  return out;
}

function fromSectionsStats(match = {}, side = "home"){
  const sections = Array.isArray(match.sections) ? match.sections : Array.isArray(match.statistics) ? match.statistics : [];
  const stats = {};
  sections.forEach((row)=>{
    const category = row?.category || row?.label || row?.name;
    const mapped = STAT_MAP[category] || row?.key;
    if(!mapped) return;
    const sideBlock = row?.[side] || {};
    const value = sideBlock?.main ?? sideBlock?.value ?? row?.[`${side}Value`] ?? row?.[side];
    stats[mapped] = value;
  });
  return stats;
}

function readSideStats(match = {}, side = "home"){
  const direct = normalizeStatsObject(match?.stats?.[side] || match?.[side]?.stats || match?.[`${side}Stats`] || {});
  const section = normalizeStatsObject(fromSectionsStats(match, side));
  return { ...section, ...direct };
}

export function extractNarrativeFeatures(text = ""){
  const raw = String(text || "").toLowerCase();
  const count = (regex)=> (raw.match(regex) || []).length;
  return {
    shot: count(/\b(remate|disparo|shot)s?\b/g),
    shot_on_target: count(/\b(remate a puerta|tiro a puerta|shot on target)\b/g),
    big_chance: count(/\b(gran ocasi[oó]n|big chance)\b/g),
    corner: count(/\b(c[oó]rner|corner)es?\b/g),
    foul: count(/\b(falta|foul)s?\b/g),
    yellow: count(/\b(tarjeta amarilla|yellow card)s?\b/g),
    red: count(/\b(tarjeta roja|red card)s?\b/g),
    offside: count(/\b(fuera de juego|offside)s?\b/g),
    save: count(/\b(parad[oó]n|atajada|save)s?\b/g)
  };
}

export function extractFeatures(match = {}, { orientation = "home-away", includeNarrative = true } = {}){
  const homeStats = readSideStats(match, "home");
  const awayStats = readSideStats(match, "away");
  const sign = orientation === "away-home" ? -1 : 1;
  const diff = (key, parser = parseNumber)=> sign * (parser(homeStats[key]) - parser(awayStats[key]));

  const statsVector = [
    diff("xg"),
    diff("shots"),
    diff("shots_on_target"),
    diff("possession", parsePercent),
    diff("big_chances"),
    diff("corners"),
    diff("passes"),
    diff("touches_box"),
    diff("xgot"),
    diff("xa")
  ];

  const narrativeHome = extractNarrativeFeatures(match?.narrative?.home || match?.homeNarrative || match?.relatoHome || "");
  const narrativeAway = extractNarrativeFeatures(match?.narrative?.away || match?.awayNarrative || match?.relatoAway || "");
  const narrativeVector = [
    sign * (narrativeHome.shot - narrativeAway.shot),
    sign * (narrativeHome.shot_on_target - narrativeAway.shot_on_target),
    sign * (narrativeHome.big_chance - narrativeAway.big_chance),
    sign * (narrativeHome.corner - narrativeAway.corner),
    sign * (narrativeHome.foul - narrativeAway.foul),
    sign * (narrativeHome.yellow - narrativeAway.yellow),
    sign * (narrativeHome.red - narrativeAway.red),
    sign * (narrativeHome.offside - narrativeAway.offside),
    sign * (narrativeHome.save - narrativeAway.save)
  ];

  return {
    featureVector: includeNarrative ? [...statsVector, ...narrativeVector] : statsVector,
    statsVector,
    narrativeVector
  };
}

export function buildTrainingDataset(matches = [], options = {}){
  const rows = Array.isArray(matches) ? matches : [];
  const examples = rows.map((match)=>{
    const { featureVector } = extractFeatures(match, options);
    const homeGoals = parseNumber(match?.scoreFT?.home ?? match?.score?.home ?? match?.homeGoals ?? match?.goals?.home);
    const awayGoals = parseNumber(match?.scoreFT?.away ?? match?.score?.away ?? match?.awayGoals ?? match?.goals?.away);
    return {
      features: featureVector,
      label_result: resultLabelToOneHot(homeGoals, awayGoals),
      label_goals: [homeGoals, awayGoals],
      matchId: match?.id || match?.matchId || ""
    };
  }).filter((row)=>row.features.length);

  return {
    examples,
    featureSchema: options?.includeNarrative === false ? FEATURE_KEYS : DEFAULT_SCHEMA
  };
}

export function createTensorflowBrainModel(tfRef, inputSize){
  const tfLib = tfRef || globalThis.tf;
  if(!tfLib) throw new Error("TensorFlow.js no disponible");
  const input = tfLib.input({ shape: [inputSize] });
  const d1 = tfLib.layers.dense({ units: 64, activation: "relu" }).apply(input);
  const drop1 = tfLib.layers.dropout({ rate: 0.2 }).apply(d1);
  const d2 = tfLib.layers.dense({ units: 64, activation: "relu" }).apply(drop1);
  const drop2 = tfLib.layers.dropout({ rate: 0.2 }).apply(d2);
  const trunk = tfLib.layers.dense({ units: 32, activation: "relu" }).apply(drop2);
  const resultHead = tfLib.layers.dense({ units: 3, activation: "softmax", name: "result" }).apply(trunk);
  const goalsHead = tfLib.layers.dense({ units: 2, activation: "linear", name: "goals" }).apply(trunk);
  const model = tfLib.model({ inputs: input, outputs: [resultHead, goalsHead] });
  return model;
}

export async function trainTensorflowBrainModel({ tfRef, model, dataset, epochs = 50, batchSize = 16, learningRate = 0.001, onEpoch } = {}){
  const tfLib = tfRef || globalThis.tf;
  if(!tfLib || !model) throw new Error("Modelo/TensorFlow no disponible");
  const xs = tfLib.tensor2d(dataset.examples.map((row)=>row.features));
  const yResult = tfLib.tensor2d(dataset.examples.map((row)=>row.label_result));
  const yGoals = tfLib.tensor2d(dataset.examples.map((row)=>row.label_goals));

  model.compile({
    optimizer: tfLib.train.adam(learningRate),
    loss: { result: "categoricalCrossentropy", goals: tfLib.losses.huberLoss },
    lossWeights: { result: 1, goals: 0.5 },
    metrics: { result: ["accuracy"], goals: ["mae"] }
  });

  const history = await model.fit(xs, { result: yResult, goals: yGoals }, {
    epochs,
    batchSize: Math.min(batchSize, dataset.examples.length),
    shuffle: true,
    validationSplit: dataset.examples.length > 8 ? 0.2 : 0,
    callbacks: {
      onEpochEnd: (epoch, logs)=>onEpoch?.(epoch, logs)
    }
  });
  xs.dispose(); yResult.dispose(); yGoals.dispose();
  return history;
}

export async function saveBrainArtifacts({ model, meta, featureSchema, profile = "default" } = {}){
  if(!model) throw new Error("Modelo no disponible");
  await model.save(`indexeddb://brain_model_${profile}`);
  localStorage.setItem(`brain_meta_${profile}`, JSON.stringify(meta || {}));
  localStorage.setItem(`brain_feature_schema_${profile}`, JSON.stringify(featureSchema || DEFAULT_SCHEMA));
}

export async function loadBrainArtifacts({ tfRef, profile = "default" } = {}){
  const tfLib = tfRef || globalThis.tf;
  if(!tfLib) throw new Error("TensorFlow.js no disponible");
  const model = await tfLib.loadLayersModel(`indexeddb://brain_model_${profile}`);
  const meta = JSON.parse(localStorage.getItem(`brain_meta_${profile}`) || "{}");
  const featureSchema = JSON.parse(localStorage.getItem(`brain_feature_schema_${profile}`) || "[]");
  return { model, meta, featureSchema };
}

export function inferWithBrain({ model, featureVector } = {}){
  const tfLib = globalThis.tf;
  if(!tfLib || !model) throw new Error("Modelo no disponible para inferencia");
  return tfLib.tidy(()=>{
    const input = tfLib.tensor2d([featureVector]);
    const [resultTensor, goalsTensor] = model.predict(input);
    const result = Array.from(resultTensor.dataSync());
    const goals = Array.from(goalsTensor.dataSync());
    return {
      result,
      goals: { home: goals[0] || 0, away: goals[1] || 0 }
    };
  });
}

export function buildTeamProfile(matches = [], teamId = ""){
  const relevant = (matches || []).filter((m)=>m.homeId===teamId || m.awayId===teamId);
  const avg = (arr)=>arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const xg = [];
  const shots = [];
  const possession = [];
  const big = [];
  const corners = [];
  relevant.forEach((m)=>{
    const isHome = m.homeId===teamId;
    const side = isHome ? "home" : "away";
    const stats = readSideStats(m, side);
    xg.push(parseNumber(stats.xg));
    shots.push(parseNumber(stats.shots));
    possession.push(parsePercent(stats.possession));
    big.push(parseNumber(stats.big_chances));
    corners.push(parseNumber(stats.corners));
  });
  return {
    avg_xg: avg(xg),
    avg_shots: avg(shots),
    avg_possession: avg(possession),
    avg_big_chances: avg(big),
    avg_corners: avg(corners)
  };
}

export function buildFeatureVectorFromProfiles(homeProfile = {}, awayProfile = {}, liveNarrative = { home:"", away:"" }){
  const base = {
    stats: {
      home: {
        xg: homeProfile.avg_xg,
        shots: homeProfile.avg_shots,
        possession: homeProfile.avg_possession,
        big_chances: homeProfile.avg_big_chances,
        corners: homeProfile.avg_corners
      },
      away: {
        xg: awayProfile.avg_xg,
        shots: awayProfile.avg_shots,
        possession: awayProfile.avg_possession,
        big_chances: awayProfile.avg_big_chances,
        corners: awayProfile.avg_corners
      }
    },
    narrative: liveNarrative
  };
  return extractFeatures(base, { includeNarrative: true }).featureVector;
}

const EXPORT_SCHEMA = "mne_claude_export_v1";
const FEEDBACK_SCHEMA = "mne_claude_feedback_v1";

function clamp(value, min = 0, max = 1){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function safeText(value, fallback = ""){
  const text = String(value ?? fallback).trim();
  return text;
}

function toArray(value){
  return Array.isArray(value) ? value : [];
}

function numeric(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonPreview(value){
  return JSON.stringify(value, null, 2);
}

function compactMemoryContext(memoryRows = [], limit = 5){
  return toArray(memoryRows).slice(-limit).map((row, idx)=>({
    index: idx,
    id: row?.id || null,
    date: row?.date || null,
    score: row?.score || null,
    opponent: row?.opponent || null,
    summary: safeText(row?.summary?.story || row?.narrative || "").slice(0, 240),
    tags: toArray(row?.summary?.tags || row?.tags).slice(0, 8)
  }));
}

function normalizeSegment(phase = {}){
  const range = safeText(phase?.phase || phase?.range || "unknown");
  return {
    range,
    title: safeText(phase?.title || "Narrative phase"),
    tags: toArray(phase?.tags).slice(0, 12),
    summary: safeText(toArray(phase?.notes).join(" | ") || phase?.summary || "").slice(0, 360),
    confidence: Number(clamp(phase?.confidence, 0, 1).toFixed(3)),
    dataDensity: Number(clamp(phase?.confidenceMeta?.completeness, 0, 1).toFixed(3)),
    signals: toArray(phase?.confidenceMeta?.signals).slice(0, 8),
    risks: toArray(phase?.risks).slice(0, 8)
  };
}

export function buildMneClaudeExport({
  match = {},
  vision = {},
  questions = [],
  memoryRows = []
} = {}){
  const segments = toArray(vision?.mne?.narrative).map(normalizeSegment);
  const fallbackQuestions = [
    "¿El MNE interpretó correctamente el guion del partido?",
    "¿Qué señales ignoró?",
    "¿Qué patrones reutilizables detectas?",
    "¿Qué regla entrenable propones?"
  ];

  return {
    schemaVersion: EXPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    match: {
      id: safeText(match?.id || ""),
      home: safeText(match?.home || "Local"),
      away: safeText(match?.away || "Visitante"),
      competition: safeText(match?.competition || "Simulation"),
      date: safeText(match?.date || new Date().toISOString().slice(0, 10)),
      score: {
        home: numeric(vision?.score?.home, numeric(match?.score?.home, 0)),
        away: numeric(vision?.score?.away, numeric(match?.score?.away, 0))
      },
      status: safeText(match?.status || "preview")
    },
    context: {
      preMatch: toArray(vision?.reasonPreview || []).slice(0, 6),
      live: toArray(vision?.insights || []).slice(0, 8),
      final: safeText(vision?.mne?.forecast || "")
    },
    segments,
    stats: {
      probabilities: {
        home: Number(clamp(vision?.probs?.home, 0, 1).toFixed(4)),
        draw: Number(clamp(vision?.probs?.draw, 0, 1).toFixed(4)),
        away: Number(clamp(vision?.probs?.away, 0, 1).toFixed(4))
      },
      expected: vision?.expected || {},
      bars: vision?.bars || {},
      physical: vision?.physical || {}
    },
    liveTriggers: toArray(vision?.mne?.liveTriggers).slice(0, 20),
    mneInterpretation: {
      narrative: segments.map((s)=>`${s.range}: ${s.summary}`).join("\n").slice(0, 1600),
      risks: toArray(vision?.mne?.keyRisks).slice(0, 12),
      forecast: safeText(vision?.mne?.forecast || ""),
      confidence: Number(clamp(vision?.confidence, 0, 1).toFixed(3))
    },
    questions: toArray(questions).length ? questions : fallbackQuestions,
    memoryContext: compactMemoryContext(memoryRows, 5)
  };
}

export function normalizeClaudeFeedback(raw = {}){
  const feedback = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const listNorm = (list, mapper)=>toArray(list).map((row, idx)=>mapper(row || {}, idx)).filter(Boolean);

  return {
    schemaVersion: FEEDBACK_SCHEMA,
    generatedAt: safeText(feedback.generatedAt || new Date().toISOString()),
    matchRef: {
      id: safeText(feedback?.matchRef?.id || ""),
      home: safeText(feedback?.matchRef?.home || ""),
      away: safeText(feedback?.matchRef?.away || "")
    },
    evaluation: {
      accuracy: Number(clamp(feedback?.evaluation?.accuracy, 0, 1).toFixed(3)),
      summary: safeText(feedback?.evaluation?.summary || ""),
      agreementLevel: ["high", "medium", "low"].includes(feedback?.evaluation?.agreementLevel)
        ? feedback.evaluation.agreementLevel
        : "medium"
    },
    missedSignals: listNorm(feedback.missedSignals, (row)=>({
      type: safeText(row.type || "signal"),
      detail: safeText(row.detail || ""),
      importance: ["high", "medium", "low"].includes(row.importance) ? row.importance : "medium"
    })),
    patternInsights: listNorm(feedback.patternInsights, (row)=>({
      name: safeText(row.name || "pattern"),
      detail: safeText(row.detail || ""),
      reusability: ["high", "medium", "low"].includes(row.reusability) ? row.reusability : "medium"
    })),
    newRules: listNorm(feedback.newRules, (row, idx)=>({
      id: safeText(row.id || `rule_${idx + 1}`),
      name: safeText(row.name || "Unnamed rule"),
      logic: safeText(row.logic || ""),
      effect: safeText(row.effect || ""),
      confidence: Number(clamp(row.confidence, 0, 1).toFixed(3))
    })),
    weightSuggestions: listNorm(feedback.weightSuggestions, (row)=>({
      target: safeText(row.target || ""),
      change: safeText(row.change || ""),
      reason: safeText(row.reason || "")
    })),
    trainingNotes: toArray(feedback.trainingNotes).map((note)=>safeText(note)).filter(Boolean),
    confidenceNotes: toArray(feedback.confidenceNotes).map((note)=>safeText(note)).filter(Boolean),
    reusableHeuristics: toArray(feedback.reusableHeuristics).map((note)=>safeText(note)).filter(Boolean)
  };
}

export function validateClaudeFeedbackShape(raw = {}){
  if(!raw || typeof raw !== "object" || Array.isArray(raw)){
    return { ok: false, errors: ["El archivo debe ser un objeto JSON."], warnings: [] };
  }
  const errors = [];
  const warnings = [];

  if(raw.schemaVersion !== FEEDBACK_SCHEMA){
    errors.push(`schemaVersion inválido. Esperado: ${FEEDBACK_SCHEMA}.`);
  }
  if(!raw.matchRef || typeof raw.matchRef !== "object"){
    errors.push("Falta matchRef.");
  }
  if(!raw.evaluation || typeof raw.evaluation !== "object"){
    warnings.push("Falta evaluation: se importará con valores por defecto.");
  }
  ["missedSignals", "patternInsights", "newRules", "weightSuggestions", "trainingNotes", "confidenceNotes", "reusableHeuristics"].forEach((key)=>{
    if(raw[key] != null && !Array.isArray(raw[key])) warnings.push(`${key} no es lista, se ignorará.`);
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function parseClaudeFeedbackText(text){
  try{
    const parsed = JSON.parse(String(text || ""));
    const shape = validateClaudeFeedbackShape(parsed);
    if(!shape.ok){
      return { ok: false, errors: shape.errors, warnings: shape.warnings, data: null };
    }
    return { ok: true, errors: [], warnings: shape.warnings, data: normalizeClaudeFeedback(parsed) };
  }catch(err){
    return { ok: false, errors: [`JSON inválido: ${String(err?.message || err)}`], warnings: [], data: null };
  }
}

export function updateClaudeMemoryState(mneState = {}, { matchId = "", feedback = null } = {}){
  const next = mneState && typeof mneState === "object" ? { ...mneState } : {};
  const claudeExchange = next.claudeExchange && typeof next.claudeExchange === "object"
    ? { ...next.claudeExchange }
    : { historyByMatch: {}, candidateRules: [], patterns: [], trainingNotes: [] };

  claudeExchange.historyByMatch ||= {};
  claudeExchange.candidateRules = toArray(claudeExchange.candidateRules);
  claudeExchange.patterns = toArray(claudeExchange.patterns);
  claudeExchange.trainingNotes = toArray(claudeExchange.trainingNotes);

  if(matchId && feedback){
    const history = toArray(claudeExchange.historyByMatch[matchId]);
    const entry = {
      importedAt: new Date().toISOString(),
      feedback
    };
    claudeExchange.historyByMatch[matchId] = [...history, entry].slice(-20);

    const pushUnique = (target, list, key)=>{
      list.forEach((item)=>{
        if(!target.some((row)=>safeText(row?.[key]) === safeText(item?.[key]))) target.push(item);
      });
    };

    pushUnique(claudeExchange.candidateRules, toArray(feedback.newRules), "id");
    pushUnique(claudeExchange.patterns, toArray(feedback.patternInsights), "name");
    feedback.trainingNotes?.forEach((note)=>{
      if(!claudeExchange.trainingNotes.includes(note)) claudeExchange.trainingNotes.push(note);
    });
  }

  next.claudeExchange = claudeExchange;
  return next;
}

export function getLatestClaudeFeedback(claudeExchange = {}, matchId = ""){
  const history = toArray(claudeExchange?.historyByMatch?.[matchId]);
  return history.length ? history[history.length - 1] : null;
}

export { EXPORT_SCHEMA, FEEDBACK_SCHEMA, safeJsonPreview };

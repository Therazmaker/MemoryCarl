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

function slug(value = ""){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
  claudeExchange.learningAudit = normalizeLearningAuditState(claudeExchange.learningAudit);

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

    const audit = createLearningAuditFromFeedback(feedback, { matchId, importedAt: entry.importedAt });
    claudeExchange.learningAudit.audits.push(audit);
    claudeExchange.learningAudit.audits = claudeExchange.learningAudit.audits.slice(-80);
  }

  next.claudeExchange = claudeExchange;
  return next;
}

export function getLatestClaudeFeedback(claudeExchange = {}, matchId = ""){
  const history = toArray(claudeExchange?.historyByMatch?.[matchId]);
  return history.length ? history[history.length - 1] : null;
}

export function createLearningAuditFromFeedback(feedback = {}, { matchId = "", importedAt = new Date().toISOString() } = {}){
  const fb = feedback && typeof feedback === "object" ? feedback : {};
  const trackedItems = [];
  toArray(fb.missedSignals).forEach((row, idx)=>{
    trackedItems.push({
      id: `missed_${idx + 1}_${slug(row?.type || row?.detail || "signal")}`,
      kind: "missed_signal",
      key: slug(row?.type || row?.detail || `signal_${idx + 1}`),
      label: safeText(row?.detail || row?.type || `Missed signal ${idx + 1}`),
      importance: row?.importance || "medium"
    });
  });
  toArray(fb.newRules).forEach((row, idx)=>{
    trackedItems.push({
      id: `rule_${slug(row?.id || row?.name || idx + 1)}`,
      kind: "rule",
      key: slug(row?.id || row?.name || `rule_${idx + 1}`),
      label: safeText(row?.name || row?.id || `Rule ${idx + 1}`),
      ruleRef: {
        id: safeText(row?.id || ""),
        logic: safeText(row?.logic || ""),
        effect: safeText(row?.effect || "")
      }
    });
  });
  toArray(fb.patternInsights).forEach((row, idx)=>{
    trackedItems.push({
      id: `pattern_${idx + 1}_${slug(row?.name || "pattern")}`,
      kind: "pattern",
      key: slug(row?.name || `pattern_${idx + 1}`),
      label: safeText(row?.detail || row?.name || `Pattern ${idx + 1}`)
    });
  });
  toArray(fb.reusableHeuristics).forEach((row, idx)=>{
    trackedItems.push({
      id: `heuristic_${idx + 1}_${slug(row)}`,
      kind: "heuristic",
      key: slug(row || `heuristic_${idx + 1}`),
      label: safeText(row)
    });
  });

  return {
    auditId: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sourceMatchId: safeText(matchId || fb?.matchRef?.id || ""),
    importedAt,
    feedbackSummary: {
      accuracy: Number(clamp(fb?.evaluation?.accuracy, 0, 1).toFixed(3)),
      agreementLevel: ["high", "medium", "low"].includes(fb?.evaluation?.agreementLevel) ? fb.evaluation.agreementLevel : "medium",
      summary: safeText(fb?.evaluation?.summary || ""),
      wrongReads: toArray(fb?.weightSuggestions),
      missedSignals: toArray(fb?.missedSignals),
      newRules: toArray(fb?.newRules),
      reusablePatterns: toArray(fb?.patternInsights),
      trainingNotes: toArray(fb?.trainingNotes),
      reusableHeuristics: toArray(fb?.reusableHeuristics)
    },
    trackedItems,
    observations: [],
    aggregateStatus: "unchanged",
    metrics: {
      totalObservedMatches: 0,
      improvements: 0,
      unchanged: 0,
      regressions: 0,
      notTriggered: 0,
      triggeredRules: 0,
      lastObservedAt: null,
      lastStatus: "unchanged"
    }
  };
}

function normalizeLearningAuditState(raw = {}){
  const parsed = raw && typeof raw === "object" ? raw : {};
  return {
    audits: toArray(parsed.audits).map(normalizeAuditRecord).filter(Boolean)
  };
}

function normalizeAuditRecord(raw = {}){
  if(!raw || typeof raw !== "object") return null;
  const metrics = raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {};
  return {
    auditId: safeText(raw.auditId || `audit_${Date.now().toString(36)}`),
    sourceMatchId: safeText(raw.sourceMatchId || ""),
    importedAt: safeText(raw.importedAt || new Date().toISOString()),
    feedbackSummary: raw.feedbackSummary && typeof raw.feedbackSummary === "object" ? raw.feedbackSummary : {},
    trackedItems: toArray(raw.trackedItems),
    observations: toArray(raw.observations),
    aggregateStatus: ["improved", "mixed", "unchanged", "regressed"].includes(raw.aggregateStatus) ? raw.aggregateStatus : "unchanged",
    metrics: {
      totalObservedMatches: Math.max(0, Number(metrics.totalObservedMatches) || 0),
      improvements: Math.max(0, Number(metrics.improvements) || 0),
      unchanged: Math.max(0, Number(metrics.unchanged) || 0),
      regressions: Math.max(0, Number(metrics.regressions) || 0),
      notTriggered: Math.max(0, Number(metrics.notTriggered) || 0),
      triggeredRules: Math.max(0, Number(metrics.triggeredRules) || 0),
      lastObservedAt: metrics.lastObservedAt || null,
      lastStatus: ["improved", "unchanged", "regressed", "not_triggered"].includes(metrics.lastStatus) ? metrics.lastStatus : "unchanged"
    }
  };
}

function extractTagFromText(text = ""){
  const normalized = slug(text);
  const map = [
    ["finishing_failure", ["finishing", "definicion", "finish", "big_chance", "chance"]],
    ["territorial_pressure", ["territorial", "control", "posesion", "dominio", "presion"]],
    ["counter_strike", ["contra", "counter", "transicion"]],
    ["setpiece_threat", ["setpiece", "corner", "balon_parado", "tiro_libre"]],
    ["late_pressure", ["late", "tramo_final", "final", "cierre"]],
    ["discipline_issues", ["foul", "yellow", "red", "disciplina"]],
    ["var_turning_point", ["var", "revision"]]
  ];
  for(const [tag, hints] of map){
    if(hints.some((hint)=>normalized.includes(hint))) return tag;
  }
  return "";
}

export function detectRepeatedMistake(item = {}, observedMatch = {}){
  const derived = observedMatch?.derivedTags || {};
  const narrative = String(observedMatch?.narrative || "").toLowerCase();
  const targetTag = extractTagFromText(item?.key || item?.label || "");
  const evidenceEvents = Number(observedMatch?.evidenceEvents || 0);
  if(!targetTag && evidenceEvents < 2) return { status: "not_triggered", notes: "Sin evidencia suficiente para evaluar." };
  const value = targetTag ? Number(derived[targetTag] || 0) : 0;
  if(targetTag === "finishing_failure"){
    if(evidenceEvents < 2 && value === 0) return { status: "not_triggered", notes: "Sin eventos suficientes para medir finishing_failure." };
    if(value >= 0.5) return { status: "regressed", notes: "El error de definición sigue alto.", evidence: { tag: targetTag, value } };
    if(value <= 0.2) return { status: "improved", notes: "La señal de error de definición bajó.", evidence: { tag: targetTag, value } };
    return { status: "unchanged", notes: "La señal de definición se mantiene similar.", evidence: { tag: targetTag, value } };
  }
  if(targetTag){
    if(value >= 0.3) return { status: "improved", notes: "La señal faltante ahora aparece en observación.", evidence: { tag: targetTag, value } };
    if(evidenceEvents < 2) return { status: "not_triggered", notes: "Fase con poca evidencia." };
    return { status: "unchanged", notes: "No hay evidencia clara de mejora en la señal.", evidence: { tag: targetTag, value } };
  }
  if(narrative && /mejor|control|ajuste|coheren/.test(narrative)) return { status: "improved", notes: "La narrativa refleja ajuste positivo." };
  return { status: "not_triggered", notes: "No se pudo mapear el item a señal estructurada." };
}

export function detectRuleEvidence(item = {}, observedMatch = {}){
  const text = `${item?.key || ""} ${item?.label || ""} ${item?.ruleRef?.id || ""} ${item?.ruleRef?.logic || ""} ${item?.ruleRef?.effect || ""}`.toLowerCase();
  const derived = observedMatch?.derivedTags || {};
  const triggerIds = toArray(observedMatch?.triggerIds).join(" ").toLowerCase();
  const sceneId = String(observedMatch?.sceneId || "").toLowerCase();
  const targetTag = extractTagFromText(text);
  if(triggerIds.includes(item?.key) || sceneId.includes(item?.key)){
    return { status: "improved", notes: "La regla aparece en triggers/sceneId.", evidence: { triggerIds: observedMatch?.triggerIds, sceneId } };
  }
  if(targetTag && Number(derived[targetTag] || 0) >= 0.3){
    return { status: "improved", notes: "La regla tiene evidencia indirecta en tags observados.", evidence: { tag: targetTag, value: Number(derived[targetTag] || 0) } };
  }
  if(Number(observedMatch?.evidenceEvents || 0) < 2) return { status: "not_triggered", notes: "Sin contexto suficiente para activar regla." };
  return { status: "unchanged", notes: "No hay activación observable de la regla." };
}

export function classifyAuditObservation(itemResults = []){
  const statuses = toArray(itemResults).map((row)=>row?.status).filter(Boolean);
  if(!statuses.length) return "not_triggered";
  if(statuses.some((s)=>s === "regressed")) return "regressed";
  if(statuses.some((s)=>s === "improved")) return "improved";
  if(statuses.every((s)=>s === "not_triggered")) return "not_triggered";
  return "unchanged";
}

export function recomputeAuditAggregate(audit = {}){
  const observations = toArray(audit?.observations);
  const metrics = {
    totalObservedMatches: observations.length,
    improvements: observations.filter((row)=>row.status === "improved").length,
    unchanged: observations.filter((row)=>row.status === "unchanged").length,
    regressions: observations.filter((row)=>row.status === "regressed").length,
    notTriggered: observations.filter((row)=>row.status === "not_triggered").length,
    triggeredRules: observations.reduce((acc, row)=>acc + Math.max(0, Number(row?.evidence?.triggeredRules || 0)), 0),
    lastObservedAt: observations.length ? observations[observations.length - 1].observedAt : null,
    lastStatus: observations.length ? observations[observations.length - 1].status : "unchanged"
  };
  let aggregateStatus = "unchanged";
  if(metrics.improvements > 0 && metrics.regressions === 0) aggregateStatus = "improved";
  else if(metrics.regressions > 0 && metrics.improvements === 0) aggregateStatus = "regressed";
  else if(metrics.improvements > 0 && metrics.regressions > 0) aggregateStatus = "mixed";
  return { aggregateStatus, metrics };
}

export function observeAuditAgainstMatch(audit = {}, observedMatch = {}){
  const trackedItems = toArray(audit?.trackedItems);
  const itemResults = trackedItems.map((item)=>{
    if(item.kind === "rule") return { itemId: item.id, kind: item.kind, ...detectRuleEvidence(item, observedMatch) };
    if(item.kind === "missed_signal") return { itemId: item.id, kind: item.kind, ...detectRepeatedMistake(item, observedMatch) };
    return { itemId: item.id, kind: item.kind, ...detectRepeatedMistake(item, observedMatch) };
  });
  const status = classifyAuditObservation(itemResults);
  const observation = {
    observedMatchId: safeText(observedMatch?.matchId || ""),
    observedAt: safeText(observedMatch?.observedAt || new Date().toISOString()),
    status,
    notes: itemResults.map((row)=>`${row.kind}:${row.status}`).join(" | "),
    evidence: {
      phase: safeText(observedMatch?.phase || ""),
      comparisonMetrics: observedMatch?.comparisonMetrics || {},
      triggeredRules: itemResults.filter((row)=>row.kind === "rule" && row.status === "improved").length,
      items: itemResults
    }
  };
  const next = {
    ...audit,
    observations: [...toArray(audit?.observations), observation].slice(-120)
  };
  const recomputed = recomputeAuditAggregate(next);
  next.aggregateStatus = recomputed.aggregateStatus;
  next.metrics = recomputed.metrics;
  return next;
}

export function observeLearningAuditsForMatch(mneState = {}, { matchId = "", observedMatch = null } = {}){
  const next = mneState && typeof mneState === "object" ? { ...mneState } : {};
  next.claudeExchange = next.claudeExchange && typeof next.claudeExchange === "object" ? { ...next.claudeExchange } : {};
  next.claudeExchange.learningAudit = normalizeLearningAuditState(next.claudeExchange.learningAudit);
  if(!observedMatch || !matchId) return next;
  next.claudeExchange.learningAudit.audits = next.claudeExchange.learningAudit.audits.map((audit)=>{
    if(safeText(audit?.sourceMatchId) === safeText(matchId)) return audit;
    return observeAuditAgainstMatch(audit, observedMatch);
  });
  return next;
}

export { EXPORT_SCHEMA, FEEDBACK_SCHEMA, safeJsonPreview };

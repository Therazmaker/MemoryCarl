/**
 * UCL MEMORY LAYER
 * ─────────────────────────────────────────────────────────────────
 * Módulo separado de memoria para partidos de Champions League.
 * Se almacena en brainV2.uclMemory (namespace propio, no toca memories).
 *
 * Diseñado para conectarse con champions_knockout_engine.js:
 *   - computeEuropeanMaturityScore() puede llamar a getUclMaturityProfile()
 *     en lugar de depender solo de datos de liga.
 *   - Si no hay partidos UCL en memoria, el confidence baja explícitamente
 *     y se reporta en fallbackNotes — nunca silencioso.
 *
 * Estructura en brainV2.uclMemory:
 * {
 *   matches: { [teamKey]: UclMatchRecord[] },
 *   profiles: { [teamKey]: UclTeamProfile }
 * }
 * ─────────────────────────────────────────────────────────────────
 */

import { normalizeTeamIdentity, resolveTeamAliases } from './footballlab/readiness_memory.js';

// ─── Constantes ───────────────────────────────────────────────────

const UCL_COMPETITION_REGEX = /(champions|uefa\s*champions|ucl|champions\s*league)/i;

const UCL_KNOCKOUT_STAGE_REGEX =
  /(round\s*of\s*16|octavos|r16|quarter|cuartos|semi|final|knockout|eliminatoria|playoffs?\s*ucl)/i;

const UCL_GROUP_STAGE_REGEX = /(group|grupo|fase\s*de\s*grupos|league\s*phase|fase\s*liga)/i;

/**
 * Peso de cada tipo de partido en el cálculo de madurez.
 * Un partido de final vale 3x un partido de grupos.
 */
const UCL_STAGE_WEIGHTS = {
  final:       3.0,
  semi:        2.5,
  quarter:     2.0,
  r16:         1.5,
  group:       1.0,
  qualifier:   0.6,
  unknown:     0.8
};

/**
 * Umbrales para el confidence del perfil UCL.
 * Con ≥8 partidos KO el perfil es fiable. Con 0 es pura penalización.
 */
const UCL_CONFIDENCE_THRESHOLDS = {
  HIGH:   8,   // ≥8 partidos KO → confidence alta
  MEDIUM: 4,   // 4-7 → media
  LOW:    1,   // 1-3 → baja pero existe
  NONE:   0    // 0   → sin historial UCL
};

// ─── Helpers internos ─────────────────────────────────────────────

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseSortableDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (exact) return Date.UTC(+exact[1], +exact[2] - 1, +exact[3]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function detectUclStage(stage = '', phase = '', leg = '') {
  const text = `${stage} ${phase} ${leg}`.toLowerCase();
  if (/final/.test(text) && !/semi|quarter/.test(text)) return 'final';
  if (/semi/.test(text))    return 'semi';
  if (/quarter|cuarto/.test(text)) return 'quarter';
  if (/round.*16|octavo|r16/.test(text)) return 'r16';
  if (UCL_GROUP_STAGE_REGEX.test(text)) return 'group';
  if (/qualif|previa|playoff/.test(text)) return 'qualifier';
  if (UCL_KNOCKOUT_STAGE_REGEX.test(text)) return 'r16'; // fallback KO genérico
  return 'unknown';
}

function isUclMatch(record = {}) {
  const competition = String(record?.competition || record?.league || '');
  return UCL_COMPETITION_REGEX.test(competition);
}

function buildTeamKey(teamId = '', teamName = '') {
  if (teamId) return `id:${teamId}`;
  const normalized = normalizeTeamIdentity(teamName);
  return normalized ? `name:${normalized}` : '';
}

function parseScore(score = '') {
  const match = String(score).match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) return null;
  return { gf: +match[1], ga: +match[2] };
}

// ─── Tipos internos (JSDoc) ───────────────────────────────────────

/**
 * @typedef {Object} UclMatchRecord
 * @property {string} id           - ID único del partido
 * @property {string} teamId
 * @property {string} teamName
 * @property {string} opponent
 * @property {string} score        - "2-1"
 * @property {string} result       - "W" | "L" | "D"
 * @property {string} stage        - 'group' | 'r16' | 'quarter' | 'semi' | 'final'
 * @property {string} leg          - "ida" | "vuelta" | ""
 * @property {boolean} isKnockout
 * @property {boolean} isHome
 * @property {string} season       - "2024-25"
 * @property {string} date
 * @property {number} stageWeight  - peso del partido en el scoring
 */

/**
 * @typedef {Object} UclTeamProfile
 * @property {string}  teamKey
 * @property {string}  teamName
 * @property {number}  totalMatches
 * @property {number}  koMatches       - partidos de fase eliminatoria
 * @property {number}  groupMatches
 * @property {number}  wins
 * @property {number}  draws
 * @property {number}  losses
 * @property {number}  goalsFor
 * @property {number}  goalsAgainst
 * @property {number}  koWins          - eliminatorias ganadas (avanzó)
 * @property {number}  koEliminations  - eliminatorias perdidas
 * @property {number}  deepRuns        - semis o finales jugadas
 * @property {string}  confidenceLevel - 'high' | 'medium' | 'low' | 'none'
 * @property {number}  maturityScore   - 0-100
 * @property {string}  maturityLabel
 * @property {string}  updatedAt
 */

// ─── API pública ──────────────────────────────────────────────────

/**
 * Inicializa el namespace UCL en brainV2 si no existe.
 */
export function ensureUclMemoryNamespace(brainV2 = {}) {
  if (!brainV2.uclMemory || typeof brainV2.uclMemory !== 'object') {
    brainV2.uclMemory = { matches: {}, profiles: {} };
  }
  if (!brainV2.uclMemory.matches) brainV2.uclMemory.matches = {};
  if (!brainV2.uclMemory.profiles) brainV2.uclMemory.profiles = {};
  return brainV2.uclMemory;
}

/**
 * Guarda un partido UCL en la memoria del equipo.
 * Si el partido no es de Champions, lo rechaza y devuelve { saved: false }.
 *
 * @param {Object} brainV2
 * @param {Object} matchData - datos del partido a guardar
 * @returns {{ saved: boolean, reason?: string, teamKey?: string }}
 */
export function saveUclMatch(brainV2 = {}, matchData = {}) {
  if (!isUclMatch(matchData)) {
    return { saved: false, reason: 'NOT_UCL: competition does not match Champions League.' };
  }

  const teamId   = String(matchData?.teamId   || '').trim();
  const teamName = String(matchData?.teamName || '').trim();
  const teamKey  = buildTeamKey(teamId, teamName);

  if (!teamKey) {
    return { saved: false, reason: 'MISSING_TEAM: teamId or teamName required.' };
  }

  const ucl = ensureUclMemoryNamespace(brainV2);
  if (!ucl.matches[teamKey]) ucl.matches[teamKey] = [];

  const stage = detectUclStage(
    matchData?.stage || '',
    matchData?.phase || '',
    matchData?.leg   || ''
  );

  const scoreData = parseScore(matchData?.score || '');
  const result    = scoreData
    ? (scoreData.gf > scoreData.ga ? 'W' : scoreData.gf < scoreData.ga ? 'L' : 'D')
    : (String(matchData?.result || '').toUpperCase() || 'D');

  const record = {
    id:          String(matchData?.id || `ucl_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    teamId,
    teamName,
    opponent:    String(matchData?.opponent    || '').trim(),
    score:       String(matchData?.score       || '').trim(),
    result,
    stage,
    leg:         String(matchData?.leg || matchData?.roundLeg || '').trim(),
    isKnockout:  UCL_KNOCKOUT_STAGE_REGEX.test(`${matchData?.stage || ''} ${matchData?.phase || ''}`),
    isHome:      Boolean(matchData?.isHome ?? matchData?.home === matchData?.teamName),
    season:      String(matchData?.season || '').trim(),
    date:        String(matchData?.date   || '').trim(),
    stageWeight: UCL_STAGE_WEIGHTS[stage] ?? 0.8
  };

  // Evitar duplicados por ID
  const existingIdx = ucl.matches[teamKey].findIndex((r) => r.id === record.id);
  if (existingIdx >= 0) {
    ucl.matches[teamKey][existingIdx] = record;
  } else {
    ucl.matches[teamKey].push(record);
  }

  // Ordenar por fecha
  ucl.matches[teamKey].sort((a, b) => parseSortableDate(a.date) - parseSortableDate(b.date));

  // Recalcular perfil
  const profile = _buildUclProfile(teamKey, teamName || teamId, ucl.matches[teamKey]);
  ucl.profiles[teamKey] = profile;

  return { saved: true, teamKey, stage, record };
}

/**
 * Importa un array de partidos UCL de una vez (útil para cargar historial manual).
 *
 * @param {Object} brainV2
 * @param {Object[]} matchArray
 * @returns {{ saved: number, skipped: number, details: Object[] }}
 */
export function bulkSaveUclMatches(brainV2 = {}, matchArray = []) {
  let saved = 0, skipped = 0;
  const details = [];
  for (const match of matchArray) {
    const result = saveUclMatch(brainV2, match);
    if (result.saved) saved++; else skipped++;
    details.push(result);
  }
  return { saved, skipped, details };
}

/**
 * Devuelve los partidos UCL almacenados para un equipo.
 * Resuelve por teamId, teamName y aliases.
 *
 * @param {Object} brainV2
 * @param {{ teamId?: string, teamName?: string, onlyKnockout?: boolean, limit?: number }} opts
 * @returns {{ rows: UclMatchRecord[], evidence: Object }}
 */
export function getUclMatchesForTeam(brainV2 = {}, {
  teamId       = '',
  teamName     = '',
  onlyKnockout = false,
  limit        = 20
} = {}) {
  const ucl     = ensureUclMemoryNamespace(brainV2);
  const aliases = new Set(resolveTeamAliases(teamName));
  const directKey = buildTeamKey(teamId, teamName);

  // Recolectar de todas las claves que coincidan
  const allRows = [];
  for (const [key, rows] of Object.entries(ucl.matches)) {
    const keyMatches = key === directKey
      || (teamId   && key === `id:${teamId}`)
      || (teamName && [...aliases].some((a) => key === `name:${normalizeTeamIdentity(a)}`));

    if (keyMatches && Array.isArray(rows)) {
      allRows.push(...rows);
    }
  }

  // Deduplicar por ID
  const seen = new Set();
  const unique = allRows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id); return true;
  });

  const filtered = onlyKnockout ? unique.filter((r) => r.isKnockout) : unique;
  const sorted   = filtered.sort((a, b) => parseSortableDate(a.date) - parseSortableDate(b.date));
  const rows     = sorted.slice(-Math.max(1, Number(limit) || 20));

  return {
    rows,
    evidence: {
      source:        'brainV2.uclMemory',
      totalFound:    unique.length,
      koMatches:     unique.filter((r) => r.isKnockout).length,
      groupMatches:  unique.filter((r) => r.stage === 'group').length,
      filtered:      filtered.length,
      returned:      rows.length,
      onlyKnockout,
      aliases:       [...aliases]
    }
  };
}

/**
 * Construye y cachea el perfil UCL de un equipo.
 * Esta es la función central que el knockout engine debe llamar.
 *
 * @param {Object} brainV2
 * @param {{ teamId?: string, teamName?: string }} opts
 * @returns {UclTeamProfile}
 */
export function getUclMaturityProfile(brainV2 = {}, {
  teamId   = '',
  teamName = ''
} = {}) {
  const ucl      = ensureUclMemoryNamespace(brainV2);
  const teamKey  = buildTeamKey(teamId, teamName);

  // Si el perfil está cacheado y reciente, devolverlo directamente
  const cached = ucl.profiles[teamKey];
  if (cached && _isProfileFresh(cached)) return cached;

  // Reconstruir desde partidos
  const { rows } = getUclMatchesForTeam(brainV2, { teamId, teamName });
  const profile  = _buildUclProfile(teamKey, teamName || teamId, rows);
  if (teamKey) ucl.profiles[teamKey] = profile;

  return profile;
}

/**
 * Elimina todos los partidos UCL de un equipo y resetea su perfil.
 */
export function clearUclTeamHistory(brainV2 = {}, { teamId = '', teamName = '' } = {}) {
  const ucl     = ensureUclMemoryNamespace(brainV2);
  const teamKey = buildTeamKey(teamId, teamName);
  if (!teamKey) return { cleared: false, reason: 'MISSING_TEAM' };

  delete ucl.matches[teamKey];
  delete ucl.profiles[teamKey];
  return { cleared: true, teamKey };
}

// ─── Cálculo del perfil ───────────────────────────────────────────

/**
 * Construye un UclTeamProfile completo desde un array de partidos.
 * @private
 */
function _buildUclProfile(teamKey = '', teamName = '', rows = []) {
  const ko     = rows.filter((r) => r.isKnockout);
  const groups = rows.filter((r) => r.stage === 'group');

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  let koWins = 0, koEliminations = 0, deepRuns = 0;
  let weightedWins = 0, weightedTotal = 0;

  for (const r of rows) {
    const w = r.stageWeight ?? 1;
    weightedTotal += w;
    if (r.result === 'W') { wins++;   weightedWins += w; }
    if (r.result === 'D') draws++;
    if (r.result === 'L') losses++;
    const sc = parseScore(r.score);
    if (sc) { gf += sc.gf; ga += sc.ga; }
  }

  // Analizar eliminatorias: agrupar por opponent+season para detectar si pasó o no
  const koTies = _groupKoTies(ko);
  for (const tie of koTies) {
    if (tie.advanced) koWins++;
    else               koEliminations++;
    if (tie.stage === 'semi' || tie.stage === 'final') deepRuns++;
  }

  const total = rows.length;
  const confidenceLevel = _resolveConfidenceLevel(ko.length);
  const maturityScore   = _computeMaturityScore({
    total, koMatches: ko.length, groupMatches: groups.length,
    weightedWins, weightedTotal, koWins, koEliminations,
    deepRuns, gf, ga, confidenceLevel
  });

  return {
    teamKey,
    teamName,
    totalMatches:    total,
    koMatches:       ko.length,
    groupMatches:    groups.length,
    wins,
    draws,
    losses,
    goalsFor:        gf,
    goalsAgainst:    ga,
    koWins,
    koEliminations,
    deepRuns,
    confidenceLevel,
    maturityScore,
    maturityLabel:   _maturityLabel(maturityScore, confidenceLevel),
    updatedAt:       new Date().toISOString()
  };
}

/**
 * Agrupa partidos KO por eliminatoria (opponent + season aproximado)
 * para determinar si el equipo avanzó o fue eliminado.
 * @private
 */
function _groupKoTies(koRows = []) {
  const tieMap = new Map();

  for (const r of koRows) {
    // Clave de eliminatoria: season + opponent + stage
    const tieKey = `${r.season || 'unknown'}|${normalizeTeamIdentity(r.opponent)}|${r.stage}`;
    if (!tieMap.has(tieKey)) {
      tieMap.set(tieKey, { key: tieKey, stage: r.stage, legs: [], advanced: false });
    }
    tieMap.get(tieKey).legs.push(r);
  }

  // Determinar si avanzó: mayoría de W o último partido es W
  for (const tie of tieMap.values()) {
    const ws = tie.legs.filter((l) => l.result === 'W').length;
    const ls = tie.legs.filter((l) => l.result === 'L').length;
    // Si solo hay un partido (leg suelta), W = avanzó, L = eliminado
    tie.advanced = ws > ls || (tie.legs.length === 1 && tie.legs[0].result === 'W');
  }

  return [...tieMap.values()];
}

/**
 * Calcula el maturityScore (0-100) ponderando calidad y cantidad del historial UCL.
 * @private
 */
function _computeMaturityScore({
  total, koMatches, groupMatches,
  weightedWins, weightedTotal,
  koWins, koEliminations,
  deepRuns, gf, ga,
  confidenceLevel
}) {
  if (total === 0) return 0;

  // 1. Win rate ponderada por importancia del partido
  const weightedWinRate = weightedTotal > 0 ? (weightedWins / weightedTotal) * 100 : 40;

  // 2. Bono por experiencia KO
  const koExperienceBonus = clamp(koMatches * 3.5, 0, 28);

  // 3. Bono por deep runs (semis/finales)
  const deepRunBonus = clamp(deepRuns * 6, 0, 24);

  // 4. Ratio de eliminación: penalizar si pierde muchas KO
  const totalKoTies = koWins + koEliminations;
  const koPassRate  = totalKoTies > 0 ? (koWins / totalKoTies) * 100 : 50;

  // 5. Estabilidad defensiva en UCL
  const avgGa          = total > 0 ? ga / total : 1.5;
  const defensiveScore = clamp(100 - (avgGa * 30), 20, 85);

  // 6. Penalización si confidenceLevel es bajo (historial escaso)
  const confidencePenalty = {
    high:   0,
    medium: 8,
    low:    18,
    none:   40
  }[confidenceLevel] ?? 20;

  const raw = (
    weightedWinRate   * 0.30 +
    koPassRate        * 0.25 +
    koExperienceBonus * 0.20 +
    deepRunBonus      * 0.15 +
    defensiveScore    * 0.10
  ) - confidencePenalty;

  return clamp(Math.round(raw), 0, 100);
}

function _resolveConfidenceLevel(koCount = 0) {
  if (koCount >= UCL_CONFIDENCE_THRESHOLDS.HIGH)   return 'high';
  if (koCount >= UCL_CONFIDENCE_THRESHOLDS.MEDIUM)  return 'medium';
  if (koCount >= UCL_CONFIDENCE_THRESHOLDS.LOW)     return 'low';
  return 'none';
}

function _maturityLabel(score = 0, confidenceLevel = 'none') {
  if (confidenceLevel === 'none') return 'sin_historial_ucl';
  if (score >= 72) return 'elite';
  if (score >= 58) return 'experimentado';
  if (score >= 42) return 'con_roce';
  if (score >= 25) return 'novato_europeo';
  return 'sin_historial_ucl';
}

function _isProfileFresh(profile = {}) {
  if (!profile?.updatedAt) return false;
  const age = Date.now() - new Date(profile.updatedAt).getTime();
  return age < 1000 * 60 * 5; // fresco si tiene menos de 5 minutos
}

// ─── Bridge con champions_knockout_engine ────────────────────────

/**
 * Reemplaza o enriquece computeEuropeanMaturityScore() con datos UCL reales.
 *
 * Uso en champions_knockout_engine.js:
 *
 *   import { enrichEuropeanMaturityWithUcl } from './ucl_memory_layer.js';
 *
 *   // Antes de computeEuropeanMaturityScore(), llamar:
 *   const uclEnrichment = enrichEuropeanMaturityWithUcl(brainV2, {
 *     teamName: match.home, side: 'home', fallbackNotes
 *   });
 *   // Pasar uclEnrichment.score como override si confidenceLevel !== 'none'
 *
 * @param {Object} brainV2
 * @param {{ teamName: string, teamId?: string, side?: string, fallbackNotes?: string[] }} opts
 * @returns {{ score: number, source: string, confidence: number, profile: UclTeamProfile, reasons: string[] }}
 */
export function enrichEuropeanMaturityWithUcl(brainV2 = {}, {
  teamName     = 'Equipo',
  teamId       = '',
  side         = 'home',
  fallbackNotes = []
} = {}) {
  const profile = getUclMaturityProfile(brainV2, { teamId, teamName });

  const reasons = [];

  if (profile.confidenceLevel === 'none') {
    fallbackNotes.push(
      `${teamName} (${side}): Sin historial UCL en memoria. European Maturity calculada por liga (penalización -18 pts).`
    );
    reasons.push(`⚠️ ${teamName} sin partidos Champions en memoria — score basado en liga.`);
    reasons.push('Primeras eliminatorias = máxima incertidumbre europea.');
    return {
      score:      null, // null = usar fallback de liga en el engine original
      source:     'league_fallback',
      confidence: 0.32,
      profile,
      reasons
    };
  }

  // Tenemos datos UCL reales
  reasons.push(
    `${teamName} acumula ${profile.koMatches} partidos KO en Champions (${profile.koWins}W/${profile.koEliminations}E).`
  );
  if (profile.deepRuns > 0) {
    reasons.push(`Ha llegado a ${profile.deepRuns} semis/finales — experiencia de big night probada.`);
  }
  if (profile.confidenceLevel === 'low') {
    fallbackNotes.push(
      `${teamName} (${side}): Historial UCL limitado (${profile.koMatches} KO). Score parcialmente confiable.`
    );
    reasons.push(`Muestra pequeña (${profile.koMatches} KO) — score UCL con margen de error.`);
  }

  const confidenceMap = { high: 0.88, medium: 0.72, low: 0.54, none: 0.32 };

  return {
    score:      profile.maturityScore,
    source:     'ucl_memory',
    confidence: confidenceMap[profile.confidenceLevel] ?? 0.54,
    profile,
    reasons
  };
}

/**
 * Genera un resumen legible del estado UCL de un equipo.
 * Útil para mostrar en la UI junto al prematch.
 *
 * @param {Object} brainV2
 * @param {{ teamName: string, teamId?: string }} opts
 * @returns {Object}
 */
export function getUclSummaryCard(brainV2 = {}, { teamName = '', teamId = '' } = {}) {
  const profile = getUclMaturityProfile(brainV2, { teamId, teamName });

  const hasHistory = profile.confidenceLevel !== 'none';

  return {
    teamName:        profile.teamName || teamName,
    maturityScore:   profile.maturityScore,
    maturityLabel:   profile.maturityLabel,
    confidenceLevel: profile.confidenceLevel,
    hasHistory,
    summary: hasHistory
      ? `${profile.koMatches} partidos KO | ${profile.koWins} series ganadas | ${profile.deepRuns} deep runs`
      : 'Sin historial UCL registrado',
    alert: !hasHistory
      ? '⚠️ Este equipo no tiene partidos Champions en memoria. Los scores europeos son estimaciones por liga.'
      : profile.confidenceLevel === 'low'
        ? `⚡ Historial UCL limitado (${profile.koMatches} partidos KO). Usar con cautela.`
        : null,
    stats: {
      total:          profile.totalMatches,
      ko:             profile.koMatches,
      group:          profile.groupMatches,
      wins:           profile.wins,
      draws:          profile.draws,
      losses:         profile.losses,
      goalsFor:       profile.goalsFor,
      goalsAgainst:   profile.goalsAgainst,
      koWins:         profile.koWins,
      koEliminations: profile.koEliminations,
      deepRuns:       profile.deepRuns
    }
  };
}

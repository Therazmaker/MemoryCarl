import { narrativePatterns, teamRegex } from "../../narrative_patterns.js";
import { clampVisionMinute } from "./vision_tensor.js";

const MINUTE_REGEX = /(\d+)(?:\+(\d+))?\s*'/;

const LEGACY_EVENT_PATTERNS = [
  { type: "shots", regex: /\b(remate|disparo|shot|shoot)\b/i },
  { type: "shots_on_target", regex: /\b(a puerta|entre los tres palos|on target|tiro al arco)\b/i },
  { type: "big_chances", regex: /\b(gran ocasi[oó]n|ocasi[oó]n clar[ae]|big chance)\b/i },
  { type: "corners", regex: /\b(c[oó]rner|corner|saque de esquina)\b/i },
  { type: "attacks", regex: /\b(ataque|attack)\b/i },
  { type: "dangerous_attacks", regex: /\b(ataque peligroso|dangerous attack|jugada peligrosa)\b/i },
  { type: "possession", regex: /\b(posesi[oó]n|possession)\b/i },
  { type: "fouls", regex: /\b(falta|foul)\b/i },
  { type: "yellow", regex: /\b(tarjeta amarilla|yellow card|amonestado)\b/i },
  { type: "red", regex: /\b(tarjeta roja|red card|expulsado)\b/i },
  { type: "saves", regex: /\b(parada|atajada|save)\b/i },
  { type: "offsides", regex: /\b(fuera de juego|offside)\b/i }
];

const NARRATIVE_CLASSIFICATION = [
  { category: "critical", regex: /\b(gol anulado|gol|penal|penalty|expulsi[oó]n|tarjeta roja|red card)\b/i },
  { category: "dangerous_attack", regex: /\b(gran oportunidad|ocasi[oó]n clar[ae]|al poste|larguero|desviado por poco|dentro del [aá]rea|parada brillante)\b/i },
  { category: "attack", regex: /\b(dispara|disparo|remate|cabezazo|oportunidad|tiro|shot)\b/i },
  { category: "light_attack", regex: /\b(centro|pase peligroso|ataque cortado|centro peligroso)\b/i },
  { category: "defense", regex: /\b(bloquea|intercepta|despeje|despeja|bloqueo)\b/i },
  { category: "interruption", regex: /\b(falta|tarjeta|fuera de juego|offside|lesi[oó]n|sustituci[oó]n|cambio)\b/i }
];

const NARRATIVE_TYPE_TO_VISION_ROW = Object.freeze({
  shot: "shots",
  big_chance: "big_chances",
  save: "saves",
  post: "big_chances",
  corner: "corners",
  danger_pass: "dangerous_attacks",
  goal: "dangerous_attacks",
  foul: "fouls",
  yellow: "yellow",
  red: "red",
  offside: "offsides",
  attack: "attacks",
  dangerous_attack: "dangerous_attacks",
  light_attack: "attacks",
  defense: "attacks",
  interruption: "fouls",
  critical: "dangerous_attacks"
});

function normalizeNarrativeLines(narrativeRaw){
  if(Array.isArray(narrativeRaw)) return narrativeRaw.map((line)=>String(line || ""));
  return String(narrativeRaw || "")
    .split(/\n+/)
    .map((line)=>line.trim())
    .filter(Boolean);
}

function normalizePattern(pattern=""){
  return String(pattern || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(text=""){
  return normalizePattern(text);
}

function detectNarrativeClass(line=""){
  const normalized = normalizeText(line);
  return NARRATIVE_CLASSIFICATION.find((entry)=>entry.regex.test(normalized))?.category || "attack";
}

export function parseNarrativeMinute(line=""){
  const match = String(line).match(MINUTE_REGEX);
  if(!match) return null;
  const base = Number(match[1] || 0);
  const extra = Number(match[2] || 0);
  return clampVisionMinute(base + extra);
}

export function detectNarrativeTeam(line=""){
  const match = String(line).match(teamRegex);
  if(!match) return "unknown";
  const teamRaw = String(match[1] || "").trim();
  if(!teamRaw) return "unknown";
  const compact = teamRaw
    .replace(/\b(fc|cf|utd|united|club|deportivo|athletic|city)\b/gi, "")
    .trim();
  const teamName = compact || teamRaw;
  return teamName.split(/\s+/).slice(0, 2).join(" ");
}

function extractPatternEvents(line=""){
  const normalized = normalizeText(line);
  const seen = new Set();
  const found = [];
  narrativePatterns.forEach((patternDef)=>{
    const hit = patternDef.patterns.some((pattern)=>normalized.includes(normalizePattern(pattern)));
    if(!hit || seen.has(patternDef.type)) return;
    seen.add(patternDef.type);
    found.push({
      type: patternDef.type,
      weight: patternDef.weight,
      visionType: NARRATIVE_TYPE_TO_VISION_ROW[patternDef.type] || null
    });
  });
  return found;
}

export function extractEvents(narrativeRaw=""){
  const lines = normalizeNarrativeLines(narrativeRaw);
  const events = [];
  lines.forEach((line, lineIndex)=>{
    const minute = parseNarrativeMinute(line);
    if(minute===null) return;

    const team = detectNarrativeTeam(line);
    const narrativeClass = detectNarrativeClass(line);
    const patternEvents = extractPatternEvents(line);

    patternEvents.forEach((ev)=>{
      if(!ev.visionType) return;
      events.push({
        type: ev.visionType,
        minute,
        source: "narrative",
        lineIndex,
        raw: line,
        team,
        narrativeType: ev.type,
        narrativeClass,
        weight: ev.weight
      });
    });

    if(!patternEvents.length){
      const fallbackType = NARRATIVE_TYPE_TO_VISION_ROW[narrativeClass] || null;
      if(fallbackType){
        events.push({
          type: fallbackType,
          minute,
          source: "narrative",
          lineIndex,
          raw: line,
          team,
          narrativeType: narrativeClass,
          narrativeClass,
          weight: 1
        });
      }
    }

    LEGACY_EVENT_PATTERNS.forEach((pattern)=>{
      if(pattern.regex.test(line) && !events.some((ev)=>ev.minute===minute && ev.lineIndex===lineIndex && ev.type===pattern.type)){
        events.push({ type: pattern.type, minute, source: "narrative", lineIndex, raw: line, team, narrativeClass, weight: 1 });
      }
    });
  });
  return events;
}

export function mapTimelineEventToVisionType(event={}){
  const text = `${event?.type || ""} ${event?.event || ""} ${event?.text || ""}`.toLowerCase();

  const patternHit = extractPatternEvents(text).find((item)=>item.visionType);
  if(patternHit?.visionType) return patternHit.visionType;

  return LEGACY_EVENT_PATTERNS.find((pattern)=>pattern.regex.test(text))?.type || null;
}

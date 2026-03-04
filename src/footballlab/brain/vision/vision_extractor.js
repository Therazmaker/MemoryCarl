import { clampVisionMinute } from "./vision_tensor.js";

const MINUTE_REGEX = /(\d+)(?:\+(\d+))?\s*'/;

const EVENT_PATTERNS = [
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

function normalizeNarrativeLines(narrativeRaw){
  if(Array.isArray(narrativeRaw)) return narrativeRaw.map((line)=>String(line || ""));
  return String(narrativeRaw || "")
    .split(/\n+/)
    .map((line)=>line.trim())
    .filter(Boolean);
}

export function parseNarrativeMinute(line=""){
  const match = String(line).match(MINUTE_REGEX);
  if(!match) return null;
  const base = Number(match[1] || 0);
  const extra = Number(match[2] || 0);
  return clampVisionMinute(base + extra);
}

export function extractEvents(narrativeRaw=""){
  const lines = normalizeNarrativeLines(narrativeRaw);
  const events = [];
  lines.forEach((line, lineIndex)=>{
    const minute = parseNarrativeMinute(line);
    if(minute===null) return;
    EVENT_PATTERNS.forEach((pattern)=>{
      if(pattern.regex.test(line)){
        events.push({ type: pattern.type, minute, source: "narrative", lineIndex, raw: line });
      }
    });
  });
  return events;
}

export function mapTimelineEventToVisionType(event={}){
  const text = `${event?.type || ""} ${event?.event || ""} ${event?.text || ""}`.toLowerCase();
  return EVENT_PATTERNS.find((pattern)=>pattern.regex.test(text))?.type || null;
}

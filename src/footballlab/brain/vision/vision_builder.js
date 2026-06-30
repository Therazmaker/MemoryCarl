import { extractEvents, mapTimelineEventToVisionType } from "./vision_extractor.js";
import {
  clampVisionMinute,
  createEmptyVisionMatrix,
  normalizeVisionMatrix,
  toVisionTensor3D,
  VISION_EVENT_ROWS,
  VISION_TENSOR_SHAPE
} from "./vision_tensor.js";

const EVENT_INDEX = Object.fromEntries(VISION_EVENT_ROWS.map((name, index)=>[name, index]));

function accumulateEvent(matrix, eventType, minute, amount=1){
  const row = EVENT_INDEX[eventType];
  if(row===undefined) return;
  const clampedMinute = clampVisionMinute(minute);
  matrix[row][clampedMinute] += Math.max(0, Number(amount) || 0);
}

function includeTimelineEvents(matrix, timeline=[], maxMinute=VISION_TENSOR_SHAPE.minutes){
  timeline.forEach((event)=>{
    const minute = clampVisionMinute(Number(event?.minute || 0));
    if(minute >= maxMinute) return;
    const type = mapTimelineEventToVisionType(event);
    if(type) accumulateEvent(matrix, type, minute, Number(event?.value || 1));
  });
}

function includeNarrativeEvents(matrix, narrativeRaw, maxMinute=VISION_TENSOR_SHAPE.minutes){
  const events = extractEvents(narrativeRaw);
  events.forEach((event)=>{
    if(event.minute >= maxMinute) return;
    accumulateEvent(matrix, event.type, event.minute, 1);
  });
}

function includeStatSnapshots(matrix, snapshots={}, maxMinute=VISION_TENSOR_SHAPE.minutes){
  Object.entries(snapshots || {}).forEach(([minuteKey, statRow])=>{
    const minute = clampVisionMinute(Number(minuteKey));
    if(minute >= maxMinute) return;
    VISION_EVENT_ROWS.forEach((eventName)=>{
      const value = Number(statRow?.[eventName]);
      if(Number.isFinite(value) && value > 0) accumulateEvent(matrix, eventName, minute, value);
    });
  });
}

export function buildMatchVisionTensor(match={}, options={}){
  const liveMinute = Number(options?.liveMinute);
  const maxMinute = Number.isFinite(liveMinute)
    ? clampVisionMinute(liveMinute) + 1
    : VISION_TENSOR_SHAPE.minutes;
  const matrix = createEmptyVisionMatrix();

  includeTimelineEvents(matrix, Array.isArray(match?.timeline) ? match.timeline : [], maxMinute);
  includeNarrativeEvents(matrix, match?.narrativeRaw || match?.commentary || "", maxMinute);
  includeStatSnapshots(matrix, match?.liveAggregates || {}, maxMinute);

  const normalized = normalizeVisionMatrix(matrix);
  return {
    eventRows: VISION_EVENT_ROWS,
    matrix: normalized,
    tensor: toVisionTensor3D(normalized),
    shape: [VISION_TENSOR_SHAPE.events, VISION_TENSOR_SHAPE.minutes, VISION_TENSOR_SHAPE.channels]
  };
}

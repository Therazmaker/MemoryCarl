export const VISION_EVENT_ROWS = Object.freeze([
  "shots",
  "shots_on_target",
  "big_chances",
  "corners",
  "attacks",
  "dangerous_attacks",
  "possession",
  "fouls",
  "yellow",
  "red",
  "saves",
  "offsides"
]);

export const VISION_TENSOR_SHAPE = Object.freeze({
  events: VISION_EVENT_ROWS.length,
  minutes: 90,
  channels: 1
});

export function clampVisionMinute(minute){
  const numeric = Number(minute);
  if(!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(VISION_TENSOR_SHAPE.minutes - 1, Math.floor(numeric)));
}

export function createEmptyVisionMatrix(){
  return Array.from({ length: VISION_TENSOR_SHAPE.events }, ()=>
    Array(VISION_TENSOR_SHAPE.minutes).fill(0)
  );
}

export function normalizeVisionMatrix(matrix){
  return matrix.map((row)=>row.map((value)=>Math.min((Number(value) || 0) / 5, 1)));
}

export function toVisionTensor3D(matrix){
  return matrix.map((row)=>row.map((value)=>[Number(value) || 0]));
}

export function flattenVisionTensor3D(tensor3d){
  const flat = [];
  for(let y=0;y<VISION_TENSOR_SHAPE.events;y++){
    for(let x=0;x<VISION_TENSOR_SHAPE.minutes;x++){
      flat.push(Number(tensor3d?.[y]?.[x]?.[0]) || 0);
    }
  }
  return flat;
}

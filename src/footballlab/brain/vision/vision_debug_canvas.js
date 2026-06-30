import { VISION_EVENT_ROWS, VISION_TENSOR_SHAPE } from "./vision_tensor.js";

function colorForIntensity(value=0){
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  const hue = 220 - Math.round(clamped * 190);
  const light = 94 - Math.round(clamped * 50);
  return `hsl(${hue}, 90%, ${light}%)`;
}

export function renderVisionDebugCanvas(canvas, visionMatrix=[], options={}){
  if(!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const width = Number(options?.width) || 900;
  const height = Number(options?.height) || 240;
  canvas.width = width;
  canvas.height = height;

  const rows = VISION_TENSOR_SHAPE.events;
  const cols = VISION_TENSOR_SHAPE.minutes;
  const cellW = width / cols;
  const cellH = height / rows;

  ctx.clearRect(0, 0, width, height);
  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const value = Number(visionMatrix?.[y]?.[x]) || 0;
      ctx.fillStyle = colorForIntensity(value);
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  for(let y=0;y<=rows;y++){
    ctx.beginPath();
    ctx.moveTo(0, y * cellH);
    ctx.lineTo(width, y * cellH);
    ctx.stroke();
  }
  for(let x=0;x<=cols;x+=10){
    ctx.beginPath();
    ctx.moveTo(x * cellW, 0);
    ctx.lineTo(x * cellW, height);
    ctx.stroke();
  }

  if(options?.drawLabels){
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "10px sans-serif";
    VISION_EVENT_ROWS.forEach((rowName, rowIndex)=>{
      ctx.fillText(rowName, 4, rowIndex * cellH + 11);
    });
  }
}

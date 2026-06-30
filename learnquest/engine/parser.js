const MOVE_NAMES = ["moveRight","moveLeft","moveUp","moveDown"];

function trimLine(l){
  const s = String(l||"").trim();
  if(!s) return "";
  if(s.startsWith("//")) return "";
  return s;
}

function parseMove(line){
  // hero.moveRight() or hero.moveRight(3)
  for(const m of MOVE_NAMES){
    const rx = new RegExp(`^hero\\.${m}\\(\\s*(\\d+)?\\s*\\)\\s*$`);
    const match = line.match(rx);
    if(match){
      const n = match[1] ? parseInt(match[1], 10) : 1;
      return { type:"move", dir:m, n: Number.isFinite(n) && n>0 ? Math.min(n, 50) : 1 };
    }
  }
  return null;
}

function parseScan(line){
  const m = line.match(/^hero\.scan\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*$/);
  if(!m) return null;
  return { type:"scan", poi:m[1], varName:m[2] };
}

function parseDeliver(line){
  const m = line.match(/^hero\.deliver\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*$/);
  if(!m) return null;
  return { type:"deliver", poi:m[1], varName:m[2] };
}

function parseSet(line){
  const m = line.match(/^set\s+([a-zA-Z_$][\w$]*)\s*=\s*(.+)\s*$/);
  if(!m) return null;
  return { type:"set", varName:m[1], expr:m[2] };
}

export function parseProgram(text, allowed){
  const allowedSet = new Set((allowed||[]).map(String));

  const lines = String(text||"").split("\n");
  const actions = [];

  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const line = trimLine(raw);
    if(!line) continue;

    let node = parseMove(line) || parseScan(line) || parseDeliver(line) || parseSet(line);
    if(!node){
      return { ok:false, error:`Línea ${i+1}: comando inválido: ${line}`, actions:[] };
    }

    // Validate against allowed
    const key = node.type === "set" ? "set" : `hero.${node.type === "move" ? node.dir : node.type}`;
    if(!allowedSet.has(key)){
      return { ok:false, error:`Línea ${i+1}: comando bloqueado: ${key}`, actions:[] };
    }

    actions.push({ ...node, _line:i+1, _raw:line });
  }

  return { ok:true, error:"", actions };
}

export function evalExprConcat(expr, vars){
  const parts = String(expr||"").split("+").map(p=>p.trim()).filter(Boolean);
  if(parts.length===0) throw new Error("Expresión vacía.");

  let out = "";
  for(const part of parts){
    const str = part.match(/^"([^"]*)"$/);
    if(str){ out += str[1]; continue; }

    const v = part.match(/^([a-zA-Z_$][\w$]*)$/);
    if(v){
      const val = vars?.[v[1]];
      if(typeof val !== "string") throw new Error(`La variable ${v[1]} no existe o no es string.`);
      out += val;
      continue;
    }

    throw new Error(`Token no permitido en expresión: ${part}`);
  }

  return out;
}

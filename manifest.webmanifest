import { evalExprConcat } from "./parser.js";

function inBounds(level, hero){
  const w = Number(level?.board?.w||8);
  const h = Number(level?.board?.h||8);
  hero.x = Math.max(0, Math.min(w-1, hero.x));
  hero.y = Math.max(0, Math.min(h-1, hero.y));
}

function atPoi(state, poiId){
  const p = state.pois.get(String(poiId));
  if(!p) return false;
  return state.hero.x === p.x && state.hero.y === p.y;
}

export function applyAction(level, state, action){
  if(!action) return { ok:true };

  if(action.type === "move"){
    for(let i=0;i<action.n;i++){
      if(action.dir === "moveRight") state.hero.x++;
      if(action.dir === "moveLeft") state.hero.x--;
      if(action.dir === "moveUp") state.hero.y--;
      if(action.dir === "moveDown") state.hero.y++;
      inBounds(level, state.hero);
    }
    return { ok:true, msg:`${action.dir}${action.n>1?`(${action.n})`:""}` };
  }

  if(action.type === "scan"){
    const id = String(action.poi);
    const p = state.pois.get(id);
    if(!p) return { ok:false, error:`POI desconocido: ${id}` };
    if(!atPoi(state, id)) return { ok:false, error:`No estás en ${id}.` };
    if(typeof p.data !== "string") return { ok:false, error:`${id} no tiene dato para escanear.` };
    state.vars[action.varName] = p.data;
    state.flags.scanned[id] = true;
    return { ok:true, msg:`scan ${id} -> ${action.varName}` };
  }

  if(action.type === "set"){
    const val = evalExprConcat(action.expr, state.vars);
    state.vars[action.varName] = val;
    return { ok:true, msg:`set ${action.varName}` };
  }

  if(action.type === "deliver"){
    const id = String(action.poi);
    const p = state.pois.get(id);
    if(!p) return { ok:false, error:`POI desconocido: ${id}` };
    if(!atPoi(state, id)) return { ok:false, error:`No estás en ${id}.` };
    const val = state.vars[action.varName];
    if(typeof val !== "string") return { ok:false, error:`La variable ${action.varName} no existe o no es string.` };
    state.flags.delivered[id] = { var: action.varName, value: val };
    return { ok:true, msg:`deliver ${action.varName} -> ${id}` };
  }

  return { ok:false, error:`Acción no soportada: ${action.type}` };
}

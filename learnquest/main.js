const LS_CUSTOM = "lq_custom_levels_v1";
const LS_LAST_LEVEL = "lq_last_level_v1";

const $ = (id)=>document.getElementById(id);
const els = {
  sel: $("lqLevelSelect"),
  importBtn: $("lqImportBtn"),
  importFile: $("lqImportFile"),
  deleteBtn: $("lqDeleteBtn"),
  resetBtn: $("lqResetBtn"),
  runBtn: $("lqRunBtn"),
  stepBtn: $("lqStepBtn"),
  title: $("lqLevelTitle"),
  lesson: $("lqLesson"),
  story: $("lqStory"),
  hint: $("lqHint"),
  board: $("lqBoard"),
  pos: $("lqPos"),
  msg: $("lqMsg"),
  goalPill: $("lqGoalPill"),
  code: $("lqCode"),
  log: $("lqLog"),
  sub: $("lqSub")
};

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

function loadCustomLevels(){
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || "[]"); }
  catch { return []; }
}
function saveCustomLevels(levels){
  localStorage.setItem(LS_CUSTOM, JSON.stringify(levels));
}
function upsertCustomLevel(level){
  const levels = loadCustomLevels();
  const i = levels.findIndex(l => l.id === level.id);
  if(i>=0) levels[i]=level; else levels.push(level);
  saveCustomLevels(levels);
}
function deleteCustomLevel(id){
  const levels = loadCustomLevels().filter(l => l.id !== id);
  saveCustomLevels(levels);
}

async function fetchOfficialIndex(){
  const res = await fetch("./levels/index.json", { cache: "no-store" });
  if(!res.ok) throw new Error("No pude cargar levels/index.json");
  return await res.json();
}

function buildUnifiedIndex(officialIndex){
  const official = (officialIndex?.levels || []).map(l => ({...l, source:"official"}));
  const custom = loadCustomLevels().map(l => ({
    id: l.id,
    title: l.title || l.id,
    chapter: l.chapter || "Importados",
    file: null,
    source: "local"
  }));
  return [...official, ...custom];
}

function setLog(text){
  els.log.textContent = text || "";
}
function appendLog(line){
  els.log.textContent = (els.log.textContent ? els.log.textContent + "\n" : "") + line;
}
function safeStr(v){
  if(v === undefined || v === null) return "";
  if(typeof v === "string") return v;
  return JSON.stringify(v);
}

let unifiedIndex = [];
let currentLevel = null;
let state = null;
let queue = [];
let running = false;

function defaultCodeForLevel(level){
  // Small sensible starter
  if(level?.id?.includes("strings")) {
    return [
      "hero.moveUp()",
      "hero.moveUp()",
      "hero.moveUp()",
      "hero.moveUp()",
      "hero.scan(\"library\",\"msg\")",
      "",
      "set msg = msg + \" ✅\"",
      "",
      "hero.moveRight()",
      "hero.moveRight()",
      "hero.moveRight()",
      "hero.moveRight()",
      "hero.deliver(\"post\",\"msg\")"
    ].join("\n");
  }
  return "hero.moveRight()";
}

function validateLevel(level){
  if(!level || typeof level !== "object") throw new Error("Level inválido (no es objeto).");
  if(!level.id) throw new Error("Level inválido: falta id.");
  if(!level.title) throw new Error("Level inválido: falta title.");
  if(!level.board?.w || !level.board?.h) throw new Error("Level inválido: falta board.w/board.h");
  if(!level.spawn?.hero) throw new Error("Level inválido: falta spawn.hero");
  if(!Array.isArray(level.allowed)) throw new Error("Level inválido: falta allowed[]");
  if(!Array.isArray(level.goals)) throw new Error("Level inválido: falta goals[]");
}

async function loadLevelByMeta(meta){
  if(meta.source === "local"){
    const found = loadCustomLevels().find(l => l.id === meta.id);
    if(!found) throw new Error("No encontré el nivel importado.");
    return found;
  }
  const res = await fetch(meta.file, { cache: "no-store" });
  if(!res.ok) throw new Error("No pude cargar el nivel: " + meta.file);
  return await res.json();
}

function initState(level){
  state = {
    w: level.board.w,
    h: level.board.h,
    hero: { x: level.spawn.hero.x, y: level.spawn.hero.y },
    vars: {},
    flags: { scanned: {}, delivered: {} },
  };
}

function render(level){
  els.board.style.setProperty("--w", String(level.board.w));
  els.board.style.setProperty("--h", String(level.board.h));
  els.board.innerHTML = "";

  const poiMap = new Map();
  (level.pois || []).forEach(p => poiMap.set(`${p.x},${p.y}`, p));

  for(let y=0; y<level.board.h; y++){
    for(let x=0; x<level.board.w; x++){
      const d = document.createElement("div");
      d.className = "lq-cell" + (((x+y)%2) ? " dark" : "");
      const poi = poiMap.get(`${x},${y}`);
      if(poi){
        d.classList.add("poi");
        d.textContent = poi.icon || "◆";
      }
      if(state.hero.x===x && state.hero.y===y){
        d.classList.add("hero");
        d.textContent = "🧑‍🚀";
      }
      els.board.appendChild(d);
    }
  }

  els.pos.textContent = `(${state.hero.x}, ${state.hero.y})`;
  els.msg.textContent = state.vars.msg ? JSON.stringify(state.vars.msg) : "(vacío)";
}

function inBounds(){
  state.hero.x = Math.max(0, Math.min(state.w-1, state.hero.x));
  state.hero.y = Math.max(0, Math.min(state.h-1, state.hero.y));
}

function getPoiById(level, id){
  return (level.pois || []).find(p => p.id === id);
}
function atPoi(level, poiId){
  const p = getPoiById(level, poiId);
  if(!p) return false;
  return state.hero.x === p.x && state.hero.y === p.y;
}

function parseLine(line){
  const s = line.trim();
  if(!s || s.startsWith("//")) return { type:"noop" };

  const moveMatch = s.match(/^hero\.(moveRight|moveLeft|moveUp|moveDown)\(\)\s*$/);
  if(moveMatch) return { type:"move", dir: moveMatch[1] };

  const scanMatch = s.match(/^hero\.scan\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*$/);
  if(scanMatch) return { type:"scan", poi: scanMatch[1], varName: scanMatch[2] };

  const delMatch = s.match(/^hero\.deliver\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*$/);
  if(delMatch) return { type:"deliver", poi: delMatch[1], varName: delMatch[2] };

  const setMatch = s.match(/^set\s+([a-zA-Z_]\w*)\s*=\s*(.+)\s*$/);
  if(setMatch) return { type:"set", varName: setMatch[1], expr: setMatch[2] };

  return { type:"error", message:`Comando inválido: ${s}` };
}

function evalExpr(expr){
  const parts = expr.split("+").map(p=>p.trim()).filter(Boolean);
  if(parts.length===0) throw new Error("Expresión vacía.");

  let out = "";
  for(const part of parts){
    const strMatch = part.match(/^"([^"]*)"$/);
    if(strMatch){ out += strMatch[1]; continue; }

    const varMatch = part.match(/^([a-zA-Z_]\w*)$/);
    if(varMatch){
      const v = state.vars[varMatch[1]];
      if(typeof v !== "string") throw new Error(`La variable ${varMatch[1]} no existe o no es string.`);
      out += v;
      continue;
    }
    throw new Error(`Token no permitido en expresión: ${part}`);
  }
  return out;
}

function validateCommandAllowed(level, cmd){
  const allow = new Set(level.allowed || []);
  if(cmd.type === "move"){
    return allow.has("hero."+cmd.dir);
  }
  if(cmd.type === "scan") return allow.has("hero.scan");
  if(cmd.type === "deliver") return allow.has("hero.deliver");
  if(cmd.type === "set") return allow.has("set");
  if(cmd.type === "noop") return true;
  if(cmd.type === "error") return true;
  return false;
}

function buildQueue(level){
  const lines = els.code.value.split("\n");
  const q = [];
  for(let i=0; i<lines.length; i++){
    const cmd = parseLine(lines[i]);
    cmd._line = i+1;
    if(cmd.type==="noop") continue;

    if(!validateCommandAllowed(level, cmd)){
      return [{ type:"error", _line:i+1, message:`Comando no permitido en este nivel: ${lines[i].trim()}` }];
    }
    q.push(cmd);
  }
  return q;
}

function evaluateGoals(level){
  const goals = level.goals || [];
  let win = true;
  const progress = [];

  for(const g of goals){
    if(g.type === "deliver"){
      const okDelivered = !!state.flags.delivered?.[g.to];
      const val = state.vars[g.var];
      const okContains = Array.isArray(g.contains) ? g.contains.every(t => (typeof val==="string") && val.includes(t)) : true;
      const ok = okDelivered && okContains;
      progress.push({ label:`Entregar ${g.var} en ${g.to}`, ok });
      if(!ok) win = false;
    } else if(g.type === "reached"){
      const ok = state.hero.x===g.x && state.hero.y===g.y;
      progress.push({ label:`Llegar a (${g.x},${g.y})`, ok });
      if(!ok) win = false;
    } else {
      // Unknown goal: treat as not win
      progress.push({ label:`Goal desconocido: ${g.type}`, ok:false });
      win = false;
    }
  }

  return { win, progress };
}

async function execCmd(level, cmd){
  if(cmd.type==="error"){
    appendLog(`❌ Línea ${cmd._line}: ${cmd.message}`);
    queue = [];
    return false;
  }

  try{
    if(cmd.type==="move"){
      if(cmd.dir==="moveRight") state.hero.x++;
      if(cmd.dir==="moveLeft") state.hero.x--;
      if(cmd.dir==="moveUp") state.hero.y--;
      if(cmd.dir==="moveDown") state.hero.y++;
      inBounds();
      appendLog(`✅ Línea ${cmd._line}: hero.${cmd.dir}()`);
      return true;
    }

    if(cmd.type==="scan"){
      const poi = getPoiById(level, cmd.poi);
      if(!poi) throw new Error(`POI desconocido: ${cmd.poi}`);
      if(!atPoi(level, cmd.poi)) throw new Error(`No estás en ${cmd.poi}.`);
      if(poi.type !== "data") throw new Error(`${cmd.poi} no tiene data para escanear.`);
      state.vars[cmd.varName] = String(poi.data ?? "");
      state.flags.scanned[cmd.poi] = true;
      appendLog(`✅ Línea ${cmd._line}: scan ${cmd.poi} -> ${cmd.varName}`);
      return true;
    }

    if(cmd.type==="set"){
      const val = evalExpr(cmd.expr);
      state.vars[cmd.varName] = val;
      appendLog(`✅ Línea ${cmd._line}: set ${cmd.varName} = "${val}"`);
      return true;
    }

    if(cmd.type==="deliver"){
      const poi = getPoiById(level, cmd.poi);
      if(!poi) throw new Error(`POI desconocido: ${cmd.poi}`);
      if(!atPoi(level, cmd.poi)) throw new Error(`No estás en ${cmd.poi}.`);
      if(poi.type !== "deliver") throw new Error(`${cmd.poi} no acepta entregas.`);
      const val = state.vars[cmd.varName];
      if(typeof val !== "string") throw new Error(`La variable ${cmd.varName} no existe o no es string.`);
      state.flags.delivered[cmd.poi] = true;
      appendLog(`✅ Línea ${cmd._line}: deliver ${cmd.varName} -> ${cmd.poi}`);
      return true;
    }

    appendLog(`🟡 Línea ${cmd._line}: noop`);
    return true;
  } catch(e){
    appendLog(`❌ Línea ${cmd._line}: ${e.message}`);
    queue = [];
    return false;
  }
}

function updateGoalUI(level){
  const { win, progress } = evaluateGoals(level);
  const okCount = progress.filter(p=>p.ok).length;
  els.goalPill.textContent = `Meta: ${okCount}/${progress.length}`;
  if(win){
    els.sub.textContent = "✅ ¡Nivel completado!";
  } else {
    els.sub.textContent = "Aventura de código (MVP)";
  }
}

function resetLevel(level){
  initState(level);
  queue = [];
  running = false;
  setLog("");
  els.code.value = defaultCodeForLevel(level);
  render(level);
  updateGoalUI(level);
}

async function runAll(){
  if(running) return;
  running = true;
  appendLog("▶️ Ejecutando...");
  queue = buildQueue(currentLevel);

  for(const cmd of queue){
    const ok = await execCmd(currentLevel, cmd);
    render(currentLevel);
    updateGoalUI(currentLevel);

    const { win } = evaluateGoals(currentLevel);
    if(win){
      appendLog("🎉 " + (currentLevel.story?.success || "¡Completado!"));
      running = false;
      return;
    }
    if(!ok){
      running = false;
      return;
    }
    await sleep(220);
  }

  const { win } = evaluateGoals(currentLevel);
  if(!win){
    appendLog("🧩 " + (currentLevel.story?.fail || "Aún no se completa la meta."));
  }
  running = false;
}

async function stepOnce(){
  if(running) return;
  if(queue.length===0) queue = buildQueue(currentLevel);
  const cmd = queue.shift();
  if(!cmd){
    appendLog("🟡 No hay más comandos. (Run para reiniciar ejecución)");
    return;
  }
  await execCmd(currentLevel, cmd);
  render(currentLevel);
  updateGoalUI(currentLevel);

  const { win } = evaluateGoals(currentLevel);
  if(win){
    appendLog("🎉 " + (currentLevel.story?.success || "¡Completado!"));
    queue = [];
  }
}

async function refreshLevelSelector(){
  const officialIndex = await fetchOfficialIndex();
  unifiedIndex = buildUnifiedIndex(officialIndex);

  els.sel.innerHTML = "";
  for(const meta of unifiedIndex){
    const opt = document.createElement("option");
    opt.value = meta.id;
    const tag = meta.source === "local" ? " (local)" : "";
    opt.textContent = `${meta.title}${tag}`;
    els.sel.appendChild(opt);
  }

  const last = localStorage.getItem(LS_LAST_LEVEL);
  const pick = unifiedIndex.find(x=>x.id===last) ? last : (unifiedIndex[0]?.id || "");
  if(pick) els.sel.value = pick;

  await onSelectLevel();
}

async function onSelectLevel(){
  const id = els.sel.value;
  localStorage.setItem(LS_LAST_LEVEL, id);
  const meta = unifiedIndex.find(x=>x.id===id);
  if(!meta) return;

  currentLevel = await loadLevelByMeta(meta);
  validateLevel(currentLevel);

  els.title.textContent = currentLevel.title;
  els.lesson.textContent = currentLevel.lesson || "";
  els.story.textContent = currentLevel.story?.intro || "";
  els.hint.textContent = (currentLevel.hints || []).map(h=>"• "+h).join("\n");

  // Delete button only enabled if local
  const isLocal = meta.source === "local";
  els.deleteBtn.disabled = !isLocal;
  els.deleteBtn.style.opacity = isLocal ? "1" : ".5";

  resetLevel(currentLevel);
}

function wireUI(){
  els.sel.addEventListener("change", ()=>onSelectLevel().catch(e=>setLog("❌ "+e.message)));
  els.resetBtn.addEventListener("click", ()=>resetLevel(currentLevel));
  els.runBtn.addEventListener("click", ()=>runAll().catch(e=>appendLog("❌ "+e.message)));
  els.stepBtn.addEventListener("click", ()=>stepOnce().catch(e=>appendLog("❌ "+e.message)));

  els.importBtn.addEventListener("click", ()=>els.importFile.click());
  els.importFile.addEventListener("change", async ()=>{
    const file = els.importFile.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const level = JSON.parse(text);
      validateLevel(level);
      upsertCustomLevel(level);
      await refreshLevelSelector();
      els.sel.value = level.id;
      await onSelectLevel();
      appendLog(`✅ Importado: ${level.title}`);
    } catch(e){
      appendLog(`❌ Import failed: ${e.message}`);
    } finally {
      els.importFile.value = "";
    }
  });

  els.deleteBtn.addEventListener("click", async ()=>{
    const id = els.sel.value;
    const meta = unifiedIndex.find(x=>x.id===id);
    if(!meta || meta.source !== "local") return;
    if(!confirm("¿Borrar este nivel importado?")) return;
    deleteCustomLevel(id);
    await refreshLevelSelector();
    appendLog("🗑️ Nivel borrado.");
  });
}

(async function boot(){
  try{
    wireUI();
    await refreshLevelSelector();
  } catch(e){
    setLog("❌ "+e.message);
  }
})();

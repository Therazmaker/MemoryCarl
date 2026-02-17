import { createInitialState, hydrateProgress, serializeProgress } from "./engine/state.js";
import { createRuntime } from "./engine/runtime.js";
import { evaluateGoals } from "./engine/goals.js";

const LS_KEY = "memorycarl_learnquest_progress_v1";

function esc(s){
  return String(s??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function fetchJson(path){
  const res = await fetch(path, { cache:"no-store" });
  if(!res.ok) throw new Error(`No pude cargar ${path} (${res.status})`);
  return res.json();
}

function loadProgress(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch{ return null; }
}
function saveProgress(payload){
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

function nowIso(){ return new Date().toISOString(); }

function view(root, vm){
  root.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="h1">LearnQuest 🧭 <span class="chip">MVP</span></div>
            <div class="small">Motor + niveles JSON. Guardado local automático. Sin <span class="mono">eval</span>.</div>
          </div>
          <div class="row">
            <select class="select" id="levelSelect" aria-label="Seleccionar nivel">
              ${vm.levelIndex.levels.map(l=>`<option value="${esc(l.id)}" ${l.id===vm.levelId?"selected":""}>${esc(l.chapter||"")} · ${esc(l.title||l.id)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="hr"></div>
        <div class="small"><b>${esc(vm.level.title||"")}</b> <span class="k">(${esc(vm.level.chapter||"")})</span></div>
        <div class="small" style="margin-top:6px; white-space:pre-wrap;">${esc(vm.level.lesson||"")}</div>
      </div>

      <div class="grid">
        <div class="card boardWrap">
          <div id="board" aria-label="tablero"></div>
          <div class="hud">
            <div class="pill">Pos: <span id="pos"></span></div>
            <div class="pill">msg: <span id="msgVar"></span></div>
            <div class="pill">Estado: <span id="status"></span></div>
          </div>
          <div class="small" style="margin-top:8px;">
            Objetivos:
            <div id="goals" style="margin-top:6px;"></div>
          </div>
        </div>

        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <div>
              <div class="h1">Consola</div>
              <div class="small">Comandos permitidos en este nivel: <span class="mono">${esc(vm.level.allowed.join(", "))}</span></div>
            </div>
            <div class="row">
              <button class="btn primary" id="run">Run</button>
              <button class="btn" id="step">Step</button>
              <button class="btn ghost" id="reset">Reset</button>
            </div>
          </div>

          <div class="hr"></div>
          <textarea id="code" spellcheck="false"></textarea>
          <div class="log" id="log"></div>
        </div>
      </div>

      <div class="card">
        <div class="small">Guardado: <span class="mono">${esc(vm.savedAt || "(no guardado aún)")}</span> · Nivel: <span class="mono">${esc(vm.levelId)}</span></div>
      </div>
    </div>
  `;
}

function renderBoard(level, state){
  const el = document.getElementById("board");
  if(!el) return;

  const w = Number(level.board?.w||8);
  const h = Number(level.board?.h||8);
  el.style.setProperty("--w", w);
  el.style.setProperty("--h", h);

  el.innerHTML = "";
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const d = document.createElement("div");
      d.className = "cell" + (((x+y)%2)?" dark":"");

      // POIs
      for(const p of state.pois.values()){
        if(p.x===x && p.y===y){
          d.classList.add("poi");
          const sp = document.createElement("span");
          sp.textContent = p.icon;
          d.appendChild(sp);
        }
      }

      if(state.hero.x===x && state.hero.y===y){
        d.classList.add("hero");
        if(!d.textContent) d.textContent = state.hero.icon || "🧑‍🚀";
      }

      el.appendChild(d);
    }
  }

  const pos = document.getElementById("pos");
  const msgVar = document.getElementById("msgVar");
  const status = document.getElementById("status");
  if(pos) pos.textContent = `(${state.hero.x}, ${state.hero.y})`;
  if(msgVar) msgVar.textContent = typeof state.vars.msg === "string" ? JSON.stringify(state.vars.msg) : "(vacío)";
  if(status) status.textContent = state.status;

  const goalsEl = document.getElementById("goals");
  if(goalsEl){
    const g = evaluateGoals(level, state);
    goalsEl.innerHTML = g.progress.map(it=>`
      <div class="small"><span class="mono">${it.ok?"✅":"⬜"}</span> ${esc(it.label)}</div>
    `).join("") || `<div class="small">(sin objetivos)</div>`;
  }
}

function setLog(html){
  const el = document.getElementById("log");
  if(el) el.innerHTML = html;
}
function addLog(line, cls="hint"){
  const el = document.getElementById("log");
  if(!el) return;
  const safe = esc(line);
  el.innerHTML = (el.innerHTML ? (el.innerHTML + "\n") : "") + `<span class="${cls}">${safe}</span>`;
}

async function boot(){
  const root = document.getElementById("lqRoot");
  if(!root) return;

  const levelIndex = await fetchJson("./levels/index.json");

  let progress = loadProgress();
  let levelId = progress?.levelId || levelIndex.levels?.[0]?.id;

  async function loadLevelById(id){
    const meta = levelIndex.levels.find(x=>x.id===id) || levelIndex.levels[0];
    const lvl = await fetchJson(meta.file);

    // Rehydrate state + code
    progress = loadProgress();
    const hasSame = progress && progress.levelId === lvl.id;

    let state = hasSame ? hydrateProgress(lvl, progress) : createInitialState(lvl);
    let code = hasSame ? (progress.code || lvl.starterCode || "") : (lvl.starterCode || "");

    const vm = {
      levelIndex,
      level: lvl,
      levelId: lvl.id,
      savedAt: progress?.savedAt || "",
      state,
      code
    };

    // Render UI
    view(root, vm);

    // Fill textarea
    const codeEl = document.getElementById("code");
    if(codeEl) codeEl.value = code;

    // Runtime
    const rt = createRuntime({
      level: lvl,
      state,
      onUpdate: ()=>{
        renderBoard(lvl, state);
        // save snapshot (lightweight)
        const currentCode = document.getElementById("code")?.value || "";
        saveProgress(serializeProgress({ levelId: lvl.id, state, code: currentCode }));
      },
      onLog: (m)=> addLog(m, "ok"),
      onError: (e)=> addLog(e, "err"),
      onWin: ()=>{
        addLog("🎉 ¡Nivel completado!", "ok");
        // notify parent (optional)
        try{ window.parent?.postMessage({ type:"LQ_WIN", levelId: lvl.id, at: nowIso() }, "*"); }catch(e){}
      }
    });

    // Initial draw
    setLog(`<span class="hint">Listo. Usa Run o Step. (Se guarda automático)</span>`);
    renderBoard(lvl, state);

    // Wire
    document.getElementById("run")?.addEventListener("click", ()=>{
      setLog("");
      const ok = rt.loadProgram(document.getElementById("code")?.value || "");
      if(ok) rt.run({ delayMs: 220 });
    });
    document.getElementById("step")?.addEventListener("click", async ()=>{
      if(rt.getQueueLen() === 0){
        setLog("");
        const ok = rt.loadProgram(document.getElementById("code")?.value || "");
        if(!ok) return;
      }
      await rt.step();
    });
    document.getElementById("reset")?.addEventListener("click", ()=>{
      setLog(`<span class="hint">Reset. (pos/vars vuelven al inicio)</span>`);
      // Reset to base state for this level, keep current code
      const fresh = createInitialState(lvl);
      rt.reset(fresh);
      renderBoard(lvl, fresh);
      saveProgress(serializeProgress({ levelId: lvl.id, state: fresh, code: document.getElementById("code")?.value || "" }));
    });

    // Save as user types (debounced-ish)
    let t = null;
    document.getElementById("code")?.addEventListener("input", ()=>{
      clearTimeout(t);
      t = setTimeout(()=>{
        saveProgress(serializeProgress({ levelId: lvl.id, state, code: document.getElementById("code")?.value || "" }));
      }, 220);
    });

    // Level select
    document.getElementById("levelSelect")?.addEventListener("change", async (e)=>{
      const next = e.target.value;
      // Save current
      saveProgress(serializeProgress({ levelId: lvl.id, state, code: document.getElementById("code")?.value || "" }));
      await loadLevelById(next);
    });
  }

  await loadLevelById(levelId);
}

boot().catch(err=>{
  const root = document.getElementById("lqRoot");
  if(root) root.innerHTML = `<div class="wrap"><div class="card"><div class="h1">LearnQuest</div><div class="hr"></div><div class="small">Error: ${esc(err?.message||String(err))}</div></div></div>`;
  console.error(err);
});

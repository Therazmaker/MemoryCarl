const LS_PROGRESS = "memorycarl_learn_progress_v1";
const LS_KNOW = "memorycarl_learn_knowledge_v1"; // overrides de userSummary

async function loadSeed(){
  const res = await fetch("./seed.json", { cache: "no-store" });
  return res.json();
}

function loadProgress(){
  try { return JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}"); }
  catch { return {}; }
}
function saveProgress(p){ localStorage.setItem(LS_PROGRESS, JSON.stringify(p)); }

function loadKnow(){
  try { return JSON.parse(localStorage.getItem(LS_KNOW) || "{}"); }
  catch { return {}; }
}
function saveKnow(k){ localStorage.setItem(LS_KNOW, JSON.stringify(k)); }

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function makeQuestion(items){
  // MVP: “¿Dónde vive X?” basado en definedIn
  const target = pick(items);
  const correct = target.definedIn;

  const files = [...new Set(items.map(x=>x.definedIn))];
  let opts = new Set([correct]);
  while(opts.size < Math.min(4, files.length)){
    opts.add(pick(files));
  }
  const options = [...opts].sort(()=>Math.random()-0.5);

  return {
    type: "where",
    targetId: target.id,
    prompt: `¿En qué archivo vive <b>${esc(target.name)}</b>?`,
    correct,
    options
  };
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

let SEED = null;
let ITEMS = [];
let KNOW = {};
let PROG = {};
let currentQ = null;
let selectedId = null;

function render(){
  const root = document.querySelector("#learnApp");
  const total = ITEMS.length;

  const correctCount = Object.values(PROG).filter(x=>x?.lastCorrect).length;
  const reviewedCount = Object.values(KNOW).filter(x=> (x.userSummary||"").trim().length>0).length;

  const selected = ITEMS.find(x=>x.id===selectedId) || null;
  const userSummary = selected ? (KNOW[selected.id]?.userSummary || "") : "";

  root.innerHTML = `
    <div class="wrap">
      <div class="row" style="justify-content:space-between;">
        <div>
          <div class="h1">Aprender (Quiz)</div>
          <div class="small">Tu objetivo: entender tu propio código y escribir explicaciones cortas.</div>
        </div>
        <div class="row">
          <span class="badge">${total} items</span>
          <span class="badge">${reviewedCount} con nota</span>
          <span class="badge">${correctCount} acertadas</span>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="kTitle">Quiz</div>
            <div class="small">Modo MVP: ubicación de funciones/conceptos.</div>
          </div>
          <button class="btn primary" id="btnNewQ">Nueva pregunta</button>
        </div>

        <div class="hr"></div>

        ${currentQ ? `
          <div class="k">
            <div class="kTitle">${currentQ.prompt}</div>
            <div class="hr"></div>
            <div class="grid">
              ${currentQ.options.map(o=>`
                <button class="btn" data-opt="${esc(o)}">${esc(o)}</button>
              `).join("")}
            </div>
            <div class="hr"></div>
            <div class="small" id="qResult"></div>
          </div>
        ` : `
          <div class="small">Presiona “Nueva pregunta”.</div>
        `}
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="kTitle">Library</div>
            <div class="small">Haz click en un item para escribir tu explicación en 1 línea.</div>
          </div>
          <button class="btn" id="btnExport">Export progreso</button>
        </div>
        <div class="hr"></div>

        <div class="grid">
          ${ITEMS.map(it=>{
            const note = (KNOW[it.id]?.userSummary || "").trim();
            const badge = note ? "✅" : "📝";
            return `
              <button class="btn" data-sel="${esc(it.id)}" style="text-align:left;">
                <div class="kTitle">${badge} ${esc(it.name)}</div>
                <div class="small">${esc(it.definedIn)} · ${esc((it.autoSummary||"").slice(0,90))}${(it.autoSummary||"").length>90?"…":""}</div>
              </button>
            `;
          }).join("")}
        </div>
      </div>

      ${selected ? `
        <div class="card">
          <div class="kTitle">Ficha: ${esc(selected.name)}</div>
          <div class="small">${esc(selected.definedIn)}</div>
          <div class="hr"></div>

          <div class="small"><b>Auto</b>: ${esc(selected.autoSummary || "")}</div>
          <div class="hr"></div>

          <div class="small"><b>Tu nota (1 línea)</b></div>
          <textarea id="note" rows="3" placeholder="Ej: Renderiza la UI dependiendo del tab y vuelve a conectar eventos.">${esc(userSummary)}</textarea>

          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="btnSaveNote">Guardar nota</button>
            <button class="btn" id="btnClearNote">Borrar</button>
          </div>

          <div class="small" style="margin-top:10px;">
            Tip: mientras juegas el quiz, completa notas. Eso es lo que te hace aprender más rápido.
          </div>
        </div>
      ` : ""}
    </div>
  `;

  // Wire quiz
  const btnNewQ = root.querySelector("#btnNewQ");
  if(btnNewQ) btnNewQ.addEventListener("click", ()=>{
    currentQ = makeQuestion(ITEMS);
    render();
  });

  root.querySelectorAll("[data-opt]").forEach(b=>{
    b.addEventListener("click", ()=>{
      if(!currentQ) return;
      const picked = b.dataset.opt;
      const ok = (picked === currentQ.correct);

      PROG[currentQ.targetId] = {
        lastCorrect: ok,
        lastAt: new Date().toISOString()
      };
      saveProgress(PROG);

      const out = root.querySelector("#qResult");
      if(out){
        out.innerHTML = ok
          ? `✅ Correcto. Vive en <b>${esc(currentQ.correct)}</b>.`
          : `❌ Era <b>${esc(currentQ.correct)}</b>. Tú elegiste <b>${esc(picked)}</b>.`;
      }
    });
  });

  // Wire selection
  root.querySelectorAll("[data-sel]").forEach(b=>{
    b.addEventListener("click", ()=>{
      selectedId = b.dataset.sel;
      render();
    });
  });

  // Note actions
  const btnSave = root.querySelector("#btnSaveNote");
  if(btnSave) btnSave.addEventListener("click", ()=>{
    if(!selected) return;
    const note = root.querySelector("#note")?.value || "";
    KNOW[selected.id] = { ...(KNOW[selected.id]||{}), userSummary: note };
    saveKnow(KNOW);
    render();
  });

  const btnClear = root.querySelector("#btnClearNote");
  if(btnClear) btnClear.addEventListener("click", ()=>{
    if(!selected) return;
    KNOW[selected.id] = { ...(KNOW[selected.id]||{}), userSummary: "" };
    saveKnow(KNOW);
    render();
  });

  // Export
  const btnExport = root.querySelector("#btnExport");
  if(btnExport) btnExport.addEventListener("click", ()=>{
    const payload = {
      exportedAt: new Date().toISOString(),
      progress: PROG,
      knowledge: KNOW
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memorycarl_learn_export_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

async function init(){
  SEED = await loadSeed();
  ITEMS = Array.isArray(SEED?.items) ? SEED.items : [];
  KNOW = loadKnow();
  PROG = loadProgress();
  currentQ = makeQuestion(ITEMS);
  render();
}

init();

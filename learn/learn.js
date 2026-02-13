const LS_PROGRESS = "memorycarl_learn_progress_v1";
const LS_KNOW = "memorycarl_learn_knowledge_v1"; // overrides de userSummary

/**
 * learn/ is served at /learn/, so the repo root is ../
 * definedIn example: "src/main.js" -> fetch("../src/main.js")
 */
async function fetchFileText(path){
  const url = (`../${path}`).replaceAll("//","/");
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Can't fetch ${url} (${res.status})`);
  return res.text();
}

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

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function getFnNameToken(displayName){
  // "persist()" -> "persist", "load()/save()" -> "load" (fallback)
  const m = /([A-Za-z_$][\w$]*)\s*\(/.exec(displayName || "");
  if(m) return m[1];
  const m2 = /([A-Za-z_$][\w$]*)/.exec(displayName || "");
  return m2 ? m2[1] : "";
}

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

/** Find the line number (1-based) where the definition starts (best-effort). */
function findDefinitionLine(lines, token){
  const rxList = [
    new RegExp(`\\bfunction\\s+${token}\\s*\\(`),
    new RegExp(`\\bconst\\s+${token}\\s*=\\s*`),
    new RegExp(`\\blet\\s+${token}\\s*=\\s*`),
    new RegExp(`\\bvar\\s+${token}\\s*=\\s*`),
  ];
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(rxList.some(rx=>rx.test(line))) return i+1;
  }
  return null;
}

/** Extract a code block starting from defLine, balancing braces (best-effort). */
function extractBlock(lines, defLine){
  if(!defLine) return { snippet:"", startLine:null, endLine:null };

  const startIdx = defLine - 1;

  // Find first "{" from defLine onward (within 30 lines)
  let braceLine = null;
  let bracePos = -1;
  for(let i=startIdx; i<Math.min(lines.length, startIdx+30); i++){
    const p = lines[i].indexOf("{");
    if(p >= 0){ braceLine = i; bracePos = p; break; }
  }

  // If no brace found, just return 25 lines from defLine
  if(braceLine === null){
    const slice = lines.slice(startIdx, Math.min(lines.length, startIdx+25));
    return { snippet: slice.join("\n"), startLine: defLine, endLine: defLine + slice.length - 1 };
  }

  let depth = 0;
  let endLine = braceLine + 1;
  let started = false;

  for(let i=braceLine; i<lines.length; i++){
    const line = lines[i];
    for(let c=0;c<line.length;c++){
      const ch = line[c];
      if(ch === "{"){ depth++; started = true; }
      else if(ch === "}"){ depth--; }
      if(started && depth === 0){
        endLine = i+1;
        const slice = lines.slice(startIdx, endLine);
        return { snippet: slice.join("\n"), startLine: defLine, endLine };
      }
    }
  }

  // fallback
  const slice = lines.slice(startIdx, Math.min(lines.length, startIdx+60));
  return { snippet: slice.join("\n"), startLine: defLine, endLine: defLine + slice.length - 1 };
}

/** Find call sites for token(...) excluding the definition line range. */
function findCallSites(lines, token, defStart, defEnd){
  const rx = new RegExp(`\\b${token}\\s*\\(`);
  const hits = [];
  for(let i=0;i<lines.length;i++){
    const lineNo = i+1;
    const line = lines[i];
    if(!rx.test(line)) continue;

    // Skip within definition block (if known)
    if(defStart && defEnd && lineNo >= defStart && lineNo <= defEnd) continue;

    // Skip obvious definition lines
    if(/\bfunction\b/.test(line) && line.includes(token)) continue;

    hits.push({
      line: lineNo,
      text: line.trim().slice(0, 180)
    });
  }
  return hits;
}

/** Try to infer which function "owns" a line by scanning backwards. */
function inferOwnerFunction(lines, lineNo){
  const start = Math.max(0, lineNo-1);
  for(let i=start; i>=0 && i>start-80; i--){
    const line = lines[i];
    let m = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if(m) return m[1] + "()";
    m = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\(/.exec(line);
    if(m) return m[1] + "()";
    m = /\blet\s+([A-Za-z_$][\w$]*)\s*=\s*\(/.exec(line);
    if(m) return m[1] + "()";
  }
  return "";
}

let SEED = null;
let ITEMS = [];
let KNOW = {};
let PROG = {};
let currentQ = null;
let selectedId = null;

// Loaded code view state
let CODE = {
  loading: false,
  error: "",
  file: "",
  defLine: null,
  startLine: null,
  endLine: null,
  snippet: "",
  calls: []
};

async function loadCodeForItem(item){
  if(!item?.definedIn) return;
  CODE = { loading:true, error:"", file:item.definedIn, defLine:null, startLine:null, endLine:null, snippet:"", calls:[] };
  render();

  try{
    const text = await fetchFileText(item.definedIn);
    const lines = text.split("\n");

    const token = getFnNameToken(item.name);
    const defLine = token ? findDefinitionLine(lines, token) : null;

    let block = { snippet:"", startLine:null, endLine:null };
    if(defLine) block = extractBlock(lines, defLine);

    const calls = token ? findCallSites(lines, token, block.startLine, block.endLine) : [];
    const callsEnriched = calls.slice(0, 30).map(h=>({
      ...h,
      owner: inferOwnerFunction(lines, h.line)
    }));

    CODE = {
      loading:false,
      error:"",
      file:item.definedIn,
      defLine,
      startLine:block.startLine,
      endLine:block.endLine,
      snippet:block.snippet,
      calls:callsEnriched
    };
    render();
  }catch(e){
    CODE = { loading:false, error:String(e?.message || e), file:item.definedIn, defLine:null, startLine:null, endLine:null, snippet:"", calls:[] };
    render();
  }
}

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
          <div class="small">Objetivo: ubicar cosas rápido, y escribir tus propias explicaciones.</div>
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
            <div class="small">MVP: ubicación de funciones/conceptos.</div>
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
            <div class="small">Click para abrir ficha (código + dónde se usa).</div>
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
          <div class="row" style="justify-content:space-between; align-items:flex-start;">
            <div>
              <div class="kTitle">Ficha: ${esc(selected.name)}</div>
              <div class="small">${esc(selected.definedIn)}${CODE.startLine?` · líneas ${CODE.startLine}-${CODE.endLine}`:""}</div>
            </div>
            <button class="btn" id="btnReload">Recargar código</button>
          </div>

          <div class="hr"></div>

          <div class="small"><b>Auto</b>: ${esc(selected.autoSummary || "")}</div>

          <div class="hr"></div>

          <div class="kTitle">Código</div>
          ${CODE.loading ? `<div class="small">Cargando código…</div>` : ""}
          ${(!CODE.loading && CODE.error) ? `<div class="small">❌ ${esc(CODE.error)}</div>` : ""}
          ${(!CODE.loading && !CODE.error && CODE.snippet) ? `
            <pre class="code"><code>${esc(CODE.snippet)}</code></pre>
          ` : (!CODE.loading && !CODE.error ? `<div class="small">No pude extraer un bloque automáticamente. (Aun así puedes usar la nota.)</div>` : "")}

          <div class="hr"></div>

          <div class="kTitle">Dónde se usa</div>
          ${CODE.loading ? `<div class="small">Buscando usos…</div>` : ""}
          ${(!CODE.loading && CODE.calls.length===0) ? `<div class="small">No encontré usos directos (o son pocos y no aparecen en el archivo).</div>` : ""}
          ${(!CODE.loading && CODE.calls.length>0) ? `
            <div class="grid">
              ${CODE.calls.map(c=>`
                <div class="k">
                  <div class="small"><b>${esc(c.owner || "—")}</b> · línea ${c.line}</div>
                  <div class="small" style="margin-top:6px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                    ${esc(c.text)}
                  </div>
                </div>
              `).join("")}
            </div>
          ` : ""}

          <div class="hr"></div>

          <div class="small"><b>Tu nota (1 línea)</b></div>
          <textarea id="note" rows="3" placeholder="Ej: Guarda el state en localStorage después de cualquier cambio.">${esc(userSummary)}</textarea>

          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="btnSaveNote">Guardar nota</button>
            <button class="btn" id="btnClearNote">Borrar</button>
          </div>

          <div class="small" style="margin-top:10px;">
            Tip: si ves un uso, pregúntate: “¿qué evento lo dispara?” y lo escribes en tu nota.
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

  // Selection
  root.querySelectorAll("[data-sel]").forEach(b=>{
    b.addEventListener("click", ()=>{
      selectedId = b.dataset.sel;
      const it = ITEMS.find(x=>x.id===selectedId);
      if(it) loadCodeForItem(it);
      else render();
    });
  });

  // Reload code
  const btnReload = root.querySelector("#btnReload");
  if(btnReload) btnReload.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(it) loadCodeForItem(it);
  });

  // Notes
  const btnSave = root.querySelector("#btnSaveNote");
  if(btnSave) btnSave.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(!it) return;
    const note = root.querySelector("#note")?.value || "";
    KNOW[it.id] = { ...(KNOW[it.id]||{}), userSummary: note };
    saveKnow(KNOW);
    render();
  });

  const btnClear = root.querySelector("#btnClearNote");
  if(btnClear) btnClear.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(!it) return;
    KNOW[it.id] = { ...(KNOW[it.id]||{}), userSummary: "" };
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
  currentQ = ITEMS.length ? makeQuestion(ITEMS) : null;
  render();
}

init();

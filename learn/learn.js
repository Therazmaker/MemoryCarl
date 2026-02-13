const LS_PROGRESS = "memorycarl_learn_progress_v1";
const LS_KNOW = "memorycarl_learn_knowledge_v1"; // per-item notes
const LS_GLOSS = "memorycarl_learn_glossary_v1"; // per-term notes/overrides

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
function loadJson(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function getFnNameToken(displayName){
  const m = /([A-Za-z_$][\w$]*)\s*\(/.exec(displayName || "");
  if(m) return m[1];
  const m2 = /([A-Za-z_$][\w$]*)/.exec(displayName || "");
  return m2 ? m2[1] : "";
}
function makeQuestion(items){
  const target = pick(items);
  const correct = target.definedIn;

  const BASE_FILES = [
    "src/main.js","src/utils.js","src/storage.js","src/ui.js","src/notifications.js","src/helpers.js",
    "background.js","content.js","popup.js"
  ];
  const files = [...new Set([...items.map(x=>x.definedIn), ...BASE_FILES])].filter(Boolean);

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

// ----------------------- Code extraction helpers -----------------------
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
function extractBlock(lines, defLine){
  if(!defLine) return { snippet:"", startLine:null, endLine:null };
  const startIdx = defLine - 1;

  let braceLine = null;
  for(let i=startIdx; i<Math.min(lines.length, startIdx+30); i++){
    if(lines[i].includes("{")){ braceLine = i; break; }
  }
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
  const slice = lines.slice(startIdx, Math.min(lines.length, startIdx+60));
  return { snippet: slice.join("\n"), startLine: defLine, endLine: defLine + slice.length - 1 };
}
function findCallSites(lines, token, defStart, defEnd){
  const rx = new RegExp(`\\b${token}\\s*\\(`);
  const hits = [];
  for(let i=0;i<lines.length;i++){
    const lineNo = i+1;
    const line = lines[i];
    if(!rx.test(line)) continue;
    if(defStart && defEnd && lineNo >= defStart && lineNo <= defEnd) continue;
    if(/\bfunction\b/.test(line) && line.includes(token)) continue;
    hits.push({ line: lineNo, text: line.trim().slice(0, 180) });
  }
  return hits;
}
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

// ----------------------- Glossary (clickable keywords) -----------------------
const DEFAULT_GLOSSARY = {
  "function": { title:"function", short:"Declara una función: un bloque reutilizable que se ejecuta cuando lo llamas.", example:"function hello(){ return 'hi'; }", commonMistake:"Pensar que 'function' ejecuta algo. Solo define." },
  "if": { title:"if", short:"Condición: si es true, ejecuta el bloque; si no, lo salta.", example:"if (x > 0) { ... }", commonMistake:"Confundir '=' con '===' en comparaciones." },
  "return": { title:"return", short:"Devuelve un valor y termina la función en ese punto.", example:"return token;", commonMistake:"Poner código después del return esperando que corra." },
  "try": { title:"try", short:"Intenta ejecutar código que puede fallar. Si falla, salta a catch.", example:"try { ... } catch(e) { ... }", commonMistake:"Capturar errores y no hacer nada sin log." },
  "catch": { title:"catch", short:"Captura el error de un try. 'e' es el objeto error.", example:"catch(e){ console.warn(e); }", commonMistake:"Asumir que catch arregla el error; solo lo captura." },
  "const": { title:"const", short:"Variable no reasignable (pero objetos pueden mutar).", example:"const x = 5;", commonMistake:"Creer que const hace el objeto inmutable." },
  "let": { title:"let", short:"Variable reasignable (scope de bloque).", example:"let count = 0; count++;", commonMistake:"Usar var y crear scopes raros." },
  "async": { title:"async", short:"Función que retorna Promise y permite await.", example:"async function f(){ await g(); }", commonMistake:"Olvidar await y pensar que ya esperó." },
  "await": { title:"await", short:"Espera una Promise dentro de async.", example:"const res = await fetch(url);", commonMistake:"Usarlo fuera de async." },
  "===": { title:"===", short:"Comparación estricta: valor y tipo.", example:"state.tab === 'routines'", commonMistake:"Usar '==' y obtener coerción rara." }
};
const KEYWORDS = ["function","if","return","try","catch","const","let","async","await"];

function renderCodeWithGlossary(snippet){
  if(!snippet) return "";
  let safe = esc(snippet);
  safe = safe.replaceAll("===", `<span class="kw" data-term="===">===</span>`);
  const ordered = [...KEYWORDS].sort((a,b)=>b.length-a.length);
  for(const kw of ordered){
    const rx = new RegExp(`\\b${kw}\\b`, "g");
    safe = safe.replace(rx, `<span class="kw" data-term="${kw}">${kw}</span>`);
  }
  return safe;
}
function loadGlossary(){
  const stored = loadJson(LS_GLOSS, {});
  return { ...DEFAULT_GLOSSARY, ...stored };
}
function saveGlossary(gloss){ saveJson(LS_GLOSS, gloss); }

// ----------------------- App state -----------------------
let SEED=null, ITEMS=[], KNOW={}, PROG={}, GLOSS=loadGlossary();
let currentQ=null, selectedId=null;
let CODE={ loading:false, error:"", file:"", defLine:null, startLine:null, endLine:null, snippet:"", calls:[] };
let GSTATE={ open:false, term:"" };

async function loadCodeForItem(item){
  if(!item?.definedIn) return;
  CODE = { loading:true, error:"", file:item.definedIn, defLine:null, startLine:null, endLine:null, snippet:"", calls:[] };
  render();
  try{
    const text = await fetchFileText(item.definedIn);
    const lines = text.split("\n");
    const token = getFnNameToken(item.name);
    const defLine = token ? findDefinitionLine(lines, token) : null;
    const block = defLine ? extractBlock(lines, defLine) : { snippet:"", startLine:null, endLine:null };
    const calls = token ? findCallSites(lines, token, block.startLine, block.endLine) : [];
    CODE = {
      loading:false, error:"", file:item.definedIn, defLine,
      startLine:block.startLine, endLine:block.endLine,
      snippet:block.snippet,
      calls:calls.slice(0,40).map(h=>({ ...h, owner: inferOwnerFunction(lines, h.line) }))
    };
    render();
  }catch(e){
    CODE = { loading:false, error:String(e?.message||e), file:item.definedIn, defLine:null, startLine:null, endLine:null, snippet:"", calls:[] };
    render();
  }
}

function openGlossary(term){ GSTATE.open=true; GSTATE.term=term; render(); }
function closeGlossary(){ GSTATE.open=false; GSTATE.term=""; render(); }
function ensureTerm(term){
  if(!term) return;
  if(!GLOSS[term]){
    GLOSS[term] = { title:term, short:"", example:"", commonMistake:"", note:"" };
    saveGlossary(GLOSS);
  }
}
function renderGlossaryModal(){
  if(!GSTATE.open) return "";
  const term = GSTATE.term;
  ensureTerm(term);
  const entry = GLOSS[term] || { title:term, short:"", example:"", commonMistake:"", note:"" };
  return `
    <div class="modalBackdrop" id="gBackdrop">
      <div class="gModal">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="kTitle">📘 ${esc(entry.title || term)}</div>
            <div class="small">Glosario editable. Pega tu explicación y se guarda.</div>
          </div>
          <button class="btn" id="gClose">Cerrar</button>
        </div>

        <div class="hr"></div>

        <div class="small"><b>Qué es</b></div>
        <div class="k small" style="margin-top:6px;">${esc(entry.short || "Escribe tu explicación abajo 👇")}</div>

        <div class="hr"></div>

        <div class="small"><b>Ejemplo</b></div>
        <pre class="code"><code>${esc(entry.example || "")}</code></pre>

        <div class="hr"></div>

        <div class="small"><b>Error típico</b></div>
        <div class="k small" style="margin-top:6px;">${esc(entry.commonMistake || "")}</div>

        <div class="hr"></div>

        <div class="small"><b>Tu nota</b></div>
        <textarea id="gNote" rows="4" placeholder="Pega tu explicación aquí…">${esc(entry.note || "")}</textarea>

        <div class="row" style="margin-top:10px;">
          <button class="btn primary" id="gSave">Guardar nota</button>
          <button class="btn" id="gClear">Borrar nota</button>
        </div>
      </div>
    </div>
  `;
}

function render(){
  const root = document.querySelector("#learnApp");
  const total = ITEMS.length;
  const correctCount = Object.values(PROG).filter(x=>x?.lastCorrect).length;
  const reviewedCount = Object.values(KNOW).filter(x=> (x.userSummary||"").trim().length>0).length;

  const selected = ITEMS.find(x=>x.id===selectedId) || null;
  const userSummary = selected ? (KNOW[selected.id]?.userSummary || "") : "";
  const codeHtml = (!CODE.loading && !CODE.error && CODE.snippet) ? renderCodeWithGlossary(CODE.snippet) : "";

  root.innerHTML = `
    <div class="wrap">
      <div class="row" style="justify-content:space-between;">
        <div>
          <div class="h1">Aprender (Quiz + Glosario)</div>
          <div class="small">Click en palabras del código para ver definición y pegar tu nota.</div>
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
            <div class="small">Con distractores realistas.</div>
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
        ` : `<div class="small">Presiona “Nueva pregunta”.</div>`}
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="kTitle">Library</div>
            <div class="small">Click para abrir ficha.</div>
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
            <div class="row">
              <button class="btn" id="btnReload">Recargar código</button>
              <button class="btn" id="btnGloss">Glosario</button>
            </div>
          </div>

          <div class="hr"></div>

          <div class="small"><b>Auto</b>: ${esc(selected.autoSummary || "")}</div>

          <div class="hr"></div>

          <div class="kTitle">Código (clickeable)</div>
          ${CODE.loading ? `<div class="small">Cargando…</div>` : ""}
          ${(!CODE.loading && CODE.error) ? `<div class="small">❌ ${esc(CODE.error)}</div>` : ""}
          ${(!CODE.loading && !CODE.error && CODE.snippet) ? `
            <pre class="code"><code>${codeHtml}</code></pre>
            <div class="small" style="margin-top:8px;">Tip: toca <span class="kw" data-term="function">function</span> o <span class="kw" data-term="if">if</span>.</div>
          ` : ""}

          <div class="hr"></div>

          <div class="kTitle">Dónde se usa</div>
          ${(!CODE.loading && CODE.calls.length===0) ? `<div class="small">No encontré usos directos.</div>` : ""}
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
          <textarea id="note" rows="3" placeholder="Ej: Guarda state en localStorage y luego re-renderiza.">${esc(userSummary)}</textarea>

          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="btnSaveNote">Guardar nota</button>
            <button class="btn" id="btnClearNote">Borrar</button>
          </div>
        </div>
      ` : ""}

      ${renderGlossaryModal()}
    </div>
  `;

  // Quiz
  root.querySelector("#btnNewQ")?.addEventListener("click", ()=>{
    currentQ = ITEMS.length ? makeQuestion(ITEMS) : null;
    render();
  });
  root.querySelectorAll("[data-opt]").forEach(b=>{
    b.addEventListener("click", ()=>{
      if(!currentQ) return;
      const picked = b.dataset.opt;
      const ok = (picked === currentQ.correct);
      PROG[currentQ.targetId] = { lastCorrect: ok, lastAt: new Date().toISOString() };
      saveJson(LS_PROGRESS, PROG);
      const out = root.querySelector("#qResult");
      if(out){
        out.innerHTML = ok ? `✅ Correcto.` : `❌ Era <b>${esc(currentQ.correct)}</b>.`;
      }
    });
  });

  // Selection
  root.querySelectorAll("[data-sel]").forEach(b=>{
    b.addEventListener("click", ()=>{
      selectedId = b.dataset.sel;
      const it = ITEMS.find(x=>x.id===selectedId);
      if(it) loadCodeForItem(it); else render();
    });
  });

  // Reload code
  root.querySelector("#btnReload")?.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(it) loadCodeForItem(it);
  });

  // Open glossary quick
  root.querySelector("#btnGloss")?.addEventListener("click", ()=> openGlossary("function"));

  // Per-item notes
  root.querySelector("#btnSaveNote")?.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(!it) return;
    const note = root.querySelector("#note")?.value || "";
    KNOW[it.id] = { ...(KNOW[it.id]||{}), userSummary: note };
    saveJson(LS_KNOW, KNOW);
    render();
  });
  root.querySelector("#btnClearNote")?.addEventListener("click", ()=>{
    const it = ITEMS.find(x=>x.id===selectedId);
    if(!it) return;
    KNOW[it.id] = { ...(KNOW[it.id]||{}), userSummary: "" };
    saveJson(LS_KNOW, KNOW);
    render();
  });

  // Export
  root.querySelector("#btnExport")?.addEventListener("click", ()=>{
    const payload = { exportedAt:new Date().toISOString(), progress:PROG, knowledge:KNOW, glossary:GLOSS };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memorycarl_learn_export_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  // Clickable keywords anywhere
  root.querySelectorAll("[data-term]").forEach(el=>{
    el.addEventListener("click", ()=>{
      const term = el.dataset.term;
      openGlossary(term);
    });
  });

  // Glossary modal wiring
  const gBackdrop = root.querySelector("#gBackdrop");
  gBackdrop?.addEventListener("click", (e)=>{ if(e.target === gBackdrop) closeGlossary(); });
  root.querySelector("#gClose")?.addEventListener("click", closeGlossary);

  root.querySelector("#gSave")?.addEventListener("click", ()=>{
    const term = GSTATE.term;
    ensureTerm(term);
    const note = root.querySelector("#gNote")?.value || "";
    GLOSS[term] = { ...(GLOSS[term]||{}), note };
    saveGlossary(GLOSS);
    render();
  });
  root.querySelector("#gClear")?.addEventListener("click", ()=>{
    const term = GSTATE.term;
    ensureTerm(term);
    GLOSS[term] = { ...(GLOSS[term]||{}), note:"" };
    saveGlossary(GLOSS);
    render();
  });
}

async function init(){
  SEED = await loadSeed();
  ITEMS = Array.isArray(SEED?.items) ? SEED.items : [];
  KNOW = loadJson(LS_KNOW, {});
  PROG = loadJson(LS_PROGRESS, {});
  GLOSS = loadGlossary();
  currentQ = ITEMS.length ? makeQuestion(ITEMS) : null;
  render();
}
init();

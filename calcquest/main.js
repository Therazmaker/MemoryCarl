/* CalcQuest v1 - Hacker Neon */
const LS = {
  levelId: "mc_calcquest_level",
  codePrefix: "mc_calcquest_code_",
};

const STATS_PREFIX = "mc_calcquest_stats_";

const DEFAULT_MISSION = {
  title: "INCOMING TRANSMISSION",
  body: "Es hora. Carga un HTML para visualizar la misión.",
  tags: ["DOM", "HTML", "UI"],
  deadline: "00:45",
};

async function loadLevels(){
  const res = await fetch("./levels/index.json?v=1", {cache:"no-store"});
  if(!res.ok) throw new Error("No pude cargar levels/index.json");
  return await res.json();
}

function nowTime(){
  const d = new Date();
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function toast(msg){
  console.log("[CalcQuest]", msg);
}

function download(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildSrcdoc({html, css, js, mission, extraHead=""}){
  const safeHtml = html || "";
  const safeCss = css || "";
  const safeJs = js || "";
  const m = mission || DEFAULT_MISSION;

  // We expose MISSION in the iframe BEFORE user script.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#05060c;color:#e9f6ff}
  ${safeCss}
</style>
${extraHead}
</head>
<body>
${safeHtml}
<script>
  window.MISSION = ${JSON.stringify(m)};
  // Small helper the player can use
  window.$ = (sel)=>document.querySelector(sel);
</script>
<script>
  // Console bridge (iframe -> parent)
  (function(){
    const send = (kind, args)=>{
      try{ parent.postMessage({__calcquest:1, kind, args: (args||[]).map(a=>{
        try{ return (typeof a === 'string') ? a : JSON.stringify(a); }catch{ return String(a); }
      })}, '*'); }catch(e){}
    };
    ['log','warn','error'].forEach(k=>{
      const orig = console[k];
      console[k] = function(...a){ send(k, a); return orig.apply(console, a); };
    });
    window.addEventListener('error', (e)=>send('error', [e.message || 'Error']));
  })();
</script>
<script>
${safeJs}
</script>
</body></html>`;
}

function fmtMs(ms){
  if(ms == null) return "—";
  const s = Math.max(0, Math.floor(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function loadStats(levelId){
  try{
    const raw = localStorage.getItem(STATS_PREFIX + levelId);
    if(!raw) return {bestMs:null, attempts:0};
    const s = JSON.parse(raw);
    return {bestMs: (typeof s.bestMs==='number') ? s.bestMs : null, attempts: (s.attempts||0)};
  }catch{ return {bestMs:null, attempts:0}; }
}

function saveStats(levelId, stats){
  localStorage.setItem(STATS_PREFIX + levelId, JSON.stringify(stats||{}));
}

function exists(doc, sel){ return !!doc.querySelector(sel); }
function textOf(doc, sel){ return (doc.querySelector(sel)?.textContent || "").trim(); }
function click(doc, sel){
  const el = doc.querySelector(sel);
  if(!el) throw new Error("No existe para click: " + sel);
  el.dispatchEvent(new MouseEvent("click", {bubbles:true, cancelable:true}));
}
function typeKeys(doc, keys){
  keys.forEach(k=>{
    // prefer button keys if exist
    const btn = doc.querySelector(`[data-key="${CSS.escape(k)}"]`) || doc.querySelector(`[data-op="${CSS.escape(k)}"]`);
    if(btn){
      btn.dispatchEvent(new MouseEvent("click", {bubbles:true, cancelable:true}));
      return;
    }
    // otherwise keyboard
    doc.dispatchEvent(new KeyboardEvent("keydown", {key:k, bubbles:true, cancelable:true}));
  });
}

async function runTests(level, iframe){
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if(!win || !doc) return {ok:false, details:["Preview no listo"]};

  const details = [];
  const pass = (s)=>details.push("✅ " + s);
  const fail = (s)=>details.push("❌ " + s);

  const assert = (cond, msg)=>{
    if(!cond) throw new Error(msg);
  };

  // allow DOM settle
  await new Promise(r=>setTimeout(r, 30));

  try{
    for(const t of (level.tests || [])){
      if(t.kind === "exists"){
        assert(exists(doc, t.sel), `Debe existir ${t.sel}`);
        pass(`Existe ${t.sel}`);
      }else if(t.kind === "text_includes"){
        const got = textOf(doc, t.sel);
        const expected = (t.value === "$MISSION.title") ? (win.MISSION?.title||"") :
                         (t.value === "$MISSION.body") ? (win.MISSION?.body||"") : (t.value||"");
        assert(got.includes(expected), `${t.sel} debe incluir: ${expected}`);
        pass(`${t.sel} incluye texto esperado`);
      }else if(t.kind === "click_seq_display"){
        // expects selectors based on data-key and a display selector
        const displaySel = t.displaySel || "#display";
        // reset by clicking C if present
        if(doc.querySelector('[data-key="C"]')) click(doc, '[data-key="C"]');
        for(const k of t.seq){
          click(doc, `[data-key="${CSS.escape(k)}"]`);
        }
        const got = textOf(doc, displaySel);
        assert(got === t.expect, `Display esperado "${t.expect}", obtuve "${got}"`);
        pass(`Clicks ${t.seq.join("")} -> ${t.expect}`);
      }else if(t.kind === "type_seq_display"){
        const displaySel = t.displaySel || "#display";
        if(doc.querySelector('[data-key="C"]')) click(doc, '[data-key="C"]');
        typeKeys(doc, t.seq);
        const got = textOf(doc, displaySel);
        assert(got === t.expect, `Display esperado "${t.expect}", obtuve "${got}"`);
        pass(`Input ${t.seq.join(" ")} -> ${t.expect}`);
      }else if(t.kind === "eval"){
        // Run arbitrary expression in iframe context (level author only)
        const res = win.eval(t.code);
        if(t.expect !== undefined){
          assert(res === t.expect, `Eval esperaba ${t.expect} y dio ${res}`);
        }
        pass(t.name || "Eval OK");
      }
    }
    return {ok:true, details};
  }catch(e){
    fail(String(e.message || e));
    return {ok:false, details};
  }
}

function defaultCodeFor(level){
  const saved = loadSaved(level.id);
  if(saved) return saved;

  return {
    html: level.starter?.html || "",
    css: level.starter?.css || "",
    js: level.starter?.js || "",
  };
}

function saveCode(levelId, code){
  localStorage.setItem(LS.codePrefix + levelId, JSON.stringify(code));
}
function loadSaved(levelId){
  try{
    const raw = localStorage.getItem(LS.codePrefix + levelId);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}

function setCurrentLevel(levelId){
  localStorage.setItem(LS.levelId, levelId);
}
function getCurrentLevelId(levels){
  const raw = localStorage.getItem(LS.levelId);
  if(raw && levels.some(l=>l.id===raw)) return raw;
  return levels[0]?.id || "";
}

function appShell(){
  return `
  <div class="shell">
    <div class="card left">
      <div class="header">
        <div class="brand">
          <div class="t">CALCQUEST://</div>
          <div class="s">Hacker-neón: reconstruye UI + programa una calculadora real</div>
        </div>
        <div class="pill" id="statusPill">MISSION VIEWER: OFFLINE</div>
      </div>

      <pre class="feed scanline" id="feed" aria-label="Terminal feed"></pre>

      <div class="levelBox">
        <select class="select" id="levelSelect"></select>

        <div class="kpi">
          <div class="k">
            <div class="l">Nivel</div>
            <div class="v" id="levelName">-</div>
          </div>
          <div class="k">
            <div class="l">Estado</div>
            <div class="v" id="levelState">—</div>
          </div>
          <div class="k">
            <div class="l">Tiempo</div>
            <div class="v" id="timerNow">00:00</div>
            <div class="l" style="margin-top:6px">Best</div>
            <div class="v" id="timerBest">—</div>
          </div>
        </div>

        <div class="row">
          <button class="btn good" id="btnRun">▶ RUN TESTS</button>
          <button class="btn" id="btnPreview">↻ RELOAD PREVIEW</button>
          <button class="btn ghost" id="btnReset">⟲ RESET LEVEL</button>
        </div>

        <div class="row" style="justify-content:space-between;gap:10px">
          <div class="small" id="hintLine">Tip: Empieza por HTML. Sin DOM, no hay misión.</div>
          <span class="badge" id="progressBadge">0/0</span>
        </div>

        <div class="row" style="justify-content:space-between;gap:10px">
          <div class="req" id="reqLine">Edita: <b>index.html</b></div>
          <span class="badge ghost" id="whatNow">Tutorial</span>
        </div>

        <div class="row">
          <button class="btn ghost" id="btnHints">💡 Tutorial</button>
          <button class="btn ghost" id="btnSolution">🧩 Solución</button>
          <button class="btn ghost" id="btnNewAttempt">⏱ Nuevo intento</button>
          <button class="btn ghost" id="btnProgram">🧑‍💻 Programar</button>
        </div>

        <div class="row">
          <button class="btn" id="btnExport">⬇ EXPORT (HTML/CSS/JS)</button>
        </div>

        <div class="small tip">
          Tip: si te atoras, abre <b>Tutorial</b>. La solución es para mirar 10s, cerrar, borrar y reescribir.
        </div>
      </div>
    </div>

    <div class="card right">
      <div class="tabs">
        <div class="tab active" data-tab="html">index.html</div>
        <div class="tab" data-tab="css">styles.css</div>
        <div class="tab" data-tab="js">app.js</div>
      </div>

      <div class="split">
        <div class="editor" id="editor">
          <textarea id="code"></textarea>
        </div>

        <div class="preview">
          <!-- allow-same-origin is required so parent can inspect iframe DOM for tests -->
          <iframe id="preview" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"></iframe>
        </div>
      </div>

      <div class="console">
        <div class="consoleHeader">
          <div>CONSOLE</div>
          <button class="btn ghost" id="btnClearConsole">Clear</button>
        </div>
        <pre class="consoleOut" id="consoleOut"></pre>
      </div>

      <div class="footerBar">
        <div class="small" id="footerInfo">Ctrl+S guarda. Preview recarga cuando tú quieras.</div>
        <div class="row">
          <span class="badge" id="resultBadge">—</span>
        </div>
      </div>
    </div>

    <div class="modal hidden" id="helpModal" aria-hidden="true">
      <div class="modalCard">
        <div class="modalHead">
          <div class="modalTitle" id="helpTitle">Tutorial</div>
          <button class="btn ghost" id="btnHelpClose">Cerrar</button>
        </div>
        <div class="modalBody" id="helpBody"></div>
        <div class="modalFoot">
          <button class="btn ghost" id="btnApplyHtml">Aplicar HTML</button>
          <button class="btn ghost" id="btnApplyCss">Aplicar CSS</button>
          <button class="btn ghost" id="btnApplyJs">Aplicar JS</button>
          <div class="small" id="helpNote"></div>
        </div>
      </div>
    </div>

  </div>`;
}

function computeNeeds(level){
  const tests = (level && level.tests) ? level.tests : [];
  const needHtml = true; // siempre hay UI
  const needJs = tests.some(t=>["eval","click_seq_display","type_seq_display","text_includes","text_eq"].includes(t.kind)) || /app\.js|JS|render|click/i.test(level?.hint||"");
  const needCss = !!(level?.starter?.css && String(level.starter.css).trim().length);

  let primary = "index.html";
  if(needJs && /render|ops|click|teclado|calc|event/i.test(level?.title||"")) primary = "app.js";
  if(level?.id && level.id.includes("_1_")) primary = "app.js";
  const labelParts = [];
  if(needHtml) labelParts.push("HTML");
  if(needCss) labelParts.push("CSS");
  if(needJs) labelParts.push("JS");

  return {
    html: needHtml,
    css: needCss,
    js: needJs,
    primary,
    label: labelParts.join(" + "),
  };
}

function pushMsg(feed, who, body){
  const t = nowTime();
  const line = `[${t}] ${who}: ${String(body ?? '')}`;
  const cur = feed.textContent || "";
  feed.textContent = (cur ? (cur + "\n") : "") + line;
  feed.scrollTop = feed.scrollHeight;
}

function init(){
  const root = document.querySelector("#app");
  root.innerHTML = appShell();

  // Console output area
  const consoleOut = document.querySelector('#consoleOut');
  let consoleLines = [];
  const pushConsole = (kind, args)=>{
    const t = nowTime();
    const line = `[${t}] ${kind.toUpperCase()}: ${(args||[]).join(' ')}`;
    consoleLines.push(line);
    if(consoleLines.length > 200) consoleLines = consoleLines.slice(-200);
    consoleOut.textContent = consoleLines.join('\n');
    consoleOut.scrollTop = consoleOut.scrollHeight;
  

    // If the Fiddle modal is open, mirror console there too
    const fOut = document.querySelector('#cqF_consoleOut');
    if(fOut){
      fOut.textContent = consoleLines.join('\\n');
      fOut.scrollTop = fOut.scrollHeight;
    }
  };

  window.addEventListener('message', (ev)=>{
    const d = ev.data;
    if(!d || d.__calcquest !== 1) return;
    pushConsole(d.kind || 'log', d.args || []);
  });

  document.querySelector('#btnClearConsole').addEventListener('click', ()=>{
    consoleLines = [];
    consoleOut.textContent = '';
  });

  const feed = document.querySelector("#feed");
  pushMsg(feed, "SYSTEM", "📡 Incoming Transmission...");
  pushMsg(feed, "SYSTEM", DEFAULT_MISSION.body);

  loadLevels().then(async data=>{
    const levels = data.levels || [];
    const select = document.querySelector("#levelSelect");
    select.innerHTML = levels.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)}</option>`).join("");

    let curId = getCurrentLevelId(levels);
    select.value = curId;

    const state = {
      levels,
      level: levels.find(l=>l.id===curId),
      tab: "html",
      code: {html:"", css:"", js:""},
      timerStart: null,
      timerT: null,
      passed: false,
      helpMode: null,
    };
    function applySolution(file){
      const sol = state.level?.solution;
      if(!sol) { pushMsg(feed, "ERROR", "No hay solución para este nivel."); return; }
      if(file === 'html'){ state.code.html = sol.html || ''; state.tab = 'html'; }
      if(file === 'css'){ state.code.css = sol.css || ''; state.tab = 'css'; }
      if(file === 'js'){ state.code.js = sol.js || ''; state.tab = 'js'; }
      saveCode(state.level.id, state.code);
      updateEditor();
      buildPreview();
      pushMsg(feed, "SYSTEM", `Aplicado ${file}. Ahora intenta reescribirlo sin mirar ⚡`);
    }



    function startAttempt(){
      state.passed = false;
      state.timerStart = Date.now();
      if(state.timerT) clearInterval(state.timerT);
      state.timerT = setInterval(()=>{
        const now = Date.now();
        const ms = now - (state.timerStart || now);
        document.querySelector('#timerNow').textContent = fmtMs(ms);
      }, 250);
      document.querySelector('#timerNow').textContent = '00:00';
      document.querySelector('#resultBadge').textContent = '—';
      document.querySelector('#statusPill').textContent = 'MISSION VIEWER: OFFLINE';
    }

    function stopAttemptAndMaybeSave(ok){
      if(!ok || state.passed) return;
      state.passed = true;
      if(state.timerT){ clearInterval(state.timerT); state.timerT = null; }
      const ms = Date.now() - (state.timerStart || Date.now());
      const stats = loadStats(state.level.id);
      stats.attempts = (stats.attempts||0) + 1;
      if(stats.bestMs == null || ms < stats.bestMs){
        stats.bestMs = ms;
        pushMsg(document.querySelector('#feed'), 'SYSTEM', `🏁 Nuevo best: ${fmtMs(ms)}`);
      }else{
        pushMsg(document.querySelector('#feed'), 'SYSTEM', `🏁 Tiempo: ${fmtMs(ms)}`);
      }
      saveStats(state.level.id, stats);
      document.querySelector('#timerBest').textContent = fmtMs(stats.bestMs);
    }

    function hideHelp(){
  const modal = document.querySelector('#helpModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
}

function showHelp(mode){
  const modal = document.querySelector('#helpModal');
  const title = document.querySelector('#helpTitle');
  const body = document.querySelector('#helpBody');
  const note = document.querySelector('#helpNote');

  const lvl = state.level;
  const need = computeNeeds(lvl);

  // Default: disable apply buttons if there is no solution for that file
  const sol = lvl?.solution || null;
  const canApply = !!sol;

  document.querySelector('#btnApplyHtml').style.display = canApply ? 'inline-flex' : 'none';
  document.querySelector('#btnApplyCss').style.display  = canApply ? 'inline-flex' : 'none';
  document.querySelector('#btnApplyJs').style.display   = canApply ? 'inline-flex' : 'none';

  if(mode === 'solution'){
    title.textContent = 'Solución (para mirar y reescribir)';
    if(!sol){
      body.innerHTML = `<div class="small">Aún no hay solución para este nivel.</div>`;
      note.textContent = '';
    }else{
      body.innerHTML = `
        <div class="small">Úsala así: mira 10 segundos, cierra, borra y reescribe. Repetición = poder ⚡</div>
        <div class="helpTabs">
          <button class="pillBtn" data-hfile="html">index.html</button>
          <button class="pillBtn" data-hfile="css">styles.css</button>
          <button class="pillBtn" data-hfile="js">app.js</button>
        </div>
        <pre class="helpCode" id="helpCode"></pre>
      `;
      const helpCode = body.querySelector('#helpCode');
      const setFile = (f)=>{
        const v = (sol && sol[f]) ? sol[f] : '';
        helpCode.textContent = v;
        body.querySelectorAll('.pillBtn').forEach(b=>b.classList.toggle('active', b.dataset.hfile===f));
      };
      body.querySelectorAll('.pillBtn').forEach(b=>{
        b.addEventListener('click', ()=>setFile(b.dataset.hfile));
      });
      setFile('html');
      note.textContent = `Necesitas: ${need.label}`;
    }
  }else{
    // Guided tutorial mode
    title.textContent = 'Tutorial guiado';
    const steps = (lvl?.hints && lvl.hints.length) ? lvl.hints : [lvl?.hint].filter(Boolean);
    const mission = lvl?.mission || DEFAULT_MISSION;
    body.innerHTML = `
      <div class="missionBox">
        <div class="missionTitle">${escapeHtml(mission.title || 'MISIÓN')}</div>
        <div class="missionBody">${escapeHtml(mission.body || '')}</div>
      </div>

      <div class="small" style="margin-top:10px">Qué tienes que hacer (en orden):</div>
      <ol class="steps">${(steps||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol>

      <div class="small" style="margin-top:10px">
        Dónde escribir ahora: <b>${need.primary}</b>
      </div>

      <div class="chips">
        <span class="chip ${need.html?'on':''}">HTML</span>
        <span class="chip ${need.css?'on':''}">CSS</span>
        <span class="chip ${need.js?'on':''}">JS</span>
      </div>
    `;
    note.textContent = `Objetivo: pasar ${lvl?.tests?.length||0} tests.`;
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}

    function refreshLevelMeta(){
      document.querySelector("#levelName").textContent = state.level?.title || "-";
      document.querySelector("#hintLine").textContent = state.level?.hint || "Tip: Haz lo mínimo y prueba.";
      document.querySelector("#progressBadge").textContent = `${(state.level?.tests?.length||0)} tests`;
      document.querySelector("#levelState").textContent = "Pendiente";
      document.querySelector("#levelState").className = "v";
      document.querySelector("#resultBadge").textContent = "—";
      document.querySelector("#statusPill").textContent = "MISSION VIEWER: OFFLINE";
      const stats = loadStats(state.level?.id || '');
      document.querySelector('#timerBest').textContent = fmtMs(stats.bestMs);
      document.querySelector('#timerNow').textContent = '00:00';
      hideHelp();
      const need = computeNeeds(state.level);
      document.querySelector('#reqLine').innerHTML = `Edita: <b>${need.primary}</b>`;
      document.querySelector('#whatNow').textContent = need.label || 'Tutorial';
}

    function setStateOk(ok){
      const el = document.querySelector("#levelState");
      el.textContent = ok ? "OK" : "FALLÓ";
      el.className = "v " + (ok ? "good" : "bad");
      document.querySelector("#resultBadge").textContent = ok ? "ACCESS GRANTED" : "ACCESS DENIED";
      document.querySelector("#statusPill").textContent = ok ? "MISSION VIEWER: ONLINE" : "MISSION VIEWER: OFFLINE";
    }

    function loadCode(){
      state.code = defaultCodeFor(state.level);
      saveCode(state.level.id, state.code);
      updateEditor();
      buildPreview();
    }

    function getActiveText(){
      return state.code[state.tab] || "";
    }

    function setActiveText(v){
      state.code[state.tab] = v;
      saveCode(state.level.id, state.code);
    }

    function updateEditor(){
      const ta = document.querySelector("#code");
      ta.value = getActiveText();
      document.querySelectorAll(".tab").forEach(t=>{
        t.classList.toggle("active", t.dataset.tab===state.tab);
      });
    }

    function buildPreviewTo(iframe){
      const mission = state.level?.mission || DEFAULT_MISSION;
      iframe.srcdoc = buildSrcdoc({ html: state.code.html, css: state.code.css, js: state.code.js, mission });
    }

    function buildPreview(){
      const iframe = document.querySelector("#preview");
      buildPreviewTo(iframe);
    }

    async function run(){
      buildPreview();
      const fprev = document.querySelector("#cqF_preview");
      if(fprev) buildPreviewTo(fprev);
      await new Promise(r=>setTimeout(r, 60));
      const res = await runTests(state.level, document.querySelector("#preview"));
      res.details.forEach(line=>{
        pushMsg(feed, res.ok ? "TRACE" : "ERROR", line);
      });
      setStateOk(res.ok);
      stopAttemptAndMaybeSave(res.ok);
      if(res.ok){
        // auto-advance if configured
        if(state.level?.next){
          const nextLevel = state.levels.find(l=>l.id===state.level.next);
          if(nextLevel){
            pushMsg(feed, "SYSTEM", "↳ Nuevo acceso desbloqueado: " + nextLevel.title);
          }
        }
      }
    }

    function resetLevel(){
      localStorage.removeItem(LS.codePrefix + state.level.id);
      state.code = defaultCodeFor(state.level);
      saveCode(state.level.id, state.code);
      pushMsg(feed, "SYSTEM", "Nivel reseteado. Vuelve a armarlo 👾");
      updateEditor();
      buildPreview();
      refreshLevelMeta();
      startAttempt();
    }

    // events
    select.addEventListener("change", ()=>{
      const id = select.value;
      const lvl = state.levels.find(l=>l.id===id);
      if(!lvl) return;
      state.level = lvl;
      setCurrentLevel(id);
      state.tab = "html";
      refreshLevelMeta();
      loadCode();
      pushMsg(feed, "SYSTEM", "Cambiando nivel: " + lvl.title);
      pushMsg(feed, "SYSTEM", (lvl.mission?.body || DEFAULT_MISSION.body));
      startAttempt();
    });

    document.querySelectorAll(".tab").forEach(tab=>{
      tab.addEventListener("click", ()=>{
        state.tab = tab.dataset.tab;
        updateEditor();
      });
    });

    const ta = document.querySelector("#code");
    ta.addEventListener("input", ()=>{
      setActiveText(ta.value);
    });
    ta.addEventListener("keydown", (e)=>{
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="s"){
        e.preventDefault();
        setActiveText(ta.value);
        pushMsg(feed, "SYSTEM", "Guardado ✅");
      }
    });

    document.querySelector("#btnPreview").addEventListener("click", ()=>{
      buildPreview();
      pushMsg(feed, "SYSTEM", "Preview recargado.");
    });
    document.querySelector("#btnRun").addEventListener("click", run);
    document.querySelector("#btnReset").addEventListener("click", resetLevel);

    document.querySelector('#btnNewAttempt').addEventListener('click', ()=>{
      pushMsg(feed, 'SYSTEM', '⏱ Nuevo intento iniciado.');
      startAttempt();
    });

    // Fiddle modal (programar)
    let fiddleOpen = false;
    function openFiddleModal(){
      if(fiddleOpen) return;
      fiddleOpen = true;

      const b = document.createElement('div');
      b.className = 'cqF_backdrop';
      b.innerHTML = `
        <div class="cqF_modal" role="dialog" aria-label="Programar">
          <div class="cqF_header">
            <div class="cqF_brand">
              <div class="cqF_title">CalcQuest IDE</div>
              <div class="cqF_sub">Modo Programar (tipo Fiddle)</div>
            </div>
            <div class="cqF_actions">
              <button class="btn good" id="cqF_run">⟳ Ejecutar</button>
              <button class="btn" id="cqF_close">Cerrar</button>
            </div>
          </div>

          <div class="cqF_tabs" role="tablist">
            <button class="cqF_tab active" data-ftab="html" role="tab">HTML</button>
            <button class="cqF_tab" data-ftab="js" role="tab">JavaScript</button>
            <button class="cqF_tab" data-ftab="css" role="tab">CSS</button>
          </div>

          <div class="cqF_body">
            <div class="cqF_editor">
              <textarea id="cqF_code" spellcheck="false"></textarea>
            </div>

            <div class="cqF_result">
              <div class="cqF_resultHeader">Resultado</div>
              <!-- allow-same-origin is required so parent can inspect iframe DOM for tests -->
              <iframe id="cqF_preview" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"></iframe>
            </div>

            <div class="cqF_console">
              <div class="cqF_consoleHeader">
                <div>Consola</div>
                <button class="btn ghost" id="cqF_clear">Clear</button>
              </div>
              <pre class="cqF_consoleOut" id="cqF_consoleOut"></pre>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(b);

      let ftab = state.tab || 'html';
      const ta = b.querySelector('#cqF_code');
      const fprev = b.querySelector('#cqF_preview');
      const applyFt = ()=>{
        // save current textarea to state
        const v = ta.value;
        if(state.code && ftab) state.code[ftab] = v;
        saveCode(state.level.id, state.code);
      };
      const loadFt = ()=>{
        ta.value = state.code[ftab] || '';
        b.querySelectorAll('.cqF_tab').forEach(t=>t.classList.toggle('active', t.dataset.ftab===ftab));
      };

      b.querySelectorAll('.cqF_tab').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          applyFt();
          ftab = btn.dataset.ftab;
          loadFt();
        });
      });

      // Save on Ctrl+S / Cmd+S
      ta.addEventListener('keydown', (e)=>{
        if((e.ctrlKey || e.metaKey) && (e.key==='s' || e.key==='S')){
          e.preventDefault();
          applyFt();
          buildPreviewTo(fprev);
          pushMsg(feed, 'SYSTEM', '💾 Guardado + ejecutado (IDE).');
        }
      });

      b.querySelector('#cqF_run').addEventListener('click', ()=>{
        applyFt();
        buildPreviewTo(fprev);
      });
      b.querySelector('#cqF_clear').addEventListener('click', ()=>{
        consoleLines = [];
        const out = b.querySelector('#cqF_consoleOut');
        if(out) out.textContent='';
        consoleOut.textContent='';
      });
      b.querySelector('#cqF_close').addEventListener('click', ()=>{
        applyFt();
        fiddleOpen = false;
        b.remove();
      });
      // close on backdrop click
      b.addEventListener('click', (e)=>{
        if(e.target === b){
          applyFt();
          fiddleOpen = false;
          b.remove();
        }
      });

      // init
      loadFt();
      buildPreviewTo(fprev);
    }

    document.querySelector('#btnProgram').addEventListener('click', ()=>{
      pushMsg(feed, 'SYSTEM', '🧑‍💻 Modo Programar abierto (IDE).');
      openFiddleModal();
    });

        document.querySelector('#btnHints').addEventListener('click', ()=>{
      showHelp('hints');
    });
    document.querySelector('#btnSolution').addEventListener('click', ()=>{
      showHelp('solution');
    });

    document.querySelector('#btnHelpClose').addEventListener('click', hideHelp);

    document.querySelector('#btnApplyHtml').addEventListener('click', ()=>applySolution('html'));
    document.querySelector('#btnApplyCss').addEventListener('click', ()=>applySolution('css'));
    document.querySelector('#btnApplyJs').addEventListener('click', ()=>applySolution('js'));

    document.querySelector("#btnExport").addEventListener("click", ()=>{
      const base = state.level?.id || "calcquest";
      download(base + "_index.html", state.code.html);
      download(base + "_styles.css", state.code.css);
      download(base + "_app.js", state.code.js);
      pushMsg(feed, "SYSTEM", "Exportado: HTML/CSS/JS ⬇");
    });

    // init
    refreshLevelMeta();
    loadCode();
    startAttempt();
  }).catch(err=>{
    document.querySelector("#feed").innerHTML = `<div class="msg"><div class="body">Error cargando niveles: ${escapeHtml(String(err))}</div></div>`;
  });
}

document.addEventListener("DOMContentLoaded", init);

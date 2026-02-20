/* CalcQuest v1 - Hacker Neon */
const LS = {
  levelId: "mc_calcquest_level",
  codePrefix: "mc_calcquest_code_",
};

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
${safeJs}
</script>
</body></html>`;
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

      <div class="feed scanline" id="feed"></div>

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
        </div>

        <div class="row">
          <button class="btn good" id="btnRun">▶ RUN TESTS</button>
          <button class="btn" id="btnPreview">↻ RELOAD PREVIEW</button>
          <button class="btn ghost" id="btnReset">⟲ RESET LEVEL</button>
        </div>

        <div class="row" style="justify-content:space-between;">
          <div class="small" id="hintLine">Tip: Empieza por HTML. Sin DOM, no hay misión.</div>
          <span class="badge" id="progressBadge">0/0</span>
        </div>

        <div class="row">
          <button class="btn" id="btnExport">⬇ EXPORT (HTML/CSS/JS)</button>
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
          <iframe id="preview" sandbox="allow-scripts allow-forms allow-pointer-lock"></iframe>
        </div>
      </div>

      <div class="footerBar">
        <div class="small" id="footerInfo">Ctrl+S guarda. (Auto) Preview recarga cuando tú quieras.</div>
        <div class="row">
          <span class="badge" id="resultBadge">—</span>
        </div>
      </div>
    </div>
  </div>`;
}

function pushMsg(feed, who, body){
  const el = document.createElement("div");
  el.className = "msg";
  el.innerHTML = `
    <div class="top">
      <div class="who">${escapeHtml(who)}</div>
      <div class="time">${escapeHtml(nowTime())}</div>
    </div>
    <div class="body">${escapeHtml(body)}</div>
  `;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function init(){
  const root = document.querySelector("#app");
  root.innerHTML = appShell();

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
    };

    function refreshLevelMeta(){
      document.querySelector("#levelName").textContent = state.level?.title || "-";
      document.querySelector("#hintLine").textContent = state.level?.hint || "Tip: Haz lo mínimo y prueba.";
      document.querySelector("#progressBadge").textContent = `${(state.level?.tests?.length||0)} tests`;
      document.querySelector("#levelState").textContent = "Pendiente";
      document.querySelector("#levelState").className = "v";
      document.querySelector("#resultBadge").textContent = "—";
      document.querySelector("#statusPill").textContent = "MISSION VIEWER: OFFLINE";
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

    function buildPreview(){
      const iframe = document.querySelector("#preview");
      const mission = state.level?.mission || DEFAULT_MISSION;
      iframe.srcdoc = buildSrcdoc({
        html: state.code.html,
        css: state.code.css,
        js: state.code.js,
        mission
      });
    }

    async function run(){
      buildPreview();
      await new Promise(r=>setTimeout(r, 60));
      const res = await runTests(state.level, document.querySelector("#preview"));
      res.details.forEach(line=>{
        pushMsg(feed, res.ok ? "TRACE" : "ERROR", line);
      });
      setStateOk(res.ok);
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
  }).catch(err=>{
    document.querySelector("#feed").innerHTML = `<div class="msg"><div class="body">Error cargando niveles: ${escapeHtml(String(err))}</div></div>`;
  });
}

document.addEventListener("DOMContentLoaded", init);


/**
 * Football Lab V5
 * - Teams + Players DB (0–10 rating)
 * - Match Logger with "Season" + only-current-season form
 * - XI Builder per Team + Formation
 * - Strength by lines (Attack/Defense/Control) using XI effective ratings (base + form)
 * - 3-way probabilities (Home/Draw/Away)
 *
 * Notes:
 * - Data stored local-first in localStorage key "footballDB"
 * - This is a study lab, not a betting tool.
 */

export function initFootballLab(){

  // Idempotent init guard with recovery:
  // only short-circuit if a usable API already exists.
  try{
    if(window.__footballLabInitialized && window.__FOOTBALL_LAB__?.open){
      return window.__FOOTBALL_LAB__;
    }
  }catch(e){ /* ignore */ }

  window.FOOTBALL_LAB_FILE = "footballLab_v8.js";
  // Idempotent init guard: only short-circuit if an OPENABLE api already exists.
  // If a previous boot failed halfway, we must allow a retry.
  try{
    if(window.__footballLabInitialized && window.__FOOTBALL_LAB__?.open){
      return window.__FOOTBALL_LAB__;
    }
    window.__footballLabInitialized = true;
  }catch(e){ /* ignore */ }
  console.log("⚽ FOOTBALL LAB V6e ACTIVE (v8e)", "•", window.FOOTBALL_LAB_VERSION || "(no main marker)");

  const KEY = "footballDB";
  let _fbSimCharts = { totals:null, scorelines:null };
  let _fbTrackerCharts = { pnl:null, wl:null };

  const DEFAULT_DB = {
    settings: {
      currentSeason: getAutoSeasonLabel(), // e.g., "2025-2026"
      homeAdvantage: 0.05,                // +5%
      formLastN: 5,                       // last N matches in current season
      formWeight: 0.35,                   // how much match form pulls rating (0..1)
      apiSportsKey: "",
      apiCacheHours: 12
    },
    weights: { // action category weights (editable)
      shots: 1.2,
      passes: 1.0,
      dribbles: 1.0,
      defense: 1.1,
      goalkeeper: 1.3,
      discipline: 1.0
    },
    teams: [],
    players: [],
    matches: [], // match logs per player
    lineups: {}, // lineups[teamId][formation][pos] = playerId
    betTracker: [],
    apiCache: { fixturesByTeam: {} }
  };

  function getAutoSeasonLabel(){
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth()+1;
    // Common football season: Aug -> May
    if(m >= 8) return `${y}-${y+1}`;
    return `${y-1}-${y}`;
  }

  function loadDB(){
    const raw = localStorage.getItem(KEY);
    if(!raw){
      localStorage.setItem(KEY, JSON.stringify(DEFAULT_DB));
      return structuredClone(DEFAULT_DB);
    }
    try{
      const db = JSON.parse(raw);
      // soft-migrate
      if(!db.settings) db.settings = structuredClone(DEFAULT_DB.settings);
      if(!db.weights) db.weights = structuredClone(DEFAULT_DB.weights);
      if(!db.teams) db.teams = [];
      if(!db.players) db.players = [];
      if(!db.matches) db.matches = [];
      if(!db.lineups) db.lineups = {};
      if(!db.betTracker) db.betTracker = [];
      if(!db.apiCache) db.apiCache = { fixturesByTeam: {} };
      if(!db.apiCache.fixturesByTeam) db.apiCache.fixturesByTeam = {};
      if(typeof db.settings.apiSportsKey !== "string") db.settings.apiSportsKey = "";
      if(!Number.isFinite(Number(db.settings.apiCacheHours))) db.settings.apiCacheHours = 12;
      // migrate leagues (V8)
      if(!db.leagues || !Array.isArray(db.leagues) || db.leagues.length===0){
        db.leagues = [
          { id: "lg_league", name: "Liga", createdAt: Date.now() },
          { id: "lg_cup", name: "Copa", createdAt: Date.now() },
          { id: "lg_intl", name: "Internacional", createdAt: Date.now() },
          { id: "lg_friendly", name: "Amistoso", createdAt: Date.now() },
        ];
      }
      if(!db.settings) db.settings = {};
      if(!db.settings.currentLeagueId) db.settings.currentLeagueId = db.leagues[0].id;

      return db;
    }catch(e){
      localStorage.setItem(KEY, JSON.stringify(DEFAULT_DB));
      return structuredClone(DEFAULT_DB);
    }
  }

  function saveDB(db){
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  async function getTeamLastFixtures(db, apiTeamId, opts={}){
    const teamKey = String(apiTeamId||"").trim();
    if(!teamKey) throw new Error("Falta apiTeamId del equipo.");

    const force = !!opts.force;
    const last = clamp(parseInt(opts.last)||5, 1, 10);
    const ttlMs = clampNum(db?.settings?.apiCacheHours, 1, 168, 12) * 60 * 60 * 1000;
    const now = Date.now();

    if(!db.apiCache) db.apiCache = { fixturesByTeam: {} };
    if(!db.apiCache.fixturesByTeam) db.apiCache.fixturesByTeam = {};

    const cached = db.apiCache.fixturesByTeam[teamKey];
    if(!force && cached?.savedAt && (now - cached.savedAt) < ttlMs && Array.isArray(cached.fixtures)){
      return { fixtures: cached.fixtures, source: "cache", savedAt: cached.savedAt };
    }

    const apiKey = String(db?.settings?.apiSportsKey || "").trim();
    if(!apiKey){
      throw new Error("Configura tu API Key de API-SPORTS en Ajustes.");
    }

    const url = `https://v3.football.api-sports.io/fixtures?team=${encodeURIComponent(teamKey)}&last=${last}`;
    const res = await fetch(url, {
      headers: {
        "x-apisports-key": apiKey
      }
    });
    if(!res.ok){
      throw new Error(`API-SPORTS respondió ${res.status}`);
    }
    const payload = await res.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];

    db.apiCache.fixturesByTeam[teamKey] = { savedAt: now, fixtures };
    saveDB(db);
    return { fixtures, source: "network", savedAt: now };
  }

  function summarizeFixtureForm(fixtures, apiTeamId){
    const teamIdNum = Number(apiTeamId);
    let pts = 0;
    let played = 0;
    for(const fx of (fixtures || [])){
      const homeId = Number(fx?.teams?.home?.id);
      const awayId = Number(fx?.teams?.away?.id);
      const hg = Number(fx?.goals?.home);
      const ag = Number(fx?.goals?.away);
      if(!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

      const isHome = homeId === teamIdNum;
      const isAway = awayId === teamIdNum;
      if(!isHome && !isAway) continue;

      const gf = isHome ? hg : ag;
      const ga = isHome ? ag : hg;
      played += 1;
      if(gf > ga) pts += 3;
      else if(gf === ga) pts += 1;
    }
    if(!played) return { played:0, points:0, ppg:0, factor:1 };
    const ppg = pts / played;
    // 1.50 ppg = neutral, cap +/-15%
    const factor = clamp(1 + ((ppg - 1.5) * 0.10), 0.85, 1.15);
    return { played, points:pts, ppg, factor };
  }

  function uid(prefix="id"){
    return `${prefix}_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  }

  function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

  // --- Elo-style update (performance vs expected), scaled by minutes ---
  function updateEloRating(current, performanceScore, minutes, kBase=0.18){
    const minFactor = Math.sqrt(clamp((minutes||0)/90, 0, 1));
    const K = kBase * minFactor;
    const expected = current;
    const delta = K * (performanceScore - expected);
    return { newRating: clamp(expected + delta, 0, 10), delta, K };
  }

  function fmt(n, d=2){ return (Number.isFinite(n) ? n : 0).toFixed(d); }

  // --- Poisson sampler (for goal simulation) ---
  function poissonSample(lambda){
    const L = Math.exp(-Math.max(0, lambda));
    let k = 0;
    let p = 1;
    while(p > L){
      k++;
      p *= Math.random();
      // safety guard for extreme lambdas
      if(k > 20) break;
    }
    return Math.max(0, k-1);
  }

  function clampNum(v, min, max, fallback){
    const n = Number(v);
    if(!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
  }

  const POS_LABELS = {
    GK: "GK — Portero",
    CB: "CB — Defensa Central",
    LB: "LB — Lateral Izquierdo",
    RB: "RB — Lateral Derecho",
    CM: "CM — Mediocampista Central",
    CDM: "CDM — Mediocentro Defensivo",
    CAM: "CAM — Mediocentro Ofensivo",
    LW: "LW — Extremo Izquierdo",
    RW: "RW — Extremo Derecho",
    ST: "ST — Delantero Centro"
  };

  const FORMATIONS = {
    "433": ["GK","LB","CB","CB","RB","CDM","CM","CAM","LW","ST","RW"],
    "442": ["GK","LB","CB","CB","RB","CM","CM","LM","RM","ST","ST"], // LM/RM mapped to LW/RW for strength
    "343": ["GK","CB","CB","CB","LM","RM","CM","CAM","LW","ST","RW"], // LM/RM mapped to LW/RW
  };

  function normalizePos(pos){
    if(pos === "LM") return "LW";
    if(pos === "RM") return "RW";
    return pos;
  }

  // ---- Hook into MemoryCarl "Más" (More) ----
  const moreBtn = document.querySelector("#moreBtn");
  if(moreBtn){
    const labBtn = document.createElement("button");
    labBtn.innerText = "⚽ Football Lab (V8)";
    labBtn.className = "more-item";
    labBtn.onclick = () => openLab("home");
    moreBtn.parentElement.appendChild(labBtn);
  }

  let renderSettings = function(db){};

  function publishFootballLabApi(){
    window.__FOOTBALL_LAB__ = {
      version: "V6e",
      open: (view, payload)=> openLab(view, payload),
      db: ()=> loadDB(),
      setDB: (db)=> saveDB(db),
      help: "window.__FOOTBALL_LAB__.open('player',{playerId:'...'})"
    };
  }

  function openLab(view, payload={}){
    const db = loadDB();
    const root = document.getElementById("app");

    // Minimal top nav
    root.innerHTML = `
      <div style="padding:18px 18px 22px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-size:20px;font-weight:800;">⚽ Football Lab <span class="fl-pill">V6e</span></div>
            <div style="opacity:.8;font-size:12px;">Modo estudio • Temporada actual: <b>${escapeHtml(db.settings.currentSeason)}</b></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="mc-btn" id="navHome">Inicio</button>
            <button class="mc-btn" id="navTeams">Equipos</button>
            <button class="mc-btn" id="navVersus">Versus</button>
            <button class="mc-btn" id="navTracker">Tracker</button>
            <button class="mc-btn" id="navSettings">Ajustes</button>
            <button class="mc-btn" id="navBack">Volver</button>
          </div>
        </div>
        <div style="height:10px;"></div>
        <div id="fl_view"></div>
      </div>
    `;

    // Buttons style fallback if MemoryCarl doesn't define it
    injectMiniStyle();

    // nav
    document.getElementById("navHome").onclick = ()=>openLab("home");
    document.getElementById("navTeams").onclick = ()=>openLab("teams");
    document.getElementById("navVersus").onclick = ()=>openLab("versus");
    document.getElementById("navTracker").onclick = ()=>openLab("tracker");
    document.getElementById("navSettings").onclick = ()=>openLab("settings");
    document.getElementById("navBack").onclick = ()=>location.reload();

    // render
    if(view==="home") renderHome(db);
    if(view==="teams") renderTeams(db);
    if(view==="team") renderTeam(db, payload.teamId);
    if(view==="lineup") renderLineup(db, payload.teamId);
    if(view==="logger") renderLogger(db, payload.teamId);
    if(view==="versus") renderVersus(db);
    if(view==="tracker") renderTrackerTab(db);
    if(view==="settings"){
      try{ renderSettings(db); }
      catch(err){
        console.error("FootballLab settings render error", err);
        const vv = document.getElementById("fl_view");
        if(vv) vv.innerHTML = `<div class="fl-card"><div style="font-weight:800;">⚠️ Error al abrir Ajustes</div><div class="fl-small" style="margin-top:8px;">${escapeHtml(String(err?.message||err))}</div></div>`;
      }
    }
    if(view==="player") renderPlayer(db, payload.playerId);

  }

  function renderTrackerTab(db){
    const v = document.getElementById("fl_view");
    if(!Array.isArray(db.betTracker)) db.betTracker = [];
    v.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:900;">📈 Tracker de apuestas</div>
        <div class="fl-row" style="margin-top:10px;">
          <input class="fl-input" id="trk_match" placeholder="Partido / evento">
          <input class="fl-input" id="trk_market" placeholder="Mercado">
          <select class="fl-select" id="trk_result"><option value="win">Ganada</option><option value="loss">Perdida</option><option value="push">Nula</option></select>
          <input class="fl-input" id="trk_odds" type="number" min="1.01" step="0.01" value="1.90">
          <input class="fl-input" id="trk_stake" type="number" min="0" step="0.01" value="10">
          <button class="mc-btn" id="trk_add">Agregar</button>
        </div>
        <div id="trk_summary" class="fl-small" style="margin-top:10px;"></div>
      </div>
      <div class="fl-grid2">
        <div class="fl-card" style="margin:0;"><canvas id="trk_chart_pnl" height="180"></canvas></div>
        <div class="fl-card" style="margin:0;"><canvas id="trk_chart_wl" height="180"></canvas></div>
      </div>
      <div class="fl-card"><div id="trk_list"></div></div>
    `;

    const draw = ()=>{
      const rows = db.betTracker;
      let wins=0, losses=0, pushes=0, stake=0, pnl=0, cum=0;
      const labels=[], data=[];
      rows.forEach((r,i)=>{
        if(r.result==="win") wins++; else if(r.result==="loss") losses++; else pushes++;
        stake += Number(r.stake)||0;
        pnl += Number(r.profit)||0;
        cum += Number(r.profit)||0;
        labels.push(String(i+1));
        data.push(+cum.toFixed(2));
      });
      document.getElementById("trk_summary").innerHTML = `Apuestas: <b>${rows.length}</b> • W/L/P: <b>${wins}</b>/<b>${losses}</b>/<b>${pushes}</b> • Stake: <b>${fmt(stake,2)}</b> • PnL: <b style="color:${pnl>=0?"#8ff0a4":"#ff9b9b"};">${fmt(pnl,2)}</b>`;
      document.getElementById("trk_list").innerHTML = rows.slice().reverse().map(r=>`<div class="fl-small" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);"><b>${escapeHtml(r.match||"(sin partido)")}</b> • ${escapeHtml(r.market||"Mercado")} • ${r.result} • cuota ${fmt(r.odds,2)} • stake ${fmt(r.stake,2)} • <b style="color:${(r.profit||0)>=0?"#8ff0a4":"#ff9b9b"};">${fmt(r.profit,2)}</b></div>`).join("") || `<div class="fl-small" style="opacity:.7;">Sin registros.</div>`;
      if(typeof Chart!=="undefined"){
        try{ _fbTrackerCharts.pnl?.destroy?.(); }catch(e){}
        try{ _fbTrackerCharts.wl?.destroy?.(); }catch(e){}
        _fbTrackerCharts.pnl = new Chart(document.getElementById("trk_chart_pnl").getContext("2d"), { type:"line", data:{labels, datasets:[{data, label:"PnL", fill:true, tension:.25}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}} });
        _fbTrackerCharts.wl = new Chart(document.getElementById("trk_chart_wl").getContext("2d"), { type:"doughnut", data:{labels:["Ganadas","Perdidas","Nulas"], datasets:[{data:[wins,losses,pushes], backgroundColor:["#3fb950","#f85149","#8b949e"]}]}, options:{responsive:true, maintainAspectRatio:false} });
      }
    };

    document.getElementById("trk_add").onclick = ()=>{
      const result = document.getElementById("trk_result").value;
      const odds = clampNum(document.getElementById("trk_odds").value, 1.01, 999, 1.9);
      const stake = Math.max(0, Number(document.getElementById("trk_stake").value)||0);
      db.betTracker.push({ id: uid("bet"), match: document.getElementById("trk_match").value.trim(), market: document.getElementById("trk_market").value.trim(), result, odds, stake, profit: result==="win" ? (odds-1)*stake : result==="loss" ? -stake : 0 });
      saveDB(db);
      draw();
    };

    draw();
  }


  publishFootballLabApi();

  function injectMiniStyle(){
    if(document.getElementById("fl_v5_style")) return;
    const s = document.createElement("style");
    s.id="fl_v5_style";
    s.textContent = `
      .mc-btn{
        background:#151515;border:1px solid rgba(255,255,255,.12);
        color:#fff;padding:8px 10px;border-radius:10px;cursor:pointer;
        font-weight:650;font-size:12px;
      }
      .mc-btn:hover{ border-color: rgba(255,255,255,.25); }
      .fl-card{
        background:#0f0f0f;border:1px solid rgba(255,255,255,.10);
        border-radius:14px;padding:12px;margin:10px 0;
      }
      .fl-row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .fl-row > * { flex: 1 1 auto; }
      .fl-input, .fl-select{
        background:#111;border:1px solid rgba(255,255,255,.15);
        color:#fff;border-radius:10px;padding:9px 10px; width:100%;
      }
      .fl-small{ font-size:12px; opacity:.85; }
      .fl-h3{ margin:10px 0 6px 0; font-size:14px; opacity:.9; }
      .fl-pill{
        display:inline-block;padding:4px 8px;border:1px solid rgba(255,255,255,.14);
        border-radius:999px;font-size:11px;opacity:.9;margin-right:6px;margin-top:6px;
      }
      .fl-grid2{ display:grid; grid-template-columns: 1fr; gap:10px; }
      @media (min-width: 820px){ .fl-grid2{ grid-template-columns: 1fr 1fr; } }
    `;
    document.head.appendChild(s);
  }

  function escapeHtml(str){
    return String(str||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ---- Home ----
  
  // ----- Modal helper (simple, local to FutbolLab) -----
  function ensureFLModal(){
    if(document.getElementById("fl_modalOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "fl_modalOverlay";
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; align-items:center; justify-content:center; z-index:9999; padding:16px;";
    overlay.innerHTML = `
      <div id="fl_modalBox" style="width:min(920px, 100%); max-height:90vh; overflow:auto; background:rgba(20,20,24,.98); border:1px solid rgba(255,255,255,.10); border-radius:16px; box-shadow:0 12px 60px rgba(0,0,0,.5);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 14px; border-bottom:1px solid rgba(255,255,255,.08); position:sticky; top:0; background:rgba(20,20,24,.98); z-index:2;">
          <div>
            <div id="fl_modalTitle" style="font-weight:700; font-size:15px;">Editar partido</div>
            <div id="fl_modalSub" style="opacity:.8; font-size:12px; margin-top:2px;"></div>
          </div>
          <button id="fl_modalClose" class="mc-btn" style="padding:8px 10px;">Cerrar</button>
        </div>
        <div id="fl_modalBody" style="padding:14px;"></div>
        <div style="display:flex; justify-content:flex-end; gap:10px; padding:14px; border-top:1px solid rgba(255,255,255,.08); position:sticky; bottom:0; background:rgba(20,20,24,.98);">
          <button id="fl_modalCancel" class="mc-btn" style="padding:10px 12px; opacity:.9;">Cancelar</button>
          <button id="fl_modalSave" class="mc-btn" style="padding:10px 12px; font-weight:700;">Guardar</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e)=>{
      if(e.target === overlay) closeFLModal();
    });
    document.body.appendChild(overlay);

    overlay.querySelector("#fl_modalClose").onclick = closeFLModal;
    overlay.querySelector("#fl_modalCancel").onclick = closeFLModal;
  }

  function openFLModal({title="Modal", sub="", bodyHTML="", onSave=null}){
    ensureFLModal();
    let overlay = document.getElementById("fl_modalOverlay");
    overlay.style.display = "flex";
    overlay.querySelector("#fl_modalTitle").textContent = title;
    overlay.querySelector("#fl_modalSub").textContent = sub || "";
    const body = overlay.querySelector("#fl_modalBody");
    body.innerHTML = bodyHTML;

    const saveBtn = overlay.querySelector("#fl_modalSave");
    saveBtn.onclick = ()=>{
      if(typeof onSave === "function"){
        const ok = onSave(overlay);
        if(ok !== false) closeFLModal();
      } else {
        closeFLModal();
      }
    };

    // escape key
    const esc = (ev)=>{ if(ev.key==="Escape"){ closeFLModal(); } };
    overlay._esc = esc;
    window.addEventListener("keydown", esc);
  }

  function closeFLModal(){
    let overlay = document.getElementById("fl_modalOverlay");
    if(!overlay) return;
    overlay.style.display = "none";
    overlay.querySelector("#fl_modalBody").innerHTML = "";
    if(overlay._esc){
      window.removeEventListener("keydown", overlay._esc);
      overlay._esc = null;
    }
  }

  function inputRow(label, id, value, type="number", placeholder=""){
    const v = (value===undefined || value===null) ? "" : String(value);
    return `
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div style="opacity:.85; font-size:12px;">${escapeHtml(label)}</div>
        <input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(v)}" placeholder="${escapeHtml(placeholder)}"
          style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.03); color:inherit; outline:none;" />
      </div>
    `;
  }

  
  function inputPair(label, idBase, value, opts={}){
    const {
      min=0, max=10, step=1, placeholder="", unit=""
    } = opts || {};
    const v = (value===undefined || value===null) ? "" : String(value);
    const idNum = idBase+"_num";
    const idRange = idBase+"_range";
    const u = unit ? `<span style="opacity:.75; font-size:12px;">${escapeHtml(unit)}</span>` : "";
    return `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="opacity:.85; font-size:12px;">${escapeHtml(label)}</div>
          ${u}
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <input id="${escapeHtml(idNum)}" type="number" value="${escapeHtml(v)}" placeholder="${escapeHtml(placeholder)}"
            min="${escapeHtml(String(min))}" max="${escapeHtml(String(max))}" step="${escapeHtml(String(step))}"
            style="width:140px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.03); color:inherit; outline:none;" />
          <input id="${escapeHtml(idRange)}" type="range" value="${escapeHtml(v||String(min))}"
            min="${escapeHtml(String(min))}" max="${escapeHtml(String(max))}" step="${escapeHtml(String(step))}"
            style="flex:1;" />
        </div>
      </div>
    `;
  }

  function syncPair(overlay, idBase, fallback=0){
    const n = overlay.querySelector("#"+CSS.escape(idBase+"_num"));
    const r = overlay.querySelector("#"+CSS.escape(idBase+"_range"));
    if(!n || !r) return;
    const toNum = (x)=>{ const v=parseFloat(String(x||"").replace(",", ".")); return Number.isFinite(v) ? v : fallback; };
    const setBoth = (val)=>{
      const vv = String(val);
      n.value = vv;
      r.value = vv;
    };
    n.addEventListener("input", ()=>{ r.value = n.value; });
    r.addEventListener("input", ()=>{ n.value = r.value; });
    // normalize initial
    setBoth(toNum(n.value));
  }

  function getPairNum(overlay, idBase, fallback=0){
    const el = overlay.querySelector("#"+CSS.escape(idBase+"_num"));
    if(!el) return fallback;
    const n = parseFloat(String(el.value||"").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function attachLiveCalcs(overlay){
    const upd = ()=>{
      const passC = getPairNum(overlay,"s_passC",0);
      const passA = getPairNum(overlay,"s_passA",0);
      const duelsW = getPairNum(overlay,"s_duelsWon",0);
      const duelsT = getPairNum(overlay,"s_duelsTot",0);
      const passPct = (passA>0) ? (passC/passA*100) : 0;
      const duelPct = (duelsT>0) ? (duelsW/duelsT*100) : 0;
      const pEl = overlay.querySelector("#calc_passPct");
      const dEl = overlay.querySelector("#calc_duelPct");
      if(pEl) pEl.textContent = `${fmt(passPct,0)}%`;
      if(dEl) dEl.textContent = `${fmt(duelPct,0)}%`;
    };
    overlay.querySelectorAll("input").forEach(inp=>{
      inp.addEventListener("input", upd);
    });
    upd();
  }

function readNum(overlay, id, fallback=0){
    const el = overlay.querySelector("#"+CSS.escape(id));
    if(!el) return fallback;
    const n = parseFloat(String(el.value||"").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function readStr(overlay, id, fallback=""){
    const el = overlay.querySelector("#"+CSS.escape(id));
    if(!el) return fallback;
    return String(el.value||fallback).trim();
  }

  function openEditMatchModal(db, playerId, matchId){
    const mm = db.matches.find(x=>x.id===matchId);
    if(!mm) return;

    mm.stats = mm.stats || {};
    const title = "Editar partido";
    const sub = `${mm.matchTitle || mm.title || "Partido"} • ${mm.date || ""}`;

    const bodyHTML = `
      <div class="fl-grid2">
        ${inputRow("Fecha (YYYY-MM-DD)", "m_date", mm.date || "", "text", "2026-02-19")}
        ${inputPair("Score (0-10)", "m_score", mm.score ?? 0, {min:0, max:10, step:0.1})}
        ${inputPair("Minutos", "s_minutes", mm.stats.minutes ?? 0, {min:0, max:120, step:1})}
        ${inputPair("Rating (0-10)", "s_rating", mm.stats.rating ?? mm.score ?? 0, {min:0, max:10, step:0.1})}
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:14px 0 8px;">
        <div style="font-weight:700; opacity:.9;">Pases</div>
        <div style="opacity:.85; font-size:12px;">Pass%: <b id="calc_passPct">0%</b></div>
      </div>
      <div class="fl-grid2">
        ${inputPair("Pases completados", "s_passC", mm.stats.passC ?? 0, {min:0, max:150, step:1})}
        ${inputPair("Pases intentados", "s_passA", mm.stats.passA ?? 0, {min:0, max:200, step:1})}
        ${inputPair("Key passes", "s_keyPasses", mm.stats.keyPasses ?? 0, {min:0, max:20, step:1})}
        ${inputPair("Pases progresivos", "s_progPasses", mm.stats.progPasses ?? 0, {min:0, max:50, step:1})}
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:14px 0 8px;">
        <div style="font-weight:700; opacity:.9;">Duelo / Regate / Defensa</div>
        <div style="opacity:.85; font-size:12px;">Duel%: <b id="calc_duelPct">0%</b></div>
      </div>
      <div class="fl-grid2">
        ${inputPair("Duelos ganados", "s_duelsWon", mm.stats.duelsWon ?? 0, {min:0, max:50, step:1})}
        ${inputPair("Duelos totales", "s_duelsTot", mm.stats.duelsTot ?? 0, {min:0, max:60, step:1})}
        ${inputPair("Regates buenos", "s_dribblesWon", mm.stats.dribblesWon ?? 0, {min:0, max:20, step:1})}
        ${inputPair("Acciones defensivas", "s_defActions", mm.stats.defActions ?? 0, {min:0, max:40, step:1})}
      </div>

      <div style="margin:14px 0 8px; font-weight:700; opacity:.9;">Producción</div>
      <div class="fl-grid2">
        ${inputPair("Goles", "s_goals", mm.stats.goals ?? 0, {min:0, max:10, step:1})}
        ${inputPair("Asistencias", "s_assists", mm.stats.assists ?? 0, {min:0, max:10, step:1})}
        ${inputPair("xG", "s_xg", mm.stats.xG ?? 0, {min:0, max:5, step:0.01})}
        ${inputPair("xA", "s_xa", mm.stats.xA ?? 0, {min:0, max:5, step:0.01})}
      </div>

      <div style="margin-top:12px; opacity:.7; font-size:12px;">
        Tip: los % se calculan en vivo mientras mueves los sliders.
      </div>
    `;

    openFLModal({
      title,
      sub,
      bodyHTML,
      onSave: (overlay)=>{
        const newDate = readStr(overlay, "m_date", mm.date || "");
        const newScore = getPairNum(overlay, "m_score", mm.score ?? 0);
        const minutes = getPairNum(overlay, "s_minutes", mm.stats.minutes ?? 0);
        const rating = getPairNum(overlay, "s_rating", mm.stats.rating ?? mm.score ?? 0);

        mm.date = newDate || mm.date;
        mm.score = clamp(newScore, 0, 10);

        // stats
        mm.stats.minutes = Math.max(0, Math.round(minutes));
        mm.stats.rating = clamp(rating, 0, 10);
        mm.stats.passC = Math.max(0, Math.round(getPairNum(overlay, "s_passC", mm.stats.passC ?? 0)));
        mm.stats.passA = Math.max(0, Math.round(getPairNum(overlay, "s_passA", mm.stats.passA ?? 0)));
        mm.stats.keyPasses = Math.max(0, Math.round(getPairNum(overlay, "s_keyPasses", mm.stats.keyPasses ?? 0)));
        mm.stats.progPasses = Math.max(0, Math.round(getPairNum(overlay, "s_progPasses", mm.stats.progPasses ?? 0)));

        mm.stats.duelsWon = Math.max(0, Math.round(getPairNum(overlay, "s_duelsWon", mm.stats.duelsWon ?? 0)));
        mm.stats.duelsTot = Math.max(0, Math.round(getPairNum(overlay, "s_duelsTot", mm.stats.duelsTot ?? 0)));
        mm.stats.dribblesWon = Math.max(0, Math.round(getPairNum(overlay, "s_dribblesWon", mm.stats.dribblesWon ?? 0)));
        mm.stats.defActions = Math.max(0, Math.round(getPairNum(overlay, "s_defActions", mm.stats.defActions ?? 0)));

        mm.stats.goals = Math.max(0, Math.round(getPairNum(overlay, "s_goals", mm.stats.goals ?? 0)));
        mm.stats.assists = Math.max(0, Math.round(getPairNum(overlay, "s_assists", mm.stats.assists ?? 0)));
        mm.stats.xG = Math.max(0, getPairNum(overlay, "s_xg", mm.stats.xG ?? 0));
        mm.stats.xA = Math.max(0, getPairNum(overlay, "s_xa", mm.stats.xA ?? 0));

        // derived
        mm.stats.passPct = (mm.stats.passA > 0) ? (mm.stats.passC / mm.stats.passA) : 0;
        mm.stats.duelPct = (mm.stats.duelsTot > 0) ? (mm.stats.duelsWon / mm.stats.duelsTot) : 0;

        saveDB(db);
        openLab("player",{playerId});
    {
// sliders: keep number <-> range synced
    let overlay = document.getElementById("fl_modalOverlay");
    if(overlay){
      ["m_score","s_minutes","s_rating","s_passC","s_passA","s_keyPasses","s_progPasses","s_duelsWon","s_duelsTot","s_dribblesWon","s_defActions","s_goals","s_assists","s_xg","s_xa"].forEach(idBase=>{
        syncPair(overlay, idBase, 0);
      });
      attachLiveCalcs(overlay);
    }
}

      }
    });
  }

function renderHome(db){
    const v = document.getElementById("fl_view");

    const counts = {
      teams: db.teams.length,
      players: db.players.length,
      logsSeason: db.matches.filter(m=>m.season===db.settings.currentSeason).length
    };

    v.innerHTML = `
      <div class="fl-grid2">
        <div class="fl-card">
          <div style="font-weight:800;">📚 Resumen</div>
          <div class="fl-small" style="margin-top:6px;">
            Equipos: <b>${counts.teams}</b> • Jugadores: <b>${counts.players}</b><br/>
            Registros (temporada actual): <b>${counts.logsSeason}</b>
          </div>
          <div style="margin-top:10px;" class="fl-row">
            <button class="mc-btn" id="goTeams">Gestionar Equipos</button>
            <button class="mc-btn" id="goVersus">Versus</button>
          </div>
          <div class="fl-small" style="margin-top:10px;">
            Idea clave: solo usamos <b>temporada actual</b> para simular el próximo partido (forma reciente).
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:800;">🧠 Cómo se calcula “forma”</div>
          <div class="fl-small" style="margin-top:6px;">
            Para cada jugador: tomamos sus últimos <b>${db.settings.formLastN}</b> partidos en la temporada <b>${escapeHtml(db.settings.currentSeason)}</b>.
            Eso genera un <b>FormScore</b> (0–10) que ajusta su rating base con un peso <b>${fmt(db.settings.formWeight,2)}</b>.
          </div>
          <div class="fl-small" style="margin-top:10px;">
            Rating efectivo = base + formWeight × (FormScore - base).<br/>
            Así, un jugador “7.2” en gran racha se comporta como “más fuerte” para el próximo partido.
          </div>
        </div>
      </div>
    `;

    document.getElementById("goTeams").onclick = ()=>openLab("teams");
    document.getElementById("goVersus").onclick = ()=>openLab("versus");
  }

  // ---- Teams list ----
  function renderTeams(db){
    const v = document.getElementById("fl_view");

    v.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:800;">🏟 Equipos</div>
        <div class="fl-row" style="margin-top:10px;">
          <input class="fl-input" id="teamName" placeholder="Nombre del equipo">
          <button class="mc-btn" id="addTeam">Agregar</button>
        </div>
        <div id="fl_teamStatus" class="fl-small" style="margin-top:8px; opacity:.75;"></div>
        <div id="teamsList" style="margin-top:10px;"></div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">📦 Backup</div>
        <div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="exportDB">Exportar JSON</button>
          <button class="mc-btn" id="importDB">Importar JSON</button>
        </div>
        <textarea class="fl-input" id="dbText" rows="6" placeholder="Aquí sale/pega tu JSON..."></textarea>
        <div class="fl-small" style="margin-top:8px;">Tip: Exporta antes de hacer cambios grandes.</div>
      </div>
    `;

    const list = document.getElementById("teamsList");

    function draw(){
      const rows = db.teams.map(t=>{
        const pCount = db.players.filter(p=>p.teamId===t.id).length;
        return `
          <div class="fl-card" style="margin:10px 0;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
              <div>
                <div style="font-weight:800;">${escapeHtml(t.name)}</div>
                <div class="fl-small">${pCount} jugadores</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                <button class="mc-btn" data-open="${t.id}">Abrir</button>
                <button class="mc-btn" data-lineup="${t.id}">XI</button>
                <button class="mc-btn" data-del="${t.id}">Eliminar</button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      list.innerHTML = rows || `<div class="fl-small" style="opacity:.75;">Aún no hay equipos. Crea el primero arriba 👆</div>`;

      list.querySelectorAll("[data-open]").forEach(b=>b.onclick = ()=>openLab("team",{teamId:b.getAttribute("data-open")}));
      list.querySelectorAll("[data-lineup]").forEach(b=>b.onclick = ()=>openLab("lineup",{teamId:b.getAttribute("data-lineup")}));
      list.querySelectorAll("[data-del]").forEach(b=>b.onclick = ()=>{
        const idRaw = b.getAttribute("data-del");
        const id = String(idRaw||"");
        if(!confirm("¿Eliminar equipo y sus jugadores?")) return;

        try{
          const before = db.teams.length;

          // Remove team + its players (robust against number/string ids)
          db.teams = db.teams.filter(t=>String(t.id)!==id);
          db.players = db.players.filter(p=>String(p.teamId)!==id);

          // Optional: prune lineups for this team
          if(db.lineups && db.lineups[id]) delete db.lineups[id];
          if(db.lineups){
            // also remove numeric-key variant, just in case
            for(const k of Object.keys(db.lineups)){
              if(String(k)===id) delete db.lineups[k];
            }
          }

          saveDB(db);

          const after = db.teams.length;
          const st = document.getElementById("fl_teamStatus");
          if(st){
            st.textContent = (after < before) ? "Equipo eliminado ✅" : "No se pudo eliminar (id no coincide).";
            st.style.opacity = "0.85";
          }

          // Re-render immediately (no depender de navegación)
          renderTeams(db);

        }catch(err){
          console.error("[FootballLab] delete team error", err);
          const st = document.getElementById("fl_teamStatus");
          if(st){
            st.textContent = "Error al eliminar: " + (err?.message || err);
            st.style.opacity = "0.95";
          }
        }
      });
    }

    draw();

    document.getElementById("addTeam").onclick = ()=>{
      const name = document.getElementById("teamName").value.trim();
      if(!name) return;
      db.teams.push({id:uid("team"), name});
      saveDB(db);
      openLab("teams");
    };

    document.getElementById("exportDB").onclick = ()=>{
      document.getElementById("dbText").value = JSON.stringify(db, null, 2);
    };

    document.getElementById("importDB").onclick = ()=>{
      try{
        const txt = document.getElementById("dbText").value.trim();
        if(!txt) return;
        const incoming = JSON.parse(txt);
        localStorage.setItem(KEY, JSON.stringify(incoming));
        alert("Importado. Reiniciando vista…");
        openLab("teams");
      }catch(e){
        alert("JSON inválido.");
      }
    };
  }

  // ---- Team detail: Players + logger shortcut ----
  function renderTeam(db, teamId){
    const team = db.teams.find(t=>t.id===teamId);
    const v = document.getElementById("fl_view");
    if(!team){
      v.innerHTML = `<div class="fl-card">Equipo no encontrado.</div>`;
      return;
    }

    const players = db.players.filter(p=>p.teamId===teamId);

    v.innerHTML = `
      <div class="fl-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:900;font-size:16px;">${escapeHtml(team.name)}</div>
            <div class="fl-small">Jugadores: ${players.length} • Temporada: <b>${escapeHtml(db.settings.currentSeason)}</b></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="mc-btn" id="goLineup">XI Builder</button>
            <button class="mc-btn" id="goLogger">Match Logger</button>
          </div>
        </div>

        <div class="fl-row" style="margin-top:10px;align-items:flex-end;">
          <div>
            <div class="fl-h3">API Team ID (API-SPORTS)</div>
            <input class="fl-input" id="apiTeamId" type="number" min="1" placeholder="Ej: 33" value="${escapeHtml(String(team.apiTeamId||""))}">
          </div>
          <div style="display:flex;gap:8px;">
            <button class="mc-btn" id="saveApiTeamId">Guardar ID</button>
            <button class="mc-btn" id="syncTeamFixtures">Sync últimos 5</button>
          </div>
        </div>
        <div id="apiFixtureStatus" class="fl-small" style="margin-top:8px;opacity:.85;"></div>
        <div id="apiFixtureSummary" class="fl-small" style="margin-top:4px;"></div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">➕ Agregar Jugador</div>
        <div class="fl-row" style="margin-top:10px;">
          <input class="fl-input" id="pName" placeholder="Nombre">
          <select class="fl-select" id="pPos"></select>
          <input class="fl-input" id="pRating" type="number" min="0" max="10" step="0.1" placeholder="Rating base (0–10)">
          <button class="mc-btn" id="addPlayer">Agregar</button>
        </div>
        <div class="fl-small" style="margin-top:8px;">Tip: rating base es “nivel general”. La forma de la temporada lo ajusta.</div>
      </div>

      
      <div class="fl-card">
        <div style="font-weight:800;">⬇️ Importar JSON (FootballLab Clip)</div>
        <div class="fl-small" style="margin-top:6px;opacity:.85;">
          Pega aquí el JSON exportado desde la extensión. Se creará el jugador (si no existe) y se agregará el partido a su historial.
        </div>
        <div class="fl-row" style="margin-top:10px;gap:8px;flex-wrap:wrap;">
          <button class="mc-btn" id="fl_impPaste">Pegar</button>
          <button class="mc-btn" id="fl_impFile">Archivo</button>
          <button class="mc-btn" id="fl_impRun">Importar</button>
          <button class="mc-btn" id="fl_impClear">Limpiar</button>
          <input type="file" id="fl_impFileInput" accept="application/json,.json" style="display:none;" />
        </div>
        <textarea class="fl-input" id="fl_impText" rows="7" placeholder='Pega aquí el JSON...'></textarea>
        <div id="fl_impStatus" class="fl-small" style="margin-top:8px;"></div>
      </div>

<div class="fl-card">
        <div style="font-weight:800;">👥 Plantilla</div>
        <div id="playersList" style="margin-top:8px;"></div>
      </div>
    `;

    const pPos = document.getElementById("pPos");
    ["GK","CB","LB","RB","CDM","CM","CAM","LW","RW","ST"].forEach(code=>{
      const o = document.createElement("option");
      o.value = code;
      o.textContent = POS_LABELS[code] || code;
      pPos.appendChild(o);
    });

    document.getElementById("goLineup").onclick = ()=>openLab("lineup",{teamId});
    document.getElementById("goLogger").onclick = ()=>openLab("logger",{teamId});

    const apiStatus = document.getElementById("apiFixtureStatus");
    const apiSummary = document.getElementById("apiFixtureSummary");
    function paintFixtureSummary(sourceLabel=""){
      if(!apiSummary) return;
      const cache = db?.apiCache?.fixturesByTeam?.[String(team.apiTeamId||"")];
      const fixtures = Array.isArray(cache?.fixtures) ? cache.fixtures : [];
      if(!fixtures.length){
        apiSummary.innerHTML = "";
        return;
      }
      const f = summarizeFixtureForm(fixtures, team.apiTeamId);
      apiSummary.innerHTML = `Forma API (${fixtures.length}): <b>${f.points} pts</b> • PPG <b>${fmt(f.ppg,2)}</b> • factor <b>x${fmt(f.factor,2)}</b> ${sourceLabel ? `• ${escapeHtml(sourceLabel)}` : ""}`;
    }
    paintFixtureSummary();

    document.getElementById("saveApiTeamId").onclick = ()=>{
      const raw = String(document.getElementById("apiTeamId").value||"").trim();
      team.apiTeamId = raw ? String(parseInt(raw,10)||"") : "";
      saveDB(db);
      if(apiStatus) apiStatus.textContent = "API Team ID guardado ✅";
      paintFixtureSummary();
    };

    document.getElementById("syncTeamFixtures").onclick = async ()=>{
      const raw = String(document.getElementById("apiTeamId").value||"").trim();
      const apiTeamId = String(parseInt(raw,10)||"");
      if(!apiTeamId){
        if(apiStatus) apiStatus.textContent = "Primero guarda un API Team ID válido.";
        return;
      }
      team.apiTeamId = apiTeamId;
      saveDB(db);
      if(apiStatus) apiStatus.textContent = "Sincronizando últimos 5 partidos...";
      try{
        const out = await getTeamLastFixtures(db, apiTeamId, { last:5, force:true });
        if(apiStatus) apiStatus.textContent = `Sincronizado ✅ (${out.fixtures.length} partidos, fuente: ${out.source})`;
        paintFixtureSummary(`actualizado ${new Date(out.savedAt).toLocaleString()}`);
      }catch(err){
        if(apiStatus) apiStatus.textContent = `Error API: ${String(err?.message||err)}`;
      }
    };

    document.getElementById("addPlayer").onclick = ()=>{
      const name = document.getElementById("pName").value.trim();
      const position = pPos.value;
      const rating = parseFloat(document.getElementById("pRating").value);
      if(!name || !Number.isFinite(rating)) return;
      db.players.push({
        id: uid("p"),
        teamId,
        name,
        position,
        rating: clamp(rating,0,10)
      });
      saveDB(db);
      openLab("team",{teamId});
    };


    // ---- Import JSON (FootballLab Clip) ----
    const impText = document.getElementById("fl_impText");
    const impStatus = document.getElementById("fl_impStatus");

    function setImpStatus(msg, ok=true){
      if(!impStatus) return;
      impStatus.style.color = ok ? "var(--colors-success-default, #2e7d32)" : "var(--colors-danger-default, #c62828)";
      impStatus.textContent = msg;
    }

    function monthToNumber(mon){
      const m = String(mon||"").toLowerCase().slice(0,3);
      const map = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
      return map[m] || null;
    }

    function toISODate(maybe){
      const s = String(maybe||"").trim();
      // Already ISO
      if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

      // "19 Feb" / "19 Feb 2026"
      const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s*(\d{4})?$/);
      if(m){
        const day = String(m[1]).padStart(2,"0");
        const mon = monthToNumber(m[2]);
        const year = m[3] || String(new Date().getFullYear());
        if(mon){
          return `${year}-${String(mon).padStart(2,"0")}-${day}`;
        }
      }

      // fallback: today
      const d = new Date();
      const y = d.getFullYear();
      const mo = String(d.getMonth()+1).padStart(2,"0");
      const da = String(d.getDate()).padStart(2,"0");
      return `${y}-${mo}-${da}`;
    }

    function pickClipPayload(obj){
      // Accept many shapes from FootballLab Clip: {capture}, {ok,capture}, {player/context}, {playerName,...}
      if(!obj) return null;

      // If array (queue), take first valid
      if(Array.isArray(obj)){
        for(const it of obj){
          const p = pickClipPayload(it);
          if(p) return p;
        }
        return null;
      }

      if(typeof obj !== "object") return null;

      // Maybe wrapped
      if(obj.capture) return pickClipPayload(obj.capture);
      if(obj.data && obj.data.capture) return pickClipPayload(obj.data.capture);

      // Helpers to read date/minutes/rating in multiple keys
      const ctx = obj.context || obj.ctx || obj.meta || {};
      const dateAny = (ctx.date ?? ctx.matchDate ?? ctx.dateLabel ?? obj.matchDate ?? obj.date ?? "");
      const minAny  = (ctx.minutes ?? ctx.minutesText ?? obj.minutesText ?? obj.minutes ?? "");
      const ratAny  = (ctx.rating ?? ctx.ratingText ?? obj.ratingText ?? obj.rating ?? "");

      // Player can be object OR string
      const playerObj = obj.player || {};
      const playerNameAny =
        (typeof playerObj === "string" ? playerObj :
          (playerObj.name ?? playerObj.playerName ?? obj.playerName ?? obj.name ?? "")
        );

      const teamNameAny =
        (typeof playerObj === "object" ? (playerObj.team ?? playerObj.teamName ?? "") : (obj.teamName ?? ""));

      const posAny =
        (typeof playerObj === "object" ? (playerObj.position ?? playerObj.positionText ?? "") : (obj.positionText ?? ""));

      const matchTitleAny = (ctx.matchTitle ?? obj.matchTitle ?? ctx.title ?? obj.title ?? "");
      const matchIdAny    = (ctx.matchId ?? obj.matchId ?? ctx.id ?? obj.id ?? "");

      const statsAny = (obj.stats ?? obj.statistics ?? obj.statRows ?? []);

      // Recognize only if it looks like a clip payload (has at least player and something match/stats)
      const looksLike = (String(playerNameAny||"").trim().length>0) && (String(matchTitleAny||"").trim().length>0 || statsAny);
      if(!looksLike){
        // Still allow if it has player/context but missing matchTitle (some clips)
        const maybeOk = (obj.player && (obj.context || obj.stats));
        if(!maybeOk) return null;
      }

      return {
        playerName: String(playerNameAny||""),
        teamName: String(teamNameAny||""),
        positionText: String(posAny||""),
        matchTitle: String(matchTitleAny||""),
        matchId: String(matchIdAny||""),
        matchDate: String(dateAny||""),
        minutesText: String(minAny||""),
        ratingText: String(ratAny||""),
        stats: statsAny
      };
    }

    function toNumber(x){
      const s = String(x ?? "").replace(",", ".").trim();
      const m = s.match(/-?\d+(?:\.\d+)?/);
      return m ? Number(m[0]) : 0;
    }

    function normalizeStats(stats){
      // If already an object of keys -> use directly
      if(stats && !Array.isArray(stats) && typeof stats === "object"){
        return stats;
      }
      // If array of {label,value} -> map a few common ones
      const out = {};
      const rows = Array.isArray(stats) ? stats : [];
      for(const r of rows){
        const label = String(r?.label||"").toLowerCase();
        const value = String(r?.value||"").trim();

        if(label.includes("accurate passes")){ // "28/34 (82%)"
          const m = value.match(/(\d+)\s*\/\s*(\d+)/);
          if(m){ out.passC = Number(m[1]); out.passA = Number(m[2]); }
        }
        if(label.includes("key passes")) out.keyPasses = toNumber(value);
        if(label.includes("expected goals") && !label.includes("on target")) out.xG = toNumber(value);
        if(label.includes("expected assists")) out.xA = toNumber(value);
        if(label === "goals") out.goals = toNumber(value);
        if(label === "assists") out.assists = toNumber(value);
        if(label.includes("long balls")){
          const m = value.match(/(\d+)\s*\/\s*(\d+)/);
          if(m){ out.longBallC = Number(m[1]); out.longBallA = Number(m[2]); }
        }
        if(label.includes("own half")){
          const m = value.match(/(\d+)\s*\/\s*(\d+)/);
          if(m){ out.ownHalfPassC = Number(m[1]); out.ownHalfPassA = Number(m[2]); }
        }
        if(label.includes("opposition half")){
          const m = value.match(/(\d+)\s*\/\s*(\d+)/);
          if(m){ out.oppHalfPassC = Number(m[1]); out.oppHalfPassA = Number(m[2]); }
        }
        if(label.includes("possession lost")) out.possessionLost = toNumber(value);
        if(label.includes("dribbles") && value.includes("(")) out.dribblesWon = toNumber(value); // rough
        if(label.includes("tackles") && value.includes("(")) out.defActions = toNumber(value); // rough
      }
      return out;
    }

    async function pasteClipboard(){
      try{
        const t = await navigator.clipboard.readText();
        if(impText) impText.value = t || "";
        setImpStatus(t ? "Pegado desde el portapapeles ✅" : "Portapapeles vacío.", !!t);
      }catch(e){
        setImpStatus("No se pudo leer el portapapeles. Pega manualmente.", false);
      }
    }

    function doImport(){
      try{
        const raw = (impText?.value || "").trim();
        if(!raw) return setImpStatus("Pega un JSON primero.", false);

        const obj = JSON.parse(raw);
        const payload = pickClipPayload(obj);
        if(!payload) return setImpStatus("JSON no reconocido. Debe venir de FootballLab Clip.", false);

        const playerName = String(payload.playerName||"").trim();
        if(!playerName) return setImpStatus("El JSON no trae nombre de jugador (playerName).", false);

        // Find or create player in this team
        let p = db.players.find(x => x.teamId===teamId && x.name.toLowerCase()===playerName.toLowerCase());
        const clipPosRaw = String(payload.positionText||"").trim();
        const clipPos = clipPosRaw.split("—")[0].split("-")[0].trim().toUpperCase();
        const POSCODES = ["GK","CB","LB","RB","CDM","CM","CAM","LW","RW","ST"];
        let pos = POSCODES.includes(clipPos) ? clipPos : "CM";
        if(pos==="CM"){
          for(const c of POSCODES){
            if(clipPosRaw.toUpperCase().includes(c)){ pos=c; break; }
          }
        }
        const clipRating = clamp(toNumber(payload.ratingText), 0, 10);

        if(!p){
          p = { id: uid("p"), teamId, name: playerName, position: pos, rating: (clipRating>0?clipRating:6.5) };
          db.players.push(p);
        }else{
          // Optional: update position if unknown-ish
          if(p.position==="CM" && pos!=="CM") p.position = pos;
        }

        const statsIn = normalizeStats(payload.stats);

        // Build match record with safe defaults
        const baseStats = {
          minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, losses: 0,
          shotsOn: 0, keyPasses: 0, progPasses: 0, passC: 0, passA: 0,
          dribblesWon: 0, duelsWon: 0, duelsTot: 0, defActions: 0,
          saves: 0, conceded: 0, cleanSheet: 0,
          xG: 0, xA: 0, possessionLost: 0,
          longBallC: 0, longBallA: 0,
          ownHalfPassC: 0, ownHalfPassA: 0,
          oppHalfPassC: 0, oppHalfPassA: 0,
          highClaims: 0, punches: 0
        };

        const minutes = toNumber(payload.minutesText);
        baseStats.minutes = minutes>0 ? Math.round(minutes) : 0;

        // Merge known keys
        Object.keys(baseStats).forEach(k=>{
          if(statsIn && (k in statsIn)) baseStats[k] = toNumber(statsIn[k]);
        });

        // Extra keys from normalized clip (passPct etc.) we ignore for now

        const season = db.settings.currentSeason;
        const leagueId = db.settings.currentLeagueId || (db.leagues?.[0]?.id || "lg_league");

        const dateISO = toISODate(payload.matchDate);
        const matchTitle = String(payload.matchTitle||"").trim();
        const matchId = String(payload.matchId||"").trim();

        const expected = clamp(p.rating, 0, 10);
        const newRating = (clipRating>0 ? clipRating : expected);

        db.matches.push({
          id: uid("m"),
          playerId: p.id,
          teamId: p.teamId,
          season,
          leagueId,
          date: dateISO,
          position: p.position,
          stats: baseStats,
          score: matchTitle || "",
          matchTitle: matchTitle || "",
          matchId: matchId || "",
          oldRating: expected,
          newRating:        newRating,
        clip: _clipMeta ? { meta: _clipMeta, context: _clipCtx, player: (_clip?.player||null), stats: _clipStats } : null
      });
// Optional: update player rating to clip rating if present
        if(clipRating>0) p.rating = clipRating;

        saveDB(db);
        setImpStatus(`Importado ✅ ${playerName} • ${matchTitle||"(sin título)"} • ${dateISO} • min:${baseStats.minutes} • KP:${baseStats.keyPasses} • Pass:${baseStats.passC}/${baseStats.passA}`, true);
        // refresh view
        openLab("team",{teamId});
      }catch(e){
        setImpStatus("Error importando: " + String(e?.message||e), false);
      }
    }

    document.getElementById("fl_impPaste").onclick = pasteClipboard;
    const fileBtn = document.getElementById("fl_impFile");
    const fileInput = document.getElementById("fl_impFileInput");
    if(fileBtn && fileInput){
      fileBtn.onclick = ()=>fileInput.click();
      fileInput.onchange = async ()=>{
        const f = fileInput.files && fileInput.files[0];
        if(!f) return;
        try{
          const text = await f.text();
          if(impText) impText.value = text;
          setImpStatus(`Archivo cargado ✅ ${f.name}`, true);
        }catch(e){
          setImpStatus("No pude leer el archivo JSON.", false);
        }finally{
          // allow reselect same file
          fileInput.value = "";
        }
      };
    }

    document.getElementById("fl_impRun").onclick = doImport;
    document.getElementById("fl_impClear").onclick = ()=>{
      if(impText) impText.value = "";
      setImpStatus("Listo. Pega un JSON cuando quieras.");
    };
    setImpStatus("Listo. Pega un JSON cuando quieras.");
    // ---- /Import JSON ----


    const list = document.getElementById("playersList");
    if(players.length===0){
      list.innerHTML = `<div class="fl-small" style="opacity:.75;">Sin jugadores aún. Agrega el primero arriba 👆</div>`;
      return;
    }

    // Show effective rating preview using current season form
    const rows = players.map(p=>{
      const eff = getEffectiveRating(db, p.id);
      const form = getFormScore(db, p.id);
      return `
        <div class="fl-card" style="margin:8px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div>
              <div style="font-weight:850;">${escapeHtml(p.name)} <span class="fl-pill">${escapeHtml(POS_LABELS[p.position]||p.position)}</span></div>
              <div class="fl-small">
                Base: <b>${fmt(p.rating,2)}</b> • Forma(${db.settings.currentSeason}): <b>${fmt(form,2)}</b> • Efectivo: <b>${fmt(eff,2)}</b>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
              <button class="mc-btn" data-profile="${p.id}">Perfil</button>
              <button class="mc-btn" data-edit="${p.id}">Editar</button>
              <button class="mc-btn" data-del="${p.id}">Eliminar</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    list.innerHTML = rows;

    list.querySelectorAll("[data-del]").forEach(b=>b.onclick = ()=>{
      const pid = b.getAttribute("data-del");
      if(!confirm("¿Eliminar jugador?")) return;
      db.players = db.players.filter(pp=>pp.id!==pid);
      // Keep match logs (study). optionally prune:
      // db.matches = db.matches.filter(m=>m.playerId!==pid);
      saveDB(db);
      openLab("team",{teamId});
    });

    list.querySelectorAll("[data-profile]").forEach(b=>b.onclick = ()=>{
      const pid = b.getAttribute("data-profile");
      openLab("player",{playerId: pid});
    });

    list.querySelectorAll("[data-edit]").forEach(b=>b.onclick = ()=>{
      const pid = b.getAttribute("data-edit");
      const p = db.players.find(pp=>pp.id===pid);
      if(!p) return;
      const newName = prompt("Nombre", p.name);
      if(newName===null) return;
      const newRating = prompt("Rating base (0–10)", String(p.rating));
      if(newRating===null) return;
      p.name = newName.trim() || p.name;
      const r = parseFloat(newRating);
      if(Number.isFinite(r)) p.rating = clamp(r,0,10);
      saveDB(db);
      openLab("team",{teamId});
    });
  }

  
  // ---- Player Profile (V6) ----
  function renderPlayer(db, playerId){
    const p = db.players.find(pp=>pp.id===playerId);
    const v = document.getElementById("fl_view");
    if(!p){
      v.innerHTML = `<div class="fl-card">Jugador no encontrado.</div>`;
      return;
    }
    const team = db.teams.find(t=>t.id===p.teamId);
    const season = db.settings.currentSeason;
    const leagueId = db.settings.currentLeagueId;
    const league = (db.leagues||[]).find(l=>l.id===leagueId);

    // logs for current season
    const logs = db.matches
      .filter(m=>m.playerId===playerId && m.season===season && (m.leagueId||db.settings.currentLeagueId)===leagueId)
      .sort((a,b)=> (b.date||"").localeCompare(a.date||""));

    const eff = getEffectiveRating(db, playerId);
    const form = getFormScore(db, playerId);

    // Aggregate season stats (simple sums + per90)
    const agg = aggregateSeason(logs);

    v.innerHTML = `
      <div class="fl-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:900;font-size:16px;">👤 ${escapeHtml(p.name)}</div>
            <div class="fl-small">${escapeHtml(team?.name||"Sin equipo")} • <b>${escapeHtml(POS_LABELS[p.position]||p.position)}</b> • ${escapeHtml(league?.name||"Liga")} • Temporada: <b>${escapeHtml(season)}</b></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="mc-btn" id="backTeam">Volver al equipo</button>
            <button class="mc-btn" id="openLogger">Registrar partido</button>
          </div>
        </div>
      </div>

      <div class="fl-grid2">
        <div class="fl-card">
          <div style="font-weight:850;">📈 Rendimiento actual</div>
          <div class="fl-small" style="margin-top:8px;">
            Rating base: <b>${fmt(p.rating,2)}</b><br/>
            Forma (últimos ${db.settings.formLastN}): <b>${Number.isFinite(form)?fmt(form,2):"—"}</b><br/>
            Rating efectivo (para simular): <b>${fmt(eff,2)}</b>
          </div>
          <div class="fl-small" style="margin-top:10px;opacity:.85;">
            El rating efectivo sale de sus juegos pasados de la <b>temporada actual</b>. Si no hay registros, usa el rating base.
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:850;">📊 Resumen temporada (acumulado)</div>
          <div class="fl-small" style="margin-top:8px;">
            Partidos: <b>${agg.matches}</b> • Minutos: <b>${agg.minutes}</b><br/>
            Goles: <b>${agg.goals}</b> • Asistencias: <b>${agg.assists}</b><br/>
            Tiros a puerta: <b>${agg.shotsOn}</b> • Key passes: <b>${agg.keyPasses}</b><br/>
            Pases: <b>${agg.passC}</b>/<b>${agg.passA}</b> (${fmt(agg.passPct*100,1)}%)<br/>
            Pases progresivos: <b>${agg.progPasses}</b> • Regates: <b>${agg.dribblesWon}</b><br/>
            Duelos: <b>${agg.duelsWon}</b>/<b>${agg.duelsTot}</b> (${fmt(agg.duelPct*100,1)}%)<br/>
            Acciones defensivas: <b>${agg.defActions}</b><br/>
            Pérdidas de posesión: <b>${agg.possessionLost}</b><br/>
            Pases largos: <b>${agg.longBallC}</b>/<b>${agg.longBallA}</b>
          </div>
          <div class="fl-small" style="margin-top:10px;">
            <b>Por 90 (aprox):</b> G ${fmt(agg.per90.goals,2)} • A ${fmt(agg.per90.assists,2)} • KP ${fmt(agg.per90.keyPasses,2)} • ProgP ${fmt(agg.per90.progPasses,2)}
          </div>
        </div>
      </div>

      <div class="fl-card">
        <div style="font-weight:850;">🧾 Últimos partidos (temporada actual)</div>
        <div id="lastMatches" class="fl-small" style="margin-top:8px;"></div>
      </div>

      <div class="fl-card">
        <div style="font-weight:850;">➕ Registrar un partido aquí mismo</div>
        <div class="fl-small" style="margin-top:6px;">Rellena lo esencial y guarda. Mientras más registres, mejor se vuelve el “rendimiento actual”.</div>

        <div class="fl-row" style="margin-top:10px;">
          <div>
            <div class="fl-h3">Fecha</div>
            <input class="fl-input" id="pl_date" type="date">
          </div>
          <div>
            <div class="fl-h3">Minutos</div>
            <input class="fl-input" id="pl_minutes" type="number" min="0" max="120" step="1" value="90">
          </div>
          <div>
            <div class="fl-h3">Goles</div>
            <input class="fl-input" id="pl_goals" type="number" min="0" step="1" value="0">
          </div>
          <div>
            <div class="fl-h3">Asist.</div>
            <input class="fl-input" id="pl_assists" type="number" min="0" step="1" value="0">
          </div>
        </div>

        <details style="margin-top:10px;">
          <summary style="cursor:pointer;">+ Stats (tipo Sofascore)</summary>
          <div class="fl-grid2" style="margin-top:10px;">
            <div class="fl-card" style="margin:0;">
              <div class="fl-small"><b>Pases</b></div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_passC" type="number" min="0" step="1" placeholder="Pases completados">
                <input class="fl-input" id="pl_passA" type="number" min="0" step="1" placeholder="Pases intentados">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_keyPasses" type="number" min="0" step="1" placeholder="Key passes">
                <input class="fl-input" id="pl_progPasses" type="number" min="0" step="1" placeholder="Pases progresivos">
              </div>
            </div>

            <div class="fl-card" style="margin:0;">
              <div class="fl-small"><b>Duelo/Regate/Defensa</b></div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_duelsWon" type="number" min="0" step="1" placeholder="Duelos ganados">
                <input class="fl-input" id="pl_duelsTot" type="number" min="0" step="1" placeholder="Duelos totales">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_dribblesWon" type="number" min="0" step="1" placeholder="Regates buenos">
                <input class="fl-input" id="pl_defActions" type="number" min="0" step="1" placeholder="Acciones defensivas">
              </div>
            </div>
          </div>

          <div class="fl-grid2" style="margin-top:10px;">
            <div class="fl-card" style="margin:0;">
              <div class="fl-small"><b>Tiro/Disciplina</b></div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_shotsOn" type="number" min="0" step="1" placeholder="Tiros a puerta">
                <input class="fl-input" id="pl_posLost" type="number" min="0" step="1" placeholder="Pérdidas de posesión">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_xG" type="number" min="0" step="0.01" placeholder="Goles esperados (xG)">
                <input class="fl-input" id="pl_xA" type="number" min="0" step="0.01" placeholder="Asistencias esperadas (xA)">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_yellow" type="number" min="0" step="1" placeholder="Amarillas">
                <input class="fl-input" id="pl_red" type="number" min="0" step="1" placeholder="Rojas">
              </div>
            </div>

            <div class="fl-card" style="margin:0;">
              <div class="fl-small"><b>Portero (si aplica)</b></div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_saves" type="number" min="0" step="1" placeholder="Atajadas">
                <input class="fl-input" id="pl_conceded" type="number" min="0" step="1" placeholder="Goles concedidos">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_cleanSheet" type="number" min="0" max="1" step="1" placeholder="Portería a cero 0/1">
                <input class="fl-input" id="pl_highClaims" type="number" min="0" step="1" placeholder="Salidas altas (High claims)">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_punches" type="number" min="0" step="1" placeholder="Despejes de puños (Punches)">
                <input class="fl-input" id="pl_longBallC" type="number" min="0" step="1" placeholder="Pases largos acertados">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_longBallA" type="number" min="0" step="1" placeholder="Pases largos intentados">
                <input class="fl-input" id="pl_ownHalfC" type="number" min="0" step="1" placeholder="Pases en campo propio (acertados)">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_ownHalfA" type="number" min="0" step="1" placeholder="Pases en campo propio (intentados)">
                <input class="fl-input" id="pl_oppHalfC" type="number" min="0" step="1" placeholder="Pases en campo rival (acertados)">
              </div>
              <div class="fl-row" style="margin-top:8px;">
                <input class="fl-input" id="pl_oppHalfA" type="number" min="0" step="1" placeholder="Pases en campo rival (intentados)">
              </div>
            </div>
          </div>
        </details>

        
        <details style="margin-top:12px;">
          <summary style="cursor:pointer;">📥 Pegar JSON (FootballLab Clip)</summary>
          <div class="fl-small" style="margin-top:6px; opacity:.85;">
            Copia el JSON desde la extensión y pégalo aquí. Se llenará el formulario automáticamente.
          </div>
          <textarea id="pl_json" class="fl-input" style="margin-top:8px; min-height:120px; width:100%; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" placeholder='{"player":...,"match":...,"stats":...}'></textarea>
          <div class="fl-row" style="margin-top:8px; align-items:center;">
            <button class="mc-btn" id="pl_applyJson">Aplicar al formulario</button>
            <button class="mc-btn" id="pl_clearJson">Limpiar</button>
            <div id="pl_jsonInfo" class="fl-small"></div>
          </div>
        </details>

<div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="pl_saveMatch">Guardar partido</button>
          <div id="pl_savedInfo" class="fl-small"></div>
        </div>
      </div>
    `;

    // set date default
    const iso = new Date().toISOString().slice(0,10);
    document.getElementById("pl_date").value = iso;

    
    // JSON import (FootballLab Clip)
    const $json = document.getElementById("pl_json");
    const $info = document.getElementById("pl_jsonInfo");

    function parseJsonSafe(s){
      try { return { ok:true, data: JSON.parse(s) }; }
      catch(e){ return { ok:false, error: e?.message || String(e) }; }
    }

    function num(v, d=0){
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    }

    function setVal(id, v){
      const el = document.getElementById(id);
      if(!el) return;
      el.value = (v===null || v===undefined) ? "" : String(v);
    }

    function ymdFromAny(v){
      if(!v) return null;
      // Already YYYY-MM-DD
      if(/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
      // "19 Feb" etc not reliable
      const d = new Date(v);
      if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
      return null;
    }

    function applyCaptureToForm(capture){
      const match = capture?.match || {};
      const stats = capture?.stats || {};
      const passing = stats.passing || stats.passes || {};
      const duels = stats.duels || {};
      const dribbles = stats.dribbles || {};
      const defense = stats.defense || {};

      // basics
      setVal("pl_minutes", num(stats.minutesPlayed ?? match.minutesPlayed ?? stats.minutes ?? match.minutes, 0));
      setVal("pl_goals", num(stats.goals ?? 0, 0));
      setVal("pl_assists", num(stats.assists ?? 0, 0));

      const dateGuess = ymdFromAny(match.date) || ymdFromAny(match.startTime) || ymdFromAny(match.kickoff) || null;
      if(dateGuess) setVal("pl_date", dateGuess);

      // passing
      setVal("pl_passC", num(passing.accurate ?? stats.accuratePasses ?? 0, 0));
      setVal("pl_passA", num(passing.total ?? stats.totalPasses ?? 0, 0));
      setVal("pl_keyPasses", num(passing.keyPasses ?? stats.keyPasses ?? 0, 0));
      setVal("pl_progPasses", num(passing.progressivePasses ?? stats.progressivePasses ?? 0, 0));

      setVal("pl_longBallC", num(passing.longBallsAccurate ?? stats.longBallsAccurate ?? 0, 0));
      setVal("pl_longBallA", num(passing.longBallsTotal ?? stats.longBallsTotal ?? 0, 0));

      setVal("pl_oppHalfC", num(passing.oppHalfAccurate ?? stats.oppHalfAccurate ?? 0, 0));
      setVal("pl_oppHalfA", num(passing.oppHalfTotal ?? stats.oppHalfTotal ?? 0, 0));
      setVal("pl_ownHalfC", num(passing.ownHalfAccurate ?? stats.ownHalfAccurate ?? 0, 0));
      setVal("pl_ownHalfA", num(passing.ownHalfTotal ?? stats.ownHalfTotal ?? 0, 0));

      // duels / dribbles / defense
      setVal("pl_duelsWon", num(duels.won ?? stats.duelsWon ?? 0, 0));
      setVal("pl_duelsTot", num(duels.total ?? stats.duelsTotal ?? 0, 0));
      setVal("pl_dribblesWon", num(dribbles.successful ?? stats.dribblesSuccessful ?? stats.dribblesWon ?? 0, 0));
      setVal("pl_defActions", num(defense.actions ?? stats.defActions ?? stats.defensiveActions ?? 0, 0));
      setVal("pl_posLost", num(stats.possessionLost ?? stats.posLost ?? 0, 0));

      // shooting/creative
      setVal("pl_shotsOn", num(stats.shotsOnTarget ?? stats.shotsOn ?? 0, 0));
      setVal("pl_xG", num(stats.xg ?? stats.xG ?? 0, 0));
      setVal("pl_xA", num(stats.xa ?? stats.xA ?? 0, 0));

      // goalkeeper (if present in json)
      setVal("pl_saves", num(stats.saves ?? 0, 0));
      setVal("pl_conceded", num(stats.goalsConceded ?? stats.conceded ?? 0, 0));
      setVal("pl_cleanSheet", num(stats.cleanSheet ?? 0, 0));
      setVal("pl_punches", num(stats.punches ?? 0, 0));
      setVal("pl_highClaims", num(stats.highClaims ?? 0, 0));

      // feedback
      if($info){
        const title = match.title || match.name || "";
        $info.textContent = "Cargado ✅" + (title ? " ("+title+")" : "");
      }
    }

    document.getElementById("pl_applyJson")?.addEventListener("click", ()=>{
      const raw = ($json?.value || "").trim();
      if(!raw){ if($info) $info.textContent="Pega un JSON primero."; return; }
      const parsed = parseJsonSafe(raw);
      if(!parsed.ok){ if($info) $info.textContent="JSON inválido: " + parsed.error; return; }
      applyCaptureToForm(parsed.data);
    });

    document.getElementById("pl_clearJson")?.addEventListener("click", ()=>{
      if($json) $json.value = "";
      if($info) $info.textContent = "";
    });

const _bt = document.getElementById("backTeam");
    if(_bt) _bt.onclick = ()=> openLab("team",{teamId:p.teamId});
const _ol = document.getElementById("openLogger");
    if(_ol) _ol.onclick = ()=> openLab("logger",{teamId:p.teamId});// last matches view
    const last = (Array.isArray(logs) ? logs : []).slice(0, 8);
    const _lm = document.getElementById("lastMatches");
    if(_lm) _lm.innerHTML = last.map(m=>{
      const mid = escapeHtml(m.id||"");
      const date = escapeHtml(m.date||"");
      const score = fmt(m.score,2);
      const min = (m.stats?.minutes ?? 0);
      const g = (m.stats?.goals ?? 0);
      const a = (m.stats?.assists ?? 0);
      return `
        <div class="fl-row" style="align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.06);">
          <div class="fl-small" style="flex:1; min-width:0;">
            • ${date} — score <b>${score}</b> • min ${min} • G ${g} • A ${a}
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button class="mc-btn" data-editmatch="${mid}" style="padding:6px 10px;">Editar</button>
            <button class="mc-btn" data-delmatch="${mid}" style="padding:6px 10px; opacity:.9;">Eliminar</button>
          </div>
        </div>
      `;
    }).join("") || `<span style="opacity:.75;">Aún no hay partidos registrados en esta temporada.</span>`;

    // wire edit/delete for last matches
    document.querySelectorAll("[data-editmatch]").forEach(btn=>{
      btn.onclick = ()=>{
        const mid = btn.getAttribute("data-editmatch");
        openEditMatchModal(db, p.id, mid);
      };
    });

    document.querySelectorAll("[data-delmatch]").forEach(btn=>{
      btn.onclick = ()=>{
        const mid = btn.getAttribute("data-delmatch");
        const mm = db.matches.find(x=>x.id===mid);
        if(!mm) return;
        const ok = confirm(`Eliminar este partido?
${mm.date} • score ${fmt(mm.score,2)}`);
        if(!ok) return;
        db.matches = db.matches.filter(x=>x.id!==mid);
        saveDB(db);
        openLab("player",{playerId: p.id});
      };
    });

    // Save match inline
    document.getElementById("pl_saveMatch").onclick = ()=>{
      const num = (id)=>{ const el = document.getElementById(id); return el ? (parseFloat(el.value)||0) : 0; };

      const date = document.getElementById("pl_date").value || iso;
      const minutes = num("pl_minutes");
      const goals = num("pl_goals");
      const assists = num("pl_assists");

      const passC = num("pl_passC");
      const passA = Math.max(1, num("pl_passA"));
      const keyPasses = num("pl_keyPasses");
      const progPasses = num("pl_progPasses");

      const duelsWon = num("pl_duelsWon");
      const duelsTot = Math.max(1, num("pl_duelsTot"));
      const dribblesWon = num("pl_dribblesWon");
      const defActions = num("pl_defActions");

      const shotsOn = num("pl_shotsOn");
      const losses = num("pl_posLost");
      const yellow = num("pl_yellow");
      const red = num("pl_red");

      const saves = num("pl_saves");
      const conceded = num("pl_conceded");
      const cleanSheet = num("pl_cleanSheet");

      const xG = parseFloat(document.getElementById("pl_xG")?.value) || 0;
      const xA = parseFloat(document.getElementById("pl_xA")?.value) || 0;
      const possessionLost = num("pl_posLost");

      const longBallC = num("pl_longBallC");
      const longBallA = Math.max(1, num("pl_longBallA"));
      const ownHalfPassC = num("pl_ownHalfC");
      const ownHalfPassA = Math.max(1, num("pl_ownHalfA"));
      const oppHalfPassC = num("pl_oppHalfC");
      const oppHalfPassA = Math.max(1, num("pl_oppHalfA"));

      const highClaims = num("pl_highClaims");
      const punches = num("pl_punches");




      // --- Preserve SofaScore clip JSON (if provided) ---
      let _clip = null;
      let _clipStats = null;
      let _clipCtx = null;
      let _clipMeta = null;
      try{
        const rawClip = (document.getElementById("pl_json")?.value || "").trim();
        if(rawClip){
          _clip = JSON.parse(rawClip);
          _clipStats = _clip?.stats || null;
          _clipCtx = _clip?.context || _clip?.match || null;
          _clipMeta = {
            schemaVersion: _clip?.schemaVersion || null,
            source: _clip?.source || null,
            capturedAt: _clip?.capturedAt || null,
            matchId: _clipCtx?.matchId || _clipCtx?.id || null,
            matchTitle: _clipCtx?.matchTitle || _clipCtx?.title || _clipCtx?.name || null,
            rating: (_clipCtx?.rating ?? null)
          };
          const clipDate = (_clipCtx?.date && /^\d{4}-\d{2}-\d{2}/.test(String(_clipCtx.date)))
            ? String(_clipCtx.date).slice(0,10)
            : null;
          if(!document.getElementById("pl_date")?.value && clipDate){
            document.getElementById("pl_date").value = clipDate;
          }
        }
      }catch(e){
        // ignore invalid json on save
      }

      const score = computeMatchScore(db, p.position, {
        minutes, goals, assists, yellow, red, losses,
        shotsOn, keyPasses, progPasses, passC, passA,
        dribblesWon, duelsWon, duelsTot, defActions,
        saves, conceded, cleanSheet,
        xG, xA, possessionLost,
        longBallC, longBallA,
        ownHalfPassC, ownHalfPassA,
        oppHalfPassC, oppHalfPassA,
        highClaims, punches,
          // extra SofaScore fields (kept even if UI has no inputs)
          touches: clipNum(_clipStats?.touches, 0),
          crosses: clipNum(_clipStats?.crosses, 0),
          crossesGood: clipNum(_clipStats?.crossesGood, 0),
          passPct: (_clipStats?.passPct ?? null),
          longBallPct: (_clipStats?.longBallPct ?? null),
          dribbles: clipNum(_clipStats?.dribbles, 0),
          dribblesGood: clipNum(_clipStats?.dribblesGood, 0),
          tackles: clipNum(_clipStats?.tackles, 0),
          tacklesGood: clipNum(_clipStats?.tacklesGood, 0),
          interceptions: clipNum(_clipStats?.interceptions, 0),
          clearances: clipNum(_clipStats?.clearances, 0),
          recoveries: clipNum(_clipStats?.recoveries, 0),
          groundDuels: clipNum(_clipStats?.groundDuels, 0),
          groundDuelsGood: clipNum(_clipStats?.groundDuelsGood, 0)
        });

      // Elo-style update (performance vs expected), scaled by minutes
      const expected = p.rating;
      const upd = updateEloRating(expected, score, minutes, 0.20);
      const newRating = upd.newRating;


      function clipNum(v, d=0){
        const n = Number(v);
        return Number.isFinite(n) ? n : d;
      }

      // append log
      db.matches.push({
        id: uid("m"),
        playerId: p.id,
        teamId: p.teamId,
        season: season,
        leagueId: (document.getElementById("ml_league")?.value || leagueId),
        date,
        position: p.position,
        stats: {
          minutes, goals, assists, yellow, red, losses,
          shotsOn, keyPasses, progPasses, passC, passA,
          dribblesWon, duelsWon, duelsTot, defActions,
          saves, conceded, cleanSheet,
          xG, xA, possessionLost,
          longBallC, longBallA,
          ownHalfPassC, ownHalfPassA,
          oppHalfPassC, oppHalfPassA,
          highClaims, punches
        },
        score,
        oldRating: expected,
        newRating
      });

      // update player base
      p.rating = newRating;
      saveDB(db);

      document.getElementById("pl_savedInfo").innerHTML =
        `Guardado ✅ score <b>${fmt(score,2)}</b> • base ${fmt(newRating,2)} • efectivo ${fmt(getEffectiveRating(db,p.id),2)}`;

      // refresh profile to recalc aggregates
      openLab("player",{playerId: p.id});
    };
  }

  function aggregateSeason(logs){
    const agg = {
      matches: logs.length,
      minutes: 0,
      goals: 0,
      assists: 0,
      shotsOn: 0,
      keyPasses: 0,
      progPasses: 0,
      passC: 0,
      passA: 0,
      dribblesWon: 0,
      duelsWon: 0,
      duelsTot: 0,
      defActions: 0,
      possessionLost: 0,
      longBallC: 0,
      longBallA: 0,
      highClaims: 0,
      punches: 0,
      passPct: 0,
      duelPct: 0,
      per90: {goals:0, assists:0, keyPasses:0, progPasses:0}
    };

    logs.forEach(m=>{
      const s = m.stats || {};
      agg.minutes += (s.minutes||0);
      agg.goals += (s.goals||0);
      agg.assists += (s.assists||0);
      agg.shotsOn += (s.shotsOn||0);
      agg.keyPasses += (s.keyPasses||0);
      agg.progPasses += (s.progPasses||0);
      agg.passC += (s.passC||0);
      agg.passA += (s.passA||0);
      agg.dribblesWon += (s.dribblesWon||0);
      agg.duelsWon += (s.duelsWon||0);
      agg.duelsTot += (s.duelsTot||0);
      agg.defActions += (s.defActions||0);
      agg.possessionLost += (s.possessionLost||0);
      agg.longBallC += (s.longBallC||0);
      agg.longBallA += (s.longBallA||0);
      agg.highClaims += (s.highClaims||0);
      agg.punches += (s.punches||0);
    });

    agg.passPct = agg.passC / Math.max(1, agg.passA);
    agg.duelPct = agg.duelsWon / Math.max(1, agg.duelsTot);

    const m90 = agg.minutes / 90;
    if(m90 > 0){
      agg.per90.goals = agg.goals / m90;
      agg.per90.assists = agg.assists / m90;
      agg.per90.keyPasses = agg.keyPasses / m90;
      agg.per90.progPasses = agg.progPasses / m90;
    }
    return agg;
  }

// ---- XI Builder ----
  function renderLineup(db, teamId){
    const team = db.teams.find(t=>t.id===teamId);
    const v = document.getElementById("fl_view");
    if(!team){ v.innerHTML = `<div class="fl-card">Equipo no encontrado.</div>`; return; }

    const players = db.players.filter(p=>p.teamId===teamId);

    if(!db.lineups[teamId]) db.lineups[teamId] = {};
    const lineupStore = db.lineups[teamId];

    v.innerHTML = `
      <div class="fl-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:900;">XI Builder — ${escapeHtml(team.name)}</div>
            <div class="fl-small">Elige la formación y asigna tus 11 titulares.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="mc-btn" id="goTeam">Volver al equipo</button>
            <button class="mc-btn" id="goLogger">Match Logger</button>
          </div>
        </div>
      </div>

      <div class="fl-card">
        <div class="fl-row">
          <div>
            <div class="fl-h3">Formación</div>
            <select class="fl-select" id="formation"></select>
          </div>
          <div>
            <div class="fl-h3">Tip</div>
            <div class="fl-small">LM/RM se tratan como extremos (LW/RW) para fuerza.</div>
          </div>
        </div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">Asignación de posiciones</div>
        <div id="slots" style="margin-top:10px;"></div>
        <div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="saveLineup">Guardar XI</button>
          <button class="mc-btn" id="autoFill">Auto-llenar (por posición)</button>
        </div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">Vista rápida de fuerza (XI)</div>
        <div id="strengthPreview" class="fl-small" style="margin-top:8px;"></div>
      </div>
    `;

    document.getElementById("goTeam").onclick = ()=>openLab("team",{teamId});
    document.getElementById("goLogger").onclick = ()=>openLab("logger",{teamId});

    const formationSel = document.getElementById("formation");
    Object.keys(FORMATIONS).forEach(f=>{
      const o = document.createElement("option");
      o.value = f;
      o.textContent = (f==="433"?"4-3-3":f==="442"?"4-4-2":"3-4-3");
      formationSel.appendChild(o);
    });
    // Custom 4-line editable formation
    {
      const o = document.createElement("option");
      o.value = "custom4";
      o.textContent = "Custom (4 líneas)";
      formationSel.appendChild(o);
    }


    function buildSlots(){
      const f = formationSel.value;

      // ---- Custom 4-line formation (editable) ----
      if(f === "custom4"){
        if(!lineupStore[f]){
          lineupStore[f] = {
            defN: 4, midN: 3, attN: 3,
            gk: "",
            def: Array(4).fill(""),
            mid: Array(3).fill(""),
            att: Array(3).fill(""),
            defRoles: ["LB","CB","CB","RB"],
            midRoles: ["CDM","CM","CAM"],
            attRoles: ["LW","ST","RW"]
          };
        }
        const saved = lineupStore[f];

        // normalize lengths
        function ensureLen(arr, n){ 
          const a = Array.isArray(arr) ? arr.slice(0,n) : [];
          while(a.length < n) a.push("");
          return a;
        }
        function ensureRoles(arr, n, defRole){
          const a = Array.isArray(arr) ? arr.slice(0,n) : [];
          while(a.length < n) a.push(defRole);
          return a;
        }

        const wrap = document.getElementById("slots");
        wrap.innerHTML = `
          <div class="fl-card" style="margin:0 0 10px 0;">
            <div style="font-weight:800;">Formación editable (4 líneas)</div>
            <div class="fl-small" style="margin-top:6px;">Ajusta la cantidad por línea. Total (DEF+MID+ATT) debe ser 10.</div>
            <div class="fl-row" style="margin-top:10px; flex-wrap:wrap; gap:10px;">
              <div style="min-width:120px;">
                <div class="fl-h3">DEF</div>
                <input class="fl-input" id="c4_defN" type="number" min="3" max="6" step="1" value="${saved.defN}">
              </div>
              <div style="min-width:120px;">
                <div class="fl-h3">MID</div>
                <input class="fl-input" id="c4_midN" type="number" min="2" max="6" step="1" value="${saved.midN}">
              </div>
              <div style="min-width:120px;">
                <div class="fl-h3">ATT</div>
                <input class="fl-input" id="c4_attN" type="number" min="1" max="4" step="1" value="${saved.attN}">
              </div>
              <div style="flex:1 1 auto;">
                <div class="fl-h3">Total</div>
                <div id="c4_total" class="fl-small" style="margin-top:10px;font-weight:800;"></div>
              </div>
            </div>
          </div>

          ${renderLineSection("GK","🧤 Portero", 1)}
          ${renderLineSection("DEF","🛡 Defensas", saved.defN)}
          ${renderLineSection("MID","⚙️ Medios", saved.midN)}
          ${renderLineSection("ATT","🔥 Ataque", saved.attN)}
        `;

        function renderLineSection(key, title, n){
          const rows = [];
          for(let i=0;i<n;i++){
            const idRole = `c4_${key}_role_${i}`;
            const idSel  = `c4_${key}_pid_${i}`;
            const showRole = (key!=="GK");
            rows.push(`
              <div class="fl-row" style="margin-top:8px;flex-wrap:wrap;gap:10px;align-items:flex-end;">
                <div style="min-width:220px;">
                  <div style="font-weight:800;">${title} ${key==="GK"?"":`#${i+1}`}</div>
                </div>
                ${showRole ? `
                  <div style="min-width:180px;">
                    <div class="fl-h3">Rol</div>
                    <select class="fl-select" id="${idRole}"></select>
                  </div>` : ``}
                <div style="flex:1 1 260px;">
                  <div class="fl-h3">Jugador</div>
                  <select class="fl-select" id="${idSel}"></select>
                </div>
              </div>
            `);
          }
          return `
            <div class="fl-card" style="margin:10px 0;">
              <div style="font-weight:800;">${title}</div>
              ${rows.join("")}
            </div>
          `;
        }

        // wire counts
        const defNEl = document.getElementById("c4_defN");
        const midNEl = document.getElementById("c4_midN");
        const attNEl = document.getElementById("c4_attN");
        const totalEl = document.getElementById("c4_total");

        function refreshTotal(){
          const defN = clamp(parseInt(defNEl.value||"4",10), 3, 6);
          const midN = clamp(parseInt(midNEl.value||"3",10), 2, 6);
          const attN = clamp(parseInt(attNEl.value||"3",10), 1, 4);
          const total = defN + midN + attN;
          totalEl.innerHTML = `DEF ${defN} + MID ${midN} + ATT ${attN} = <b>${total}</b> (debe ser 10)`;
          totalEl.style.color = (total===10) ? "" : "var(--danger, #ff6b6b)";
          return {defN, midN, attN, total};
        }

        function applyCounts(){
          const {defN, midN, attN, total} = refreshTotal();
          // keep whatever user set, but warn if not 10
          saved.defN = defN; saved.midN = midN; saved.attN = attN;
          saved.def = ensureLen(saved.def, defN);
          saved.mid = ensureLen(saved.mid, midN);
          saved.att = ensureLen(saved.att, attN);
          saved.defRoles = ensureRoles(saved.defRoles, defN, "CB");
          saved.midRoles = ensureRoles(saved.midRoles, midN, "CM");
          saved.attRoles = ensureRoles(saved.attRoles, attN, "ST");
          lineupStore[f] = saved;
          // rebuild UI with new counts
          buildSlots();
        }

        defNEl.onchange = applyCounts;
        midNEl.onchange = applyCounts;
        attNEl.onchange = applyCounts;

        refreshTotal();

        // fill player pools once
        const byId = new Map(players.map(p=>[p.id,p]));
        function fillPlayerSelect(sel, pickedId){
          sel.innerHTML = `<option value="">(vacío)</option>`;
          players
            .slice()
            .sort((a,b)=>getEffectiveRating(db,b.id)-getEffectiveRating(db,a.id))
            .forEach(p=>{
              const eff = getEffectiveRating(db, p.id);
              const o = document.createElement("option");
              o.value = p.id;
              o.textContent = `${p.name} • ${p.position} • base ${fmt(p.rating,1)} • eff ${fmt(eff,1)}`;
              sel.appendChild(o);
            });
          if(pickedId) sel.value = pickedId;
        }

        function fillRoleSelect(sel, options, picked){
          sel.innerHTML = "";
          options.forEach(code=>{
            const o = document.createElement("option");
            o.value = code;
            o.textContent = POS_LABELS[code] || code;
            sel.appendChild(o);
          });
          if(picked && options.includes(picked)) sel.value = picked;
        }

        // GK
        {
          const sel = document.getElementById("c4_GK_pid_0");
          fillPlayerSelect(sel, saved.gk);
          sel.onchange = ()=>{ saved.gk = sel.value||""; previewStrength(); };
        }

        const DEF_ROLE_OPTS = ["LB","CB","RB"];
        const MID_ROLE_OPTS = ["CDM","CM","CAM"];
        const ATT_ROLE_OPTS = ["LW","ST","RW"];

        // DEF
        for(let i=0;i<saved.defN;i++){
          const selRole = document.getElementById(`c4_DEF_role_${i}`);
          const selPid  = document.getElementById(`c4_DEF_pid_${i}`);
          fillRoleSelect(selRole, DEF_ROLE_OPTS, saved.defRoles[i]||"CB");
          fillPlayerSelect(selPid, saved.def[i]||"");
          selRole.onchange = ()=>{ saved.defRoles[i]=selRole.value; previewStrength(); };
          selPid.onchange  = ()=>{ saved.def[i]=selPid.value||""; previewStrength(); };
        }
        // MID
        for(let i=0;i<saved.midN;i++){
          const selRole = document.getElementById(`c4_MID_role_${i}`);
          const selPid  = document.getElementById(`c4_MID_pid_${i}`);
          fillRoleSelect(selRole, MID_ROLE_OPTS, saved.midRoles[i]||"CM");
          fillPlayerSelect(selPid, saved.mid[i]||"");
          selRole.onchange = ()=>{ saved.midRoles[i]=selRole.value; previewStrength(); };
          selPid.onchange  = ()=>{ saved.mid[i]=selPid.value||""; previewStrength(); };
        }
        // ATT
        for(let i=0;i<saved.attN;i++){
          const selRole = document.getElementById(`c4_ATT_role_${i}`);
          const selPid  = document.getElementById(`c4_ATT_pid_${i}`);
          fillRoleSelect(selRole, ATT_ROLE_OPTS, saved.attRoles[i]||"ST");
          fillPlayerSelect(selPid, saved.att[i]||"");
          selRole.onchange = ()=>{ saved.attRoles[i]=selRole.value; previewStrength(); };
          selPid.onchange  = ()=>{ saved.att[i]=selPid.value||""; previewStrength(); };
        }

        previewStrength();
        return;
      }

      // ---- Preset formations ----
      const slots = FORMATIONS[f] || FORMATIONS["433"];

      if(!lineupStore[f]) lineupStore[f] = {};
      const saved = lineupStore[f];

      const wrap = document.getElementById("slots");
      wrap.innerHTML = slots.map((pos, idx)=>{
        const npos = normalizePos(pos);
        const label = POS_LABELS[npos] || `${npos}`;
        const selId = `slot_${idx}`;
        return `
          <div class="fl-card" style="margin:8px 0;">
            <div class="fl-row">
              <div style="min-width:220px;">
                <div style="font-weight:800;">${escapeHtml(label)}</div>
                <div class="fl-small">Slot ${idx+1}</div>
              </div>
              <div style="flex:2 1 auto;">
                <select class="fl-select" id="${selId}" data-pos="${npos}"></select>
              </div>
            </div>
          </div>
        `;
      }).join("");

      // fill selects
      slots.forEach((pos, idx)=>{
        const npos = normalizePos(pos);
        const sel = document.getElementById(`slot_${idx}`);
        sel.innerHTML = `<option value="">(vacío)</option>`;
        players.forEach(p=>{
          const eff = getEffectiveRating(db, p.id);
          const o = document.createElement("option");
          o.value = p.id;
          o.textContent = `${p.name} • ${p.position} • base ${fmt(p.rating,1)} • eff ${fmt(eff,1)}`;
          sel.appendChild(o);
        });
        // restore saved
        const picked = saved[`${idx}`];
        if(picked) sel.value = picked;
        sel.onchange = ()=>previewStrength();
      });

      previewStrength();
    }

    formationSel.onchange = ()=>buildSlots();

    document.getElementById("saveLineup").onclick = ()=>{
      const f = formationSel.value;

      // Custom 4-line: state is already in lineupStore[f], just persist
      if(f === "custom4"){
        if(!lineupStore[f]) lineupStore[f] = {};
        db.lineups[teamId] = lineupStore;
        saveDB(db);
        alert("XI guardado (Custom).");
        previewStrength();
        return;
      }

      if(!lineupStore[f]) lineupStore[f] = {};
      const saved = lineupStore[f];
      // store by index, to support repeated positions
      const slots = FORMATIONS[f] || FORMATIONS["433"];
      slots.forEach((pos, idx)=>{
        const sel = document.getElementById(`slot_${idx}`);
        const val = sel.value || "";
        saved[`${idx}`] = val;
      });
      db.lineups[teamId] = lineupStore;
      saveDB(db);
      alert("XI guardado.");
      previewStrength();
    };

    document.getElementById("autoFill").onclick = ()=>{
      const f = formationSel.value;

      if(f === "custom4"){
        const saved = lineupStore[f];
        if(!saved) return;

        const used = new Set();
        // GK: best GK, else best overall
        {
          const pool = players
            .filter(p=>p.position==="GK" && !used.has(p.id))
            .sort((a,b)=>getEffectiveRating(db,b.id)-getEffectiveRating(db,a.id));
          let pick = pool[0] || players
            .filter(p=>!used.has(p.id))
            .sort((a,b)=>getEffectiveRating(db,b.id)-getEffectiveRating(db,a.id))[0] || null;
          if(pick){
            saved.gk = pick.id;
            used.add(pick.id);
          }
        }

        function fillLine(n, roles, picks){
          for(let i=0;i<n;i++){
            const need = roles[i] || "CM";
            const pool = players
              .filter(p=>p.position===need && !used.has(p.id))
              .sort((a,b)=>getEffectiveRating(db,b.id)-getEffectiveRating(db,a.id));
            let pick = pool[0] || null;
            if(!pick){
              pick = players
                .filter(p=>!used.has(p.id))
                .sort((a,b)=>getEffectiveRating(db,b.id)-getEffectiveRating(db,a.id))[0] || null;
            }
            if(pick){
              picks[i] = pick.id;
              used.add(pick.id);
            }else{
              picks[i] = "";
            }
          }
        }

        fillLine(saved.defN, saved.defRoles, saved.def);
        fillLine(saved.midN, saved.midRoles, saved.mid);
        fillLine(saved.attN, saved.attRoles, saved.att);

        // rebuild UI to reflect new picks
        buildSlots();
        return;
      }

      const slots = FORMATIONS[f] || FORMATIONS["433"];
      // pick best effective by matching position, avoiding duplicates
      const used = new Set();
      slots.forEach((pos, idx)=>{
        const need = normalizePos(pos);
        const pool = players
          .filter(p=>p.position===need && !used.has(p.id))
          .sort((a,b)=>getEffectiveRating(db,b.id) - getEffectiveRating(db,a.id));
        let pick = pool[0] || null;
        if(!pick){
          // fallback: any unused
          pick = players
            .filter(p=>!used.has(p.id))
            .sort((a,b)=>getEffectiveRating(db,b.id) - getEffectiveRating(db,a.id))[0] || null;
        }
        const sel = document.getElementById(`slot_${idx}`);
        if(pick){
          sel.value = pick.id;
          used.add(pick.id);
        }else{
          sel.value = "";
        }
      });
      previewStrength();
    };

    function previewStrength(){
      const f = formationSel.value;
      const xi = getXIFromBuilder(teamId, f, db);
      const s = computeStrengthFromXI(db, xi, true);
      document.getElementById("strengthPreview").innerHTML = `
        Ataque: <b>${fmt(s.attack,2)}</b> • Defensa: <b>${fmt(s.defense,2)}</b> • Control: <b>${fmt(s.control,2)}</b><br/>
        Total XI: <b>${fmt(s.total,2)}</b>
      `;
    }

    // init
    buildSlots();
  }

  function getXIFromBuilder(teamId, formation, db){
    // Custom 4-line formation
    if(formation === "custom4"){
      const cfg = db.lineups?.[teamId]?.[formation];
      const xi = [];
      if(!cfg) return xi;

      const add = (pid, slotPos)=>{
        if(!pid) return;
        const p = db.players.find(pp=>pp.id===pid);
        if(!p) return;
        xi.push({ ...p, _slotPos: slotPos });
      };

      add(cfg.gk, "GK");
      (cfg.def||[]).forEach((pid, i)=>add(pid, (cfg.defRoles||[])[i] || "CB"));
      (cfg.mid||[]).forEach((pid, i)=>add(pid, (cfg.midRoles||[])[i] || "CM"));
      (cfg.att||[]).forEach((pid, i)=>add(pid, (cfg.attRoles||[])[i] || "ST"));
      return xi;
    }

    const lineups = db.lineups?.[teamId]?.[formation] || {};
    const slots = FORMATIONS[formation] || FORMATIONS["433"];
    const xi = [];
    slots.forEach((pos, idx)=>{
      const pid = lineups[`${idx}`];
      if(!pid) return;
      const p = db.players.find(pp=>pp.id===pid);
      if(!p) return;
      xi.push({ ...p, _slotPos: normalizePos(pos) });
    });
    return xi;
  }

  // ---- Match Logger (season-aware) ----
  function renderLogger(db, teamId){
    const team = db.teams.find(t=>t.id===teamId);
    const v = document.getElementById("fl_view");
    if(!team){ v.innerHTML = `<div class="fl-card">Equipo no encontrado.</div>`; return; }

    const players = db.players.filter(p=>p.teamId===teamId);

    v.innerHTML = `
      <div class="fl-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:900;">Match Logger — ${escapeHtml(team.name)}</div>
            <div class="fl-small">Registra rendimiento por partido. Solo temporada actual afecta la simulación.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="mc-btn" id="goTeam">Volver al equipo</button>
            <button class="mc-btn" id="goLineup">XI Builder</button>
          </div>
        </div>
      </div>

      <div class="fl-card">
        <div class="fl-row">
          <div>
            <div class="fl-h3">Jugador</div>
            <select class="fl-select" id="plSel"></select>
          </div>
          <div>
            <div class="fl-h3">Temporada</div>
            <input class="fl-input" id="season" value="${escapeHtml(db.settings.currentSeason)}" placeholder="Ej: 2025-2026">
          </div>
          <div>
            <div class="fl-h3">Fecha</div>
            <input class="fl-input" id="date" type="date">
          </div>
        </div>
      </div>

      <div class="fl-grid2">
        <div class="fl-card">
          <div style="font-weight:800;">📌 Básico</div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="minutes" type="number" min="0" max="120" step="1" placeholder="Minutos (0–90)">
            <input class="fl-input" id="goals" type="number" min="0" step="1" placeholder="Goles">
            <input class="fl-input" id="assists" type="number" min="0" step="1" placeholder="Asistencias">
          </div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="yellow" type="number" min="0" step="1" placeholder="Amarillas">
            <input class="fl-input" id="red" type="number" min="0" step="1" placeholder="Rojas">
            <input class="fl-input" id="losses" type="number" min="0" step="1" placeholder="Pérdidas">
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:800;">⚡ Acciones con valor (Sofascore vibe)</div>
          <div class="fl-small" style="margin-top:6px;">No todos los pases valen igual: progresivos suman más que regresivos.</div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="shotsOn" type="number" min="0" step="1" placeholder="Tiros a puerta">
            <input class="fl-input" id="keyPasses" type="number" min="0" step="1" placeholder="Key passes">
            <input class="fl-input" id="progPasses" type="number" min="0" step="1" placeholder="Pases progresivos">
          </div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="passC" type="number" min="0" step="1" placeholder="Pases completados">
            <input class="fl-input" id="passA" type="number" min="0" step="1" placeholder="Pases intentados">
            <input class="fl-input" id="dribblesWon" type="number" min="0" step="1" placeholder="Regates buenos">
          </div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="duelsWon" type="number" min="0" step="1" placeholder="Duelos ganados">
            <input class="fl-input" id="duelsTot" type="number" min="0" step="1" placeholder="Duelos totales">
            <input class="fl-input" id="defActions" type="number" min="0" step="1" placeholder="Acciones defensivas">
          </div>
          <div class="fl-row" style="margin-top:10px;">
            <input class="fl-input" id="saves" type="number" min="0" step="1" placeholder="Atajadas (GK)">
            <input class="fl-input" id="conceded" type="number" min="0" step="1" placeholder="Goles concedidos (GK)">
            <input class="fl-input" id="cleanSheet" type="number" min="0" max="1" step="1" placeholder="Clean sheet 0/1">
          </div>
        </div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">Pesos por categoría</div>
        <div class="fl-small" style="margin-top:6px;">Ajusta el “impacto” de cada categoría (tu criterio).</div>
        <div class="fl-row" style="margin-top:10px;align-items:flex-end;">
          ${Object.keys(db.weights).map(k=>`
            <div style="min-width:180px;flex:1 1 180px;">
              <div class="fl-small"><b>${k}</b> <span id="w_${k}_v">${db.weights[k]}</span></div>
              <input id="w_${k}" type="range" min="0.3" max="2.5" step="0.1" value="${db.weights[k]}" style="width:100%;">
            </div>
          `).join("")}
        </div>
        <div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="saveWeights">Guardar Pesos</button>
          <button class="mc-btn" id="apply">Calcular & Guardar</button>
        </div>
        <div id="result" class="fl-small" style="margin-top:10px;"></div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">Historial reciente (temporada actual)</div>
        <div id="recentLogs" class="fl-small" style="margin-top:8px;"></div>
      </div>
    `;

    document.getElementById("goTeam").onclick = ()=>openLab("team",{teamId});
    document.getElementById("goLineup").onclick = ()=>openLab("lineup",{teamId});

    // defaults
    const d = new Date();
    const iso = d.toISOString().slice(0,10);
    document.getElementById("date").value = iso;

    const plSel = document.getElementById("plSel");
    if(players.length===0){
      plSel.innerHTML = `<option>(Agrega jugadores primero)</option>`;
      return;
    }
    players.forEach(p=>{
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.name} • ${p.position} • base ${fmt(p.rating,1)} • eff ${fmt(getEffectiveRating(db,p.id),1)}`;
      plSel.appendChild(o);
    });

    // sliders text
    Object.keys(db.weights).forEach(k=>{
      const r = document.getElementById("w_"+k);
      r.oninput = ()=> document.getElementById("w_"+k+"_v").textContent = r.value;
    });

    document.getElementById("saveWeights").onclick = ()=>{
      Object.keys(db.weights).forEach(k=> db.weights[k] = parseFloat(document.getElementById("w_"+k).value));
      saveDB(db);
      alert("Pesos guardados.");
    };

    document.getElementById("apply").onclick = ()=>{
      const pid = plSel.value;
      const p = db.players.find(pp=>pp.id===pid);
      if(!p) return;

      const season = document.getElementById("season").value.trim() || db.settings.currentSeason;
      const date = document.getElementById("date").value || new Date().toISOString().slice(0,10);

      // read numbers safely
      const num = (id)=>{ const el = document.getElementById(id); return el ? (parseFloat(el.value)||0) : 0; };

      const minutes = num("minutes");
      const goals = num("goals");
      const assists = num("assists");
      const yellow = num("yellow");
      const red = num("red");
      const losses = num("losses");

      const shotsOn = num("shotsOn");
      const keyPasses = num("keyPasses");
      const progPasses = num("progPasses");
      const passC = num("passC");
      const passA = Math.max(1, num("passA"));
      const dribblesWon = num("dribblesWon");
      const duelsWon = num("duelsWon");
      const duelsTot = Math.max(1, num("duelsTot"));
      const defActions = num("defActions");

      const saves = num("saves");
      const conceded = num("conceded");
      const cleanSheet = num("cleanSheet");

      // update weights from sliders (for this calc)
      Object.keys(db.weights).forEach(k=> db.weights[k] = parseFloat(document.getElementById("w_"+k).value));

      // compute matchScore (0..10)
      const score = computeMatchScore(db, p.position, {
        minutes, goals, assists, yellow, red, losses,
        shotsOn, keyPasses, progPasses, passC, passA,
        dribblesWon, duelsWon, duelsTot, defActions,
        saves, conceded, cleanSheet
      });

      // update player's base rating slightly (learning) OR keep base stable?
      // We'll do: base rating evolves slowly toward current-season form, but mostly stable.
      // Update "rating" with a small K based on minutes:
      const minFactor = Math.sqrt(clamp(minutes/90, 0, 1));
      const expected = p.rating;
      const K = 0.12 * minFactor; // conservative
      const newRating = clamp(expected + K * (score - expected), 0, 10);

      // log
      db.matches.push({
        id: uid("m"),
        playerId: pid,
        teamId: p.teamId,
        season,
        date,
        position: p.position,
        stats: {
          minutes, goals, assists, yellow, red, losses,
          shotsOn, keyPasses, progPasses, passC, passA,
          dribblesWon, duelsWon, duelsTot, defActions,
          saves, conceded, cleanSheet
        },
        score,
        oldRating: expected,
        newRating
      });

      p.rating = newRating;

      // save
      saveDB(db);

      // show
      const eff = getEffectiveRating(db, pid);
      document.getElementById("result").innerHTML = `
        <b>Performance Score:</b> ${fmt(score,2)} • <b>Rating base:</b> ${fmt(newRating,2)} • <b>Rating efectivo:</b> ${fmt(eff,2)}<br/>
        <span class="fl-small">Temporada: ${escapeHtml(season)} • Fecha: ${escapeHtml(date)}</span>
      `;

      // refresh dropdown label
      openLab("logger",{teamId});
    };

    // recent logs list
    const season = db.settings.currentSeason;
    const recent = db.matches
      .filter(m=>m.teamId===teamId && m.season===season)
      .sort((a,b)=> (b.date||"").localeCompare(a.date||""))
      .slice(0, 8);

    document.getElementById("recentLogs").innerHTML = recent.map(m=>{
      const p = db.players.find(pp=>pp.id===m.playerId);
      return `• ${escapeHtml(m.date)} — ${escapeHtml(p?.name||"Jugador")} (${m.position}) score ${fmt(m.score,2)}<br/>`;
    }).join("") || `<span style="opacity:.75;">Aún no hay registros de esta temporada.</span>`;
  }

  // ---- Compute match score (weighted categories) ----
  function computeMatchScore(db, pos, s){
    const w = db.weights;

    const minutes = clamp(s.minutes||0, 0, 120);
    const minFactor = Math.sqrt(clamp(minutes/90, 0, 1));

    // ratios
    const passPct = (s.passC||0) / Math.max(1, s.passA||1);
    const duelPct = (s.duelsWon||0) / Math.max(1, s.duelsTot||1);

    // Category contributions (rough but tunable)
    const shotsVal =
      (s.goals||0) * 1.8 +
      (s.assists||0) * 1.0 +
      (s.shotsOn||0) * 0.35;

    const passesVal =
      passPct * 1.4 +
      (s.keyPasses||0) * 0.45 +
      (s.progPasses||0) * 0.18;

    const dribblesVal =
      (s.dribblesWon||0) * 0.28 +
      duelPct * 0.6;

    const defenseVal =
      (s.defActions||0) * 0.22 +
      duelPct * 0.8;

    const gkVal =
      (s.saves||0) * 0.35 +
      (s.cleanSheet||0) * 0.9 -
      (s.conceded||0) * 0.45;

    const disciplineVal =
      (s.losses||0) * -0.06 +
      (s.yellow||0) * -0.25 +
      (s.red||0) * -0.95;

    // Position-based mixing (so GK isn't judged by dribbles etc.)
    let mix = {shots:0.25, passes:0.25, dribbles:0.15, defense:0.25, goalkeeper:0.10};
    if(pos==="GK") mix = {shots:0.05, passes:0.15, dribbles:0.05, defense:0.25, goalkeeper:0.50};
    if(pos==="CB") mix = {shots:0.10, passes:0.20, dribbles:0.10, defense:0.45, goalkeeper:0.15};
    if(pos==="LB"||pos==="RB") mix = {shots:0.12, passes:0.25, dribbles:0.18, defense:0.30, goalkeeper:0.15};
    if(pos==="CDM") mix = {shots:0.10, passes:0.30, dribbles:0.12, defense:0.40, goalkeeper:0.08};
    if(pos==="CM") mix = {shots:0.14, passes:0.38, dribbles:0.16, defense:0.26, goalkeeper:0.06};
    if(pos==="CAM") mix = {shots:0.28, passes:0.38, dribbles:0.20, defense:0.10, goalkeeper:0.04};
    if(pos==="LW"||pos==="RW") mix = {shots:0.32, passes:0.28, dribbles:0.26, defense:0.10, goalkeeper:0.04};
    if(pos==="ST") mix = {shots:0.48, passes:0.18, dribbles:0.18, defense:0.10, goalkeeper:0.06};

    // Weighted sum (then scaled to 0..10)
    // Multiply category by its global weight + mix
    let raw =
      (shotsVal * w.shots * mix.shots) +
      (passesVal * w.passes * mix.passes) +
      (dribblesVal * w.dribbles * mix.dribbles) +
      (defenseVal * w.defense * mix.defense) +
      (gkVal * w.goalkeeper * mix.goalkeeper) +
      (disciplineVal * w.discipline);

    raw *= minFactor;

    // Map raw -> 0..10 with a gentle curve
    // The constants here are deliberately conservative to avoid huge jumps.
    const score = clamp( 5 + raw, 0, 10 );
    return score;
  }

  // ---- Form score from current season ----
  function getFormScore(db, playerId){
    const season = db.settings.currentSeason;
    const leagueId = db.settings.currentLeagueId;
    const logs = db.matches
      .filter(m=>m.playerId===playerId && m.season===season && (m.leagueId||db.settings.currentLeagueId)===leagueId)
      .sort((a,b)=> (b.date||"").localeCompare(a.date||""))
      .slice(0, Math.max(1, db.settings.formLastN||5));

    if(logs.length===0) return NaN;

    // weighted by minutes factor (more minutes => more trust)
    let sum=0, wsum=0;
    logs.forEach(m=>{
      const mins = m.stats?.minutes ?? 0;
      const wf = Math.sqrt(clamp((mins||0)/90, 0, 1));
      sum += (m.score||0) * wf;
      wsum += wf;
    });
    if(wsum<=0) return NaN;
    return clamp(sum/wsum, 0, 10);
  }

  function getEffectiveRating(db, playerId){
    const p = db.players.find(pp=>pp.id===playerId);
    if(!p) return 0;
    const base = clamp(p.rating||0, 0, 10);
    const form = getFormScore(db, playerId);
    if(!Number.isFinite(form)) return base;
    const fw = clamp(db.settings.formWeight ?? 0.35, 0, 1);
    return clamp(base + fw*(form - base), 0, 10);
  }

  // ---- Strength from XI ----
  function computeStrengthFromXI(db, xi, includeControl=true){
    // xi entries carry _slotPos possibly (preferred)
    const group = {attack:[], defense:[], control:[]};

    xi.forEach(p=>{
      const pos = normalizePos(p._slotPos || p.position || "");
      const eff = getEffectiveRating(db, p.id);
      if(["ST","LW","RW","CAM"].includes(pos)) group.attack.push(eff);
      if(["CB","LB","RB","CDM","GK"].includes(pos)) group.defense.push(eff);
      if(["CM","CAM","CDM"].includes(pos)) group.control.push(eff);
    });

    const avg = (arr)=> arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
    const attack = avg(group.attack);
    const defense = avg(group.defense);
    const control = includeControl ? avg(group.control) : 0;

    const total = includeControl ? (0.4*attack + 0.4*defense + 0.2*control) : (0.5*attack + 0.5*defense);
    return {attack, defense, control, total};
  }

  // ---- Versus (V5) ----
  function renderVersus(db){
    const v = document.getElementById("fl_view");

    v.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:900;">⚔️ Versus Simulator (temporada actual)</div>
        <div class="fl-small" style="margin-top:6px;">
          Usa XI guardado por equipo (si existe). Si no hay XI, usa promedio de plantilla (menos preciso).
        </div>
      </div>

      <div class="fl-card">
        <div class="fl-row">
          <div>
            <div class="fl-h3">Local</div>
            <select class="fl-select" id="homeTeam"></select>
          </div>
          <div>
            <div class="fl-h3">Visitante</div>
            <select class="fl-select" id="awayTeam"></select>
          </div>
          <div>
            <div class="fl-h3">Formación</div>
            <select class="fl-select" id="formation"></select>
          </div>
          <div>
            <div class="fl-h3">Localía</div>
            <input class="fl-input" id="homeAdv" type="number" step="0.01" min="0" max="0.30" value="${fmt(db.settings.homeAdvantage,2)}">
          </div>
        </div>

        <div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="run">Simular</button>
          <button class="mc-btn" id="syncApiBoth">Sync API equipos</button>
          <button class="mc-btn" id="openHomeXI">XI Local</button>
          <button class="mc-btn" id="openAwayXI">XI Visitante</button>
        </div>
        <div id="versusApiStatus" class="fl-small" style="margin-top:8px;"></div>
      </div>

      <div class="fl-grid2">
        <div class="fl-card">
          <div style="font-weight:800;">📊 Probabilidades</div>
          <div id="probs" style="margin-top:8px;"></div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;">🧠 Desglose de fuerza</div>
          <div id="strength" class="fl-small" style="margin-top:8px;"></div>
        </div>
      </div>

            <div class="fl-card">
        <div style="font-weight:800;">🎲 Monte Carlo (marcador y mercados)</div>
        <div class="fl-small" style="margin-top:6px;">
          Simula miles de partidos usando <b>xG</b> (goles esperados). Puedes ponerlos manual o auto-calcularlos desde la fuerza.
        </div>

        <div class="fl-row" style="margin-top:10px; flex-wrap:wrap;">
          <div style="min-width:160px;">
            <div class="fl-h3">xG Local</div>
            <input class="fl-input" id="mc_xgH" type="number" step="0.05" min="0.1" max="5" value="1.35">
          </div>
          <div style="min-width:160px;">
            <div class="fl-h3">xG Visitante</div>
            <input class="fl-input" id="mc_xgA" type="number" step="0.05" min="0.1" max="5" value="1.15">
          </div>
          <div style="min-width:160px;">
            <div class="fl-h3">Simulaciones</div>
            <input class="fl-input" id="mc_N" type="number" step="1000" min="1000" max="50000" value="10000">
          </div>
          <div style="display:flex; gap:8px; align-items:flex-end;">
            <button class="mc-btn" id="mcAutoXg">Auto xG</button>
            <button class="mc-btn" id="mcRun">Simular</button>
          </div>
        </div>

        <div class="fl-card" style="margin-top:12px;">
          <div style="font-weight:800;">💸 Cuotas (opcional, tú las metes)</div>
          <div class="fl-small" style="margin-top:6px;">Convierte cuotas a probabilidades “limpias” (sin margen) y las compara con tu simulación. Si activas calibración, ajusta el total de goles para acercarse al mercado O/U 2.5.</div>

          <div class="fl-row" style="margin-top:10px; flex-wrap:wrap; gap:10px;">
            <div style="min-width:120px;">
              <div class="fl-h3">1</div>
              <input class="fl-input" id="od_1" type="number" step="0.01" min="1.01" placeholder="2.10">
            </div>
            <div style="min-width:120px;">
              <div class="fl-h3">X</div>
              <input class="fl-input" id="od_x" type="number" step="0.01" min="1.01" placeholder="3.30">
            </div>
            <div style="min-width:120px;">
              <div class="fl-h3">2</div>
              <input class="fl-input" id="od_2" type="number" step="0.01" min="1.01" placeholder="3.60">
            </div>

            <div style="min-width:140px;">
              <div class="fl-h3">Over 2.5</div>
              <input class="fl-input" id="od_o25" type="number" step="0.01" min="1.01" placeholder="1.90">
            </div>
            <div style="min-width:140px;">
              <div class="fl-h3">Under 2.5</div>
              <input class="fl-input" id="od_u25" type="number" step="0.01" min="1.01" placeholder="1.95">
            </div>

            <div style="min-width:140px;">
              <div class="fl-h3">BTTS Sí</div>
              <input class="fl-input" id="od_bttsY" type="number" step="0.01" min="1.01" placeholder="1.85">
            </div>
            <div style="min-width:140px;">
              <div class="fl-h3">BTTS No</div>
              <input class="fl-input" id="od_bttsN" type="number" step="0.01" min="1.01" placeholder="1.95">
            </div>

            <div style="min-width:220px;">
              <div class="fl-h3">Blend (tu modelo vs mercado)</div>
              <input class="fl-input" id="od_w" type="number" step="0.05" min="0" max="1" value="0.65">
              <div class="fl-small" style="margin-top:6px;">0 = solo mercado • 1 = solo tu modelo</div>
            </div>

            <div style="display:flex; gap:8px; align-items:flex-end;">
              <label class="fl-small" style="display:flex;gap:8px;align-items:center;">
                <input type="checkbox" id="od_calibrate" checked>
                Calibrar xG con O/U 2.5
              </label>
              <label class="fl-small" style="display:flex;gap:8px;align-items:center; margin-left:14px;">
                <input type="checkbox" id="od_calibrate_full">
                Calibrar con mercado completo (1X2 + O/U + BTTS)
              </label>
            </div>
          </div>

          <div id="od_out" class="fl-small" style="margin-top:10px;"></div>
        </div>


        <div class="fl-grid2" style="margin-top:12px;">
          <div class="fl-card" style="margin:0;">
            <div style="font-weight:800;">Resultados</div>
            <div id="mc_out" style="margin-top:8px;"></div>
            <div id="mc_matrixWrap" style="margin-top:10px;"></div>
          </div>
          <div class="fl-card" style="margin:0;">
            <div style="font-weight:800;">Distribución de goles</div>
            <div class="fl-small" style="margin-top:6px;">0–5 y “6+”.</div>
            <canvas id="mc_chartTotals" height="160"></canvas>
          </div>
        </div>

        <div class="fl-card" style="margin-top:12px;">
          <div style="font-weight:800;">Top marcadores</div>
          <canvas id="mc_chartScores" height="180"></canvas>
        </div>
      </div>

<div class="fl-card">
        <div style="font-weight:800;">🔎 Nota sobre temporada</div>
        <div class="fl-small" style="margin-top:6px;">
          El “FormScore” solo usa registros de la temporada <b>${escapeHtml(db.settings.currentSeason)}</b>.
          Si un jugador no tiene registros en esta temporada, su rating efectivo = rating base.
        </div>
      </div>
    `;

    const homeSel = document.getElementById("homeTeam");
    const awaySel = document.getElementById("awayTeam");
    const formSel = document.getElementById("formation");

    Object.keys(FORMATIONS).forEach(f=>{
      const o = document.createElement("option");
      o.value = f;
      o.textContent = (f==="433"?"4-3-3":f==="442"?"4-4-2":"3-4-3");
      formSel.appendChild(o);
    });
    {
      const o = document.createElement("option");
      o.value = "custom4";
      o.textContent = "Custom (4 líneas)";
      formSel.appendChild(o);
    }


    db.teams.forEach(t=>{
      const o1 = document.createElement("option");
      o1.value = t.id; o1.textContent = t.name;
      homeSel.appendChild(o1);

      const o2 = document.createElement("option");
      o2.value = t.id; o2.textContent = t.name;
      awaySel.appendChild(o2);
    });

    document.getElementById("openHomeXI").onclick = ()=>{
      const tid = homeSel.value;
      if(!tid) return;
      openLab("lineup",{teamId:tid});
    };
    document.getElementById("openAwayXI").onclick = ()=>{
      const tid = awaySel.value;
      if(!tid) return;
      openLab("lineup",{teamId:tid});
    };

    const versusApiStatus = document.getElementById("versusApiStatus");
    async function syncSelectedTeamsFromApi(force=false){
      const ids = [homeSel.value, awaySel.value].filter(Boolean);
      if(!ids.length) return;
      if(versusApiStatus) versusApiStatus.textContent = "Sincronizando API (últimos 5) ...";
      const lines = [];
      for(const tid of ids){
        try{
          const out = await syncApiFixturesForTeam(db, tid, { last:5, force });
          const teamName = out.team?.name || tid;
          if(!out.ok){
            if(out.reason === "missing_api_team_id") lines.push(`• ${teamName}: sin API Team ID`);
            else lines.push(`• ${teamName}: no sincronizado (${out.reason||"error"})`);
            continue;
          }
          lines.push(`• ${teamName}: ${out.fixtures.length} partidos (${out.source}) PPG ${fmt(out.summary.ppg,2)}`);
        }catch(err){
          const team = db.teams.find(t=>t.id===tid);
          lines.push(`• ${team?.name||tid}: error ${String(err?.message||err)}`);
        }
      }
      if(versusApiStatus) versusApiStatus.innerHTML = lines.join("<br/>");
    }

    document.getElementById("syncApiBoth").onclick = async ()=>{
      await syncSelectedTeamsFromApi(true);
    };

    document.getElementById("run").onclick = async ()=>{
      await syncSelectedTeamsFromApi(false);
      const homeId = homeSel.value;
      const awayId = awaySel.value;
      const formation = formSel.value;
      const homeAdv = clamp(parseFloat(document.getElementById("homeAdv").value)||0, 0, 0.30);

      const xiHome = getXIFromBuilder(homeId, formation, db);
      const xiAway = getXIFromBuilder(awayId, formation, db);

      const homeTeam = db.teams.find(t=>t.id===homeId);
      const awayTeam = db.teams.find(t=>t.id===awayId);

      const H = xiHome.length ? computeStrengthFromXI(db, xiHome, true) : computeStrengthFallback(db, homeId);
      const A = xiAway.length ? computeStrengthFromXI(db, xiAway, true) : computeStrengthFallback(db, awayId);

      const homeTotal = H.total * (1+homeAdv);
      const awayTotal = A.total;

      const diff = homeTotal - awayTotal;

      // 3-way: draw higher when diff is small
      const pHomeRaw = 1/(1+Math.exp(-1.25*diff));
      const drawBase = 0.28;
      const pDrawRaw = drawBase * Math.exp(-Math.abs(diff)*1.1);
      const pAwayRaw = 1 - pHomeRaw;

      const norm = pHomeRaw + pDrawRaw + pAwayRaw;
      const pH = pHomeRaw/norm, pD = pDrawRaw/norm, pA = pAwayRaw/norm;

      document.getElementById("probs").innerHTML = `
        <div class="fl-pill"><b>${escapeHtml(homeTeam?.name||"Local")}</b> ${fmt(pH*100,1)}%</div>
        <div class="fl-pill"><b>Empate</b> ${fmt(pD*100,1)}%</div>
        <div class="fl-pill"><b>${escapeHtml(awayTeam?.name||"Visitante")}</b> ${fmt(pA*100,1)}%</div>
      `;

      document.getElementById("strength").innerHTML = `
        <b>Local</b> Total: ${fmt(homeTotal,2)} (A:${fmt(H.attack,2)} D:${fmt(H.defense,2)} C:${fmt(H.control,2)})<br/>
        <b>Visitante</b> Total: ${fmt(awayTotal,2)} (A:${fmt(A.attack,2)} D:${fmt(A.defense,2)} C:${fmt(A.control,2)})<br/>
        <span class="fl-small">Diff: ${fmt(diff,2)} • Localía: +${fmt(homeAdv*100,1)}%</span><br/>
        <span class="fl-small">XI usado: ${xiHome.length? "Sí":"No"} / ${xiAway.length? "Sí":"No"}</span>
      `;

      // persist setting
      db.settings.homeAdvantage = homeAdv;
      saveDB(db);
    };

    // --- Monte Carlo wiring (xG-based score simulation) ---
    const mcOut = document.getElementById("mc_out");
    const mcMatrixWrap = document.getElementById("mc_matrixWrap");
    const mcXgH = document.getElementById("mc_xgH");
    const mcXgA = document.getElementById("mc_xgA");
    const mcN = document.getElementById("mc_N");
const od1 = document.getElementById("od_1");
    const odX = document.getElementById("od_x");
    const od2 = document.getElementById("od_2");
    const odO25 = document.getElementById("od_o25");
    const odU25 = document.getElementById("od_u25");
    const odBTTSY = document.getElementById("od_bttsY");
    const odBTTSN = document.getElementById("od_bttsN");
    const odW = document.getElementById("od_w");
    const odCal = document.getElementById("od_calibrate");
    const odCalFull = document.getElementById("od_calibrate_full");
    const odOut = document.getElementById("od_out");

    // Fail-safe wiring: ensure Monte Carlo buttons work even if advanced block fails.
    const mcAutoBtnFallback = document.getElementById("mcAutoXg");
    const mcRunBtnFallback = document.getElementById("mcRun");
    if(mcRunBtnFallback){
      mcRunBtnFallback.onclick = ()=>{
        const xgH = clampNum(mcXgH?.value, 0.1, 5, 1.35);
        const xgA = clampNum(mcXgA?.value, 0.1, 5, 1.15);
        const N = clampNum(mcN?.value, 1000, 50000, 10000);

        const maxG = 10;
        const pmf = (L)=>{
          const p = Array(maxG+1).fill(0);
          p[0] = Math.exp(-L);
          for(let k=1;k<=maxG;k++) p[k] = p[k-1]*L/k;
          const s = p.reduce((a,b)=>a+b,0);
          if(s<1) p[maxG] += (1-s);
          return p;
        };
        const pH = pmf(xgH), pA = pmf(xgA);
        let wH=0,d=0,wA=0,btts=0,o25=0;
        for(let h=0;h<=maxG;h++) for(let a=0;a<=maxG;a++){
          const pr = pH[h]*pA[a];
          if(h>a) wH += pr; else if(a>h) wA += pr; else d += pr;
          if(h>0 && a>0) btts += pr;
          if(h+a>=3) o25 += pr;
        }
        if(mcOut){
          mcOut.innerHTML = `
            <div class="fl-pill"><b>Local</b> ${fmt(wH*100,1)}%</div>
            <div class="fl-pill"><b>Empate</b> ${fmt(d*100,1)}%</div>
            <div class="fl-pill"><b>Visitante</b> ${fmt(wA*100,1)}%</div>
            <div style="margin-top:10px;" class="fl-small">
              <b>BTTS</b>: ${fmt(btts*100,1)}% &nbsp;•&nbsp; <b>Over 2.5</b>: ${fmt(o25*100,1)}%<br/>
              <b>xG</b>: ${fmt(xgH,2)} / ${fmt(xgA,2)} &nbsp;•&nbsp; <b>N</b>: ${N}
            </div>
          `;
        }
      };
    }
    if(mcAutoBtnFallback){
      mcAutoBtnFallback.onclick = ()=>{
        const homeId = homeSel.value;
        const awayId = awaySel.value;
        const formation = formSel.value;
        const homeAdv = clamp(parseFloat(document.getElementById("homeAdv").value)||0, 0, 0.30);
        const xiHome = getXIFromBuilder(homeId, formation, db);
        const xiAway = getXIFromBuilder(awayId, formation, db);
        const H = xiHome.length ? computeStrengthFromXI(db, xiHome, true) : computeStrengthFallback(db, homeId);
        const A = xiAway.length ? computeStrengthFromXI(db, xiAway, true) : computeStrengthFallback(db, awayId);
        const diff = H.total*(1+homeAdv) - A.total;
        mcXgH.value = fmt(clamp(1.35 + diff*0.35, 0.25, 3.80),2);
        mcXgA.value = fmt(clamp(1.15 - diff*0.25, 0.25, 3.80),2);
      };
    }

    function autoXgFromStrength(){
      // Map strength totals to a reasonable xG baseline.
      // Diff pushes xG in opposite directions; clamps keep it sane.
      const homeId = homeSel.value;
      const awayId = awaySel.value;
      const formation = formSel.value;
      const homeAdv = clamp(parseFloat(document.getElementById("homeAdv").value)||0, 0, 0.30);

      const xiHome = getXIFromBuilder(homeId, formation, db);
      const xiAway = getXIFromBuilder(awayId, formation, db);

      const H = xiHome.length ? computeStrengthFromXI(db, xiHome, true) : computeStrengthFallback(db, homeId);
      const A = xiAway.length ? computeStrengthFromXI(db, xiAway, true) : computeStrengthFallback(db, awayId);

      const homeTotal = H.total * (1+homeAdv);
      const awayTotal = A.total;
      const diff = homeTotal - awayTotal;

      const xgH = clamp(1.35 + diff*0.35, 0.25, 3.80);
      const xgA = clamp(1.15 - diff*0.25, 0.25, 3.80);

      mcXgH.value = fmt(xgH,2);
      mcXgA.value = fmt(xgA,2);
      return {xgH, xgA};
    }

    function renderMcCharts(totals, topScores){
      if(typeof Chart === "undefined") return;

      // totals chart
      const totCanvas = document.getElementById("mc_chartTotals");
      const scCanvas  = document.getElementById("mc_chartScores");
      if(!totCanvas || !scCanvas) return;

      try{ _fbSimCharts.totals?.destroy?.(); }catch(e){}
      try{ _fbSimCharts.scorelines?.destroy?.(); }catch(e){}

      _fbSimCharts.totals = new Chart(totCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: ["0","1","2","3","4","5","6+"],
          datasets: [{ label: "Partidos", data: totals }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });

      _fbSimCharts.scorelines = new Chart(scCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: topScores.map(x=>x.label),
          datasets: [{ label: "Prob %", data: topScores.map(x=>x.pct) }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    function renderScoreMatrix(matrix, nameH, nameA){
      if(!mcMatrixWrap || !Array.isArray(matrix)) return;
      let best = { h:0, a:0, p:-1 };
      for(let h=0; h<6; h++){
        for(let a=0; a<6; a++){
          const p = Number(matrix[h]?.[a] || 0);
          if(p > best.p) best = { h, a, p };
        }
      }
      const maxP = Math.max(0.000001, best.p);
      const header = ['0','1','2','3','4','5+'];
      const rows = matrix.map((row, h)=>{
        const cells = row.map((p, a)=>{
          const alpha = Math.max(0.06, Math.min(0.92, p / maxP));
          const isBest = h===best.h && a===best.a;
          return `<td style="padding:6px 7px;text-align:center;border:1px solid rgba(255,255,255,.12);background:rgba(43,115,255,${alpha.toFixed(3)});${isBest?'outline:2px solid #ffd166;font-weight:900;':''}">${fmt(p*100,1)}%</td>`;
        }).join('');
        return `<tr><th style="padding:6px 7px;border:1px solid rgba(255,255,255,.12);">${header[h]}</th>${cells}</tr>`;
      }).join('');
      mcMatrixWrap.innerHTML = `
        <div class="fl-small" style="margin-bottom:6px;"><b>Matriz exacta (0–5+)</b> · filas ${escapeHtml(nameH)} · columnas ${escapeHtml(nameA)} · más probable: <b>${best.h}:${best.a}</b> (${fmt(best.p*100,2)}%)</div>
        <div style="overflow:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:420px;">
            <thead>
              <tr><th style="padding:6px 7px;border:1px solid rgba(255,255,255,.12);">${escapeHtml(nameH)}\${escapeHtml(nameA)}</th>${header.map(x=>`<th style="padding:6px 7px;border:1px solid rgba(255,255,255,.12);">${x}</th>`).join('')}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }

    function runMonteCarlo(){
      const homeTeam = db.teams.find(t=>t.id===homeSel.value);
      const awayTeam = db.teams.find(t=>t.id===awaySel.value);
      const nameH = homeTeam?.name || "Local";
      const nameA = awayTeam?.name || "Visitante";
      const N = clampNum(mcN?.value, 1000, 50000, 10000);
      const baseXgH = clampNum(mcXgH?.value, 0.1, 5, 1.35);
      const baseXgA = clampNum(mcXgA?.value, 0.1, 5, 1.15);

      // --- Odds -> fair probabilities (remove margin) ---
      function fairFromOdds(arr){
        const ps = arr.map(o=> (Number.isFinite(o) && o>1.0001) ? (1/o) : null);
        if(ps.some(v=>v===null)) return null;
        const s = ps.reduce((a,b)=>a+b,0);
        if(!(s>0)) return null;
        return ps.map(p=>p/s);
      }
      function readOdd(el){
        const v = parseFloat((el?.value||"").trim());
        return (Number.isFinite(v) && v>1.0001) ? v : null;
      }
      function poissonOver25Prob(L){
        // P(G>=3) where G ~ Poisson(L)
        const e = Math.exp(-Math.max(0, L));
        return 1 - e*(1 + L + (L*L)/2);
      }
      function calibrateTotalGoals(targetOver){
        // binary search total lambda to match target P(over2.5) for total goals G~Poisson(L)
        let lo = 0.2, hi = 6.0;
        for(let it=0; it<40; it++){
          const mid = (lo+hi)/2;
          const p = poissonOver25Prob(mid);
          if(p < targetOver) lo = mid;
          else hi = mid;
        }
        return (lo+hi)/2;
      }

      // Fast deterministic "simulation": Poisson pmfs + joint matrix (no randomness, super stable)
      function simulateFast(lambdaH, lambdaA, maxG=10){
        lambdaH = clamp(lambdaH, 0.01, 8);
        lambdaA = clamp(lambdaA, 0.01, 8);
        maxG = clampNum(maxG, 6, 14, 10);

        function pmfPoisson(L){
          const p = Array(maxG+1).fill(0);
          const e = Math.exp(-L);
          p[0] = e;
          for(let k=1;k<=maxG;k++){
            p[k] = p[k-1] * L / k;
          }
          // absorb tail into last bucket to keep total ~1
          const s = p.reduce((a,b)=>a+b,0);
          if(s>0 && s<1){
            p[maxG] += (1-s);
          }
          return p;
        }

        const pH = pmfPoisson(lambdaH);
        const pA = pmfPoisson(lambdaA);

        let winH=0, winA=0, draw=0, btts=0, over25=0;
        const totals = Array(7).fill(0); // 0..5, 6+
        const scoreMap = new Map();      // "h-a" -> prob

        for(let h=0; h<=maxG; h++){
          for(let a=0; a<=maxG; a++){
            const pr = pH[h] * pA[a];
            if(h>a) winH += pr;
            else if(a>h) winA += pr;
            else draw += pr;
            if(h>0 && a>0) btts += pr;
            if(h+a >= 3) over25 += pr;

            totals[Math.min(6, h+a)] += pr;

            // Keep top scorelines later; store all for now (matrix size <= 225)
            scoreMap.set(`${h}-${a}`, pr);
          }
        }

        const topScores = Array.from(scoreMap.entries())
          .map(([label, p])=>({label, p}))
          .sort((x,y)=> y.p - x.p)
          .slice(0, 12);

        const matrix = Array.from({length:6}, ()=>Array(6).fill(0));
        for(let h=0; h<=maxG; h++){
          for(let a=0; a<=maxG; a++){
            const hh = Math.min(5, h);
            const aa = Math.min(5, a);
            matrix[hh][aa] += pH[h] * pA[a];
          }
        }

        return {
          pHome: winH, pDraw: draw, pAway: winA,
          pBTTS: btts, pOver25: over25,
          totals, topScores,
          matrix
        };
      }

      function fairFromOdds2(oYes, oNo){
        const a = (Number.isFinite(oYes) && oYes>1.0001) ? 1/oYes : null;
        const b = (Number.isFinite(oNo) && oNo>1.0001) ? 1/oNo : null;
        if(a==null || b==null) return null;
        const s = a+b;
        return s>0 ? [a/s, b/s] : null;
      }

      function marketTargets(){
        const o1 = readOdd(od1), oX = readOdd(odX), o2 = readOdd(od2);
        const oO = readOdd(odO25), oU = readOdd(odU25);
        const oY = readOdd(odBTTSY), oN = readOdd(odBTTSN);

        const fair1x2 = fairFromOdds([o1, oX, o2]);
        const fairOU = fairFromOdds2(oO, oU);
        const fairBTTS = fairFromOdds2(oY, oN);

        return {
          fair1x2,
          fairOU,
          fairBTTS,
          pHome: fair1x2 ? fair1x2[0] : null,
          pDraw: fair1x2 ? fair1x2[1] : null,
          pAway: fair1x2 ? fair1x2[2] : null,
          pOver25: fairOU ? fairOU[0] : null,
          pBTTS: fairBTTS ? fairBTTS[0] : null
        };
      }

      function calibrateWithMarketFull(baseH, baseA, mk){
        // Lightweight search around base lambdas to approach market targets.
        let best = { lambdaH: baseH, lambdaA: baseA, err: Number.POSITIVE_INFINITY };
        const hMin = clamp(baseH*0.55, 0.05, 6);
        const hMax = clamp(baseH*1.65, 0.05, 6);
        const aMin = clamp(baseA*0.55, 0.05, 6);
        const aMax = clamp(baseA*1.65, 0.05, 6);

        for(let i=0; i<=24; i++){
          const lh = hMin + (hMax-hMin)*(i/24);
          for(let j=0; j<=24; j++){
            const la = aMin + (aMax-aMin)*(j/24);
            const sim = simulateFast(lh, la, 10);
            let err = 0;
            if(mk.pHome!=null) err += Math.pow(sim.pHome - mk.pHome, 2);
            if(mk.pOver25!=null) err += Math.pow(sim.pOver25 - mk.pOver25, 2);
            if(mk.pBTTS!=null) err += Math.pow(sim.pBTTS - mk.pBTTS, 2);
            if(err < best.err){
              best = { lambdaH: lh, lambdaA: la, err };
            }
          }
        }
        return best;
      }

      const mk = marketTargets();
      const fair1x2 = mk.fair1x2;
      const fairOU = mk.fairOU;
      const fairBTTS = mk.fairBTTS;

      const wBlend = clampNum(odW?.value, 0, 1, 0.65);
      const doCal = !!odCal?.checked;
      const doFull = !!odCalFull?.checked;

      // Base lambdas from your model (xG inputs)
      let baseH = baseXgH, baseA = baseXgA;

      // --- Market calibration options ---
      let marketFit = null;

      // A) Full calibration (1X2 + O/U + BTTS) if targets exist
      if(doFull && (mk.pHome!=null || mk.pOver25!=null || mk.pBTTS!=null)){
        marketFit = calibrateWithMarketFull(baseH, baseA, mk);
      } else if(doCal && fairOU) {
        // B) Lite calibration: adjust only total goals using O/U 2.5
        const targetOver = fairOU[0];
        const totalBase = baseH + baseA;
        if(totalBase > 0.05 && targetOver > 0.01 && targetOver < 0.99){
          const totalCal = calibrateTotalGoals(targetOver);
          const r = baseH / totalBase;
          marketFit = { lambdaH: clamp(r * totalCal, 0.05, 6), lambdaA: clamp((1-r) * totalCal, 0.05, 6), err: null };
        }
      }


      // Fast deterministic "simulation": Poisson pmfs + joint matrix (no randomness, super stable)
      function simulateFast(lambdaH, lambdaA, maxG=10){
        lambdaH = clamp(lambdaH, 0.01, 8);
        lambdaA = clamp(lambdaA, 0.01, 8);
        maxG = clampNum(maxG, 6, 14, 10);

        function pmfPoisson(L){
          const p = Array(maxG+1).fill(0);
          const e = Math.exp(-L);
          p[0] = e;
          for(let k=1;k<=maxG;k++){
            p[k] = p[k-1] * L / k;
          }
          // absorb tail into last bucket to keep total ~1
          const s = p.reduce((a,b)=>a+b,0);
          if(s>0 && s<1){
            p[maxG] += (1-s);
          }
          return p;
        }

        const pH = pmfPoisson(lambdaH);
        const pA = pmfPoisson(lambdaA);

        let winH=0, winA=0, draw=0, btts=0, over25=0;
        const totals = Array(7).fill(0); // 0..5, 6+
        const scoreMap = new Map();      // "h-a" -> prob

        for(let h=0; h<=maxG; h++){
          for(let a=0; a<=maxG; a++){
            const pr = pH[h] * pA[a];
            if(h>a) winH += pr;
            else if(a>h) winA += pr;
            else draw += pr;
            if(h>0 && a>0) btts += pr;
            if(h+a >= 3) over25 += pr;

            totals[Math.min(6, h+a)] += pr;

            // Keep top scorelines later; store all for now (matrix size <= 225)
            scoreMap.set(`${h}-${a}`, pr);
          }
        }

        const topScores = Array.from(scoreMap.entries())
          .map(([label, p])=>({label, p}))
          .sort((x,y)=> y.p - x.p)
          .slice(0, 12);

        const matrix = Array.from({length:6}, ()=>Array(6).fill(0));
        for(let h=0; h<=maxG; h++){
          for(let a=0; a<=maxG; a++){
            const hh = Math.min(5, h);
            const aa = Math.min(5, a);
            matrix[hh][aa] += pH[h] * pA[a];
          }
        }

        return {
          pHome: winH, pDraw: draw, pAway: winA,
          pBTTS: btts, pOver25: over25,
          totals, topScores,
          matrix
        };
      }

      function fairFromOdds2(oYes, oNo){
        const a = (Number.isFinite(oYes) && oYes>1.0001) ? 1/oYes : null;
        const b = (Number.isFinite(oNo) && oNo>1.0001) ? 1/oNo : null;
        if(a==null || b==null) return null;
        const s = a+b;
        return s>0 ? [a/s, b/s] : null;
      }

      function marketTargets(){
      const mk = marketTargets();
      const fair1x2 = mk.fair1x2;
      const fairOU = mk.fairOU;
      const fairBTTS = mk.fairBTTS;

      const wBlend = clampNum(odW?.value, 0, 1, 0.65);
      const doCal = !!odCal?.checked;
      const doFull = !!odCalFull?.checked;

      // Base lambdas from your model (xG inputs)
      let baseH = baseXgH, baseA = baseXgA;

      // --- Market calibration options ---
      let marketFit = null;

      // A) Full calibration (1X2 + O/U + BTTS) if targets exist
      if(doFull && (mk.pHome!=null || mk.pOver25!=null || mk.pBTTS!=null)){
        marketFit = calibrateWithMarketFull(baseH, baseA, mk);
      } else if(doCal && fairOU) {
        // B) Lite calibration: adjust only total goals using O/U 2.5
        const targetOver = fairOU[0];
        const totalBase = baseH + baseA;
        if(totalBase > 0.05 && targetOver > 0.01 && targetOver < 0.99){
          const totalCal = calibrateTotalGoals(targetOver);
          const r = baseH / totalBase;
          marketFit = { lambdaH: clamp(r * totalCal, 0.05, 6), lambdaA: clamp((1-r) * totalCal, 0.05, 6), err: null };
        }
      }

      // Blend lambdas (0 = market, 1 = model)
      const xgH = marketFit ? (wBlend*baseH + (1-wBlend)*marketFit.lambdaH) : baseH;
      const xgA = marketFit ? (wBlend*baseA + (1-wBlend)*marketFit.lambdaA) : baseA;

      
      // Deterministic "fast sim" (no randomness): stable outputs + instant calibration
      const simFinal = simulateFast(xgH, xgA, 10);
      const simModel = simulateFast(baseH, baseA, 10);

      const pH = simFinal.pHome, pD = simFinal.pDraw, pA = simFinal.pAway;
      const pBTTS = simFinal.pBTTS;
      const pO25 = simFinal.pOver25;

      const mkH = fair1x2 ? fair1x2[0] : null;
      const mkD = fair1x2 ? fair1x2[1] : null;
      const mkA = fair1x2 ? fair1x2[2] : null;

      const mkO25 = fairOU ? fairOU[0] : null;
      const mkU25 = fairOU ? fairOU[1] : null;

      const mkBTTSY = fairBTTS ? fairBTTS[0] : null;
      const mkBTTSN = fairBTTS ? fairBTTS[1] : null;

      // For charts, convert probs to pseudo-counts (for visual scale)
      const totals = simFinal.totals.map(p => Math.round(p * N));
      const topScores = simFinal.topScores.map(s => ({
        label: s.label,
        pct: +((s.p*100).toFixed(2)),
        c: Math.round(s.p * N)
      }));

      if(mcOut){
        mcOut.innerHTML = `
          <div class="fl-pill"><b>${escapeHtml(nameH)}</b> ${fmt(pH*100,1)}%</div>
          <div class="fl-pill"><b>Empate</b> ${fmt(pD*100,1)}%</div>
          <div class="fl-pill"><b>${escapeHtml(nameA)}</b> ${fmt(pA*100,1)}%</div>
          <div class="fl-pill"><b>Marcador más probable</b> ${escapeHtml(simFinal.topScores?.[0]?.label || "-")} (${fmt((simFinal.topScores?.[0]?.p||0)*100,1)}%)</div>

          <div style="margin-top:10px;" class="fl-small">
            <b>BTTS</b>: ${fmt(pBTTS*100,1)}% &nbsp;•&nbsp;
            <b>Over 2.5</b>: ${fmt(pO25*100,1)}%<br/>
            <b>xG Final</b>: ${fmt(xgH,2)} / ${fmt(xgA,2)} &nbsp;•&nbsp;
            <b>xG Modelo</b>: ${fmt(baseH,2)} / ${fmt(baseA,2)} &nbsp;•&nbsp; <b>N</b>: ${N}
            ${marketFit ? `<br/><span class="fl-small">λ mercado: ${fmt(marketFit.lambdaH,2)} / ${fmt(marketFit.lambdaA,2)}${marketFit.err!=null?` • err ${fmt(marketFit.err,6)}`:``}</span>` : ``}
          </div>

          ${(fair1x2 || fairOU || fairBTTS) ? `
            <div style="margin-top:10px;" class="fl-small">
              <div style="font-weight:800;">Mercado (sin margen)</div>
              ${fair1x2 ? `1X2: ${fmt(mkH*100,1)} / ${fmt(mkD*100,1)} / ${fmt(mkA*100,1)}%<br/>` : ``}
              ${fairOU ? `O/U2.5: Over ${fmt(mkO25*100,1)}% (Under ${fmt(mkU25*100,1)}%)<br/>` : ``}
              ${fairBTTS ? `BTTS: Sí ${fmt(mkBTTSY*100,1)}% (No ${fmt(mkBTTSN*100,1)}%)` : ``}
            </div>
          ` : ``}
        `;

        if(odOut){
          const parts = [];
          if(fair1x2){
            parts.push(`📌 1X2 edge (FINAL - mercado): ${fmt((pH-mkH)*100,1)} / ${fmt((pD-mkD)*100,1)} / ${fmt((pA-mkA)*100,1)} pts`);
          }
          if(fairOU){
            parts.push(`📌 Over2.5 edge (FINAL - mercado): ${fmt((pO25-mkO25)*100,1)} pts`);
          }
          if(fairBTTS){
            parts.push(`📌 BTTS Sí edge (FINAL - mercado): ${fmt((pBTTS-mkBTTSY)*100,1)} pts`);
          }
          if(marketFit && (mkH!=null || mkO25!=null || mkBTTSY!=null)){
            // show how far the raw model is from market (before calibration/blend)
            const eParts = [];
            if(mkH!=null) eParts.push(`Modelo vs mercado 1: ${fmt((simModel.pHome-mkH)*100,1)} pts`);
            if(mkO25!=null) eParts.push(`Over2.5: ${fmt((simModel.pOver25-mkO25)*100,1)} pts`);
            if(mkBTTSY!=null) eParts.push(`BTTS Sí: ${fmt((simModel.pBTTS-mkBTTSY)*100,1)} pts`);
            if(eParts.length) parts.push(`🧭 Distancia del modelo: ${eParts.join(" • ")}`);
          }
          if(!parts.length){
            parts.push(`Si metes cuotas arriba, aquí verás probabilidades limpias (sin margen) + edge vs tu simulación.`);
          }
          odOut.innerHTML = parts.join("<br/>");
        }
      }

      renderMcCharts(totals, topScores);
      renderScoreMatrix(simFinal.matrix, nameH, nameA);

    }

    const mcAutoBtn = document.getElementById("mcAutoXg");
    const mcRunBtn = document.getElementById("mcRun");

    if(mcAutoBtn){
      mcAutoBtn.onclick = ()=>{ autoXgFromStrength(); };
    }
    if(mcRunBtn){
      mcRunBtn.onclick = ()=>{
        try{ console.log("⚽ MonteCarlo: click Simular"); runMonteCarlo(); }
        catch(err){
          console.error("MonteCarlo error:", err);
          const o=document.getElementById("mc_out");
          if(o) o.innerHTML = `<div class="fl-small" style="color:#ffb3b3;">Error: ${escapeHtml(String(err?.message||err))}</div>`;
        }
      };
    }

    // Initial auto-fill once (nice default)
    autoXgFromStrength();
  }

  function computeStrengthFallback(db, teamId){
    const ps = db.players.filter(p=>p.teamId===teamId);
    if(ps.length===0) return {attack:0, defense:0, control:0, total:0};
    // Use effective ratings across squad as coarse fallback
    const effs = ps.map(p=>getEffectiveRating(db,p.id));
    const avg = effs.reduce((a,b)=>a+b,0)/effs.length;

    // Optional boost/penalty with cached API team form (last fixtures)
    const t = db.teams.find(x=>x.id===teamId);
    const apiTeamId = t?.apiTeamId ? String(t.apiTeamId) : "";
    const fixtures = apiTeamId ? (db?.apiCache?.fixturesByTeam?.[apiTeamId]?.fixtures || []) : [];
    const form = summarizeFixtureForm(fixtures, apiTeamId);
    const boosted = avg * form.factor;

    return {attack:boosted, defense:boosted, control:boosted, total:boosted};
  }

  // ---- Bet Tracker ----
  let renderTracker = function(db){
    const v = document.getElementById("fl_view");
    if(!Array.isArray(db.betTracker)) db.betTracker = [];

    v.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:900;">📈 Tracker de apuestas</div>
        <div class="fl-small" style="margin-top:6px;">Registra ganadas/perdidas, cuota, stake y mira tu curva de rendimiento.</div>
        <div class="fl-grid2" style="margin-top:10px;">
          <div>
            <div class="fl-h3">Partido / Evento</div>
            <input class="fl-input" id="bt_match" placeholder="Ej: Real Madrid vs Barça">
          </div>
          <div>
            <div class="fl-h3">Mercado</div>
            <input class="fl-input" id="bt_market" placeholder="Ej: 1X2, Over 2.5, BTTS">
          </div>
          <div>
            <div class="fl-h3">Resultado</div>
            <select class="fl-select" id="bt_result">
              <option value="win">Ganada ✅</option>
              <option value="loss">Perdida ❌</option>
              <option value="push">Nula ↔️</option>
            </select>
          </div>
          <div>
            <div class="fl-h3">Cuota decimal</div>
            <input class="fl-input" id="bt_odds" type="number" min="1.01" step="0.01" value="1.90">
          </div>
          <div>
            <div class="fl-h3">Stake</div>
            <input class="fl-input" id="bt_stake" type="number" min="0" step="0.01" value="10">
          </div>
          <div>
            <div class="fl-h3">Fecha</div>
            <input class="fl-input" id="bt_date" type="date" value="${new Date().toISOString().slice(0,10)}">
          </div>
        </div>
        <div class="fl-row" style="margin-top:12px;">
          <button class="mc-btn" id="bt_add">Agregar registro</button>
        </div>
      </div>

      <div class="fl-grid2">
        <div class="fl-card" style="margin:0;">
          <div style="font-weight:800;">Resumen</div>
          <div id="bt_summary" class="fl-small" style="margin-top:8px;"></div>
        </div>
        <div class="fl-card" style="margin:0;">
          <div style="font-weight:800;">Win / Loss</div>
          <canvas id="bt_chartWL" height="180"></canvas>
        </div>
      </div>

      <div class="fl-card" style="margin-top:12px;">
        <div style="font-weight:800;">Curva de PnL acumulado</div>
        <canvas id="bt_chartPnL" height="190"></canvas>
      </div>

      <div class="fl-card" style="margin-top:12px;">
        <div style="font-weight:800;">Historial</div>
        <div id="bt_list" style="margin-top:8px;"></div>
      </div>
    `;

    function calcProfit(item){
      const odds = clampNum(item.odds, 1.01, 999, 1.9);
      const stake = Math.max(0, Number(item.stake)||0);
      if(item.result === "win") return (odds-1)*stake;
      if(item.result === "loss") return -stake;
      return 0;
    }

    function redraw(){
      const rows = db.betTracker
        .slice()
        .sort((a,b)=> String(a.date||"").localeCompare(String(b.date||"")) || String(a.id||"").localeCompare(String(b.id||"")));

      let wins=0, losses=0, pushes=0;
      let totalStake=0, totalProfit=0;
      let cum=0;
      const labels=[];
      const pnlData=[];

      rows.forEach((r, idx)=>{
        const p = Number.isFinite(r.profit) ? r.profit : calcProfit(r);
        if(r.result==="win") wins++;
        else if(r.result==="loss") losses++;
        else pushes++;
        totalStake += Math.max(0, Number(r.stake)||0);
        totalProfit += p;
        cum += p;
        labels.push(`${idx+1}`);
        pnlData.push(+cum.toFixed(2));
      });

      const roi = totalStake>0 ? (totalProfit/totalStake)*100 : 0;
      document.getElementById("bt_summary").innerHTML = `
        Apuestas: <b>${rows.length}</b> &nbsp;•&nbsp; W/L/P: <b>${wins}</b>/<b>${losses}</b>/<b>${pushes}</b><br/>
        Stake total: <b>${fmt(totalStake,2)}</b> &nbsp;•&nbsp; PnL: <b style="color:${totalProfit>=0?"#8ff0a4":"#ff9b9b"};">${fmt(totalProfit,2)}</b><br/>
        ROI: <b>${fmt(roi,2)}%</b>
      `;

      const list = document.getElementById("bt_list");
      list.innerHTML = rows.map(r=>`
        <div class="fl-card" style="margin:8px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div>
              <div><b>${escapeHtml(r.match||"(sin partido)")}</b> • ${escapeHtml(r.market||"Mercado")}</div>
              <div class="fl-small">${escapeHtml(r.date||"")} • ${r.result==="win"?"Ganada":""}${r.result==="loss"?"Perdida":""}${r.result==="push"?"Nula":""} • cuota ${fmt(r.odds,2)} • stake ${fmt(r.stake,2)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800;color:${(r.profit||0)>=0?"#8ff0a4":"#ff9b9b"};">${fmt(r.profit,2)}</div>
              <button class="mc-btn" data-del="${r.id}" style="margin-top:6px;">Eliminar</button>
            </div>
          </div>
        </div>
      `).join("") || `<div class="fl-small" style="opacity:.75;">Sin registros todavía.</div>`;

      list.querySelectorAll("[data-del]").forEach(b=>b.onclick = ()=>{
        const id = b.getAttribute("data-del");
        db.betTracker = db.betTracker.filter(x=>x.id!==id);
        saveDB(db);
        redraw();
      });

      if(typeof Chart !== "undefined"){
        try{ _fbTrackerCharts.pnl?.destroy?.(); }catch(e){}
        try{ _fbTrackerCharts.wl?.destroy?.(); }catch(e){}

        const pnlCtx = document.getElementById("bt_chartPnL")?.getContext("2d");
        const wlCtx = document.getElementById("bt_chartWL")?.getContext("2d");
        if(pnlCtx){
          _fbTrackerCharts.pnl = new Chart(pnlCtx, {
            type: "line",
            data: { labels, datasets:[{ label:"PnL acumulado", data:pnlData, tension:0.25, fill:true }] },
            options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} }
          });
        }
        if(wlCtx){
          _fbTrackerCharts.wl = new Chart(wlCtx, {
            type: "doughnut",
            data: { labels:["Ganadas","Perdidas","Nulas"], datasets:[{ data:[wins,losses,pushes], backgroundColor:["#3fb950","#f85149","#8b949e"] }] },
            options: { responsive:true, maintainAspectRatio:false }
          });
        }
      }
    }

    document.getElementById("bt_add").onclick = ()=>{
      const result = document.getElementById("bt_result").value;
      const odds = clampNum(document.getElementById("bt_odds").value, 1.01, 999, 1.9);
      const stake = Math.max(0, Number(document.getElementById("bt_stake").value)||0);
      const row = {
        id: uid("bet"),
        date: document.getElementById("bt_date").value || new Date().toISOString().slice(0,10),
        match: document.getElementById("bt_match").value.trim(),
        market: document.getElementById("bt_market").value.trim(),
        result,
        odds,
        stake,
        profit: result==="win" ? (odds-1)*stake : result==="loss" ? -stake : 0
      };
      db.betTracker.push(row);
      saveDB(db);
      redraw();
    };

    redraw();
  };

  // ---- Settings ----
  renderSettings = function(db){
    const v = document.getElementById("fl_view");
    if(!db.settings) db.settings = structuredClone(DEFAULT_DB.settings);
    if(!db.settings.currentSeason) db.settings.currentSeason = getAutoSeasonLabel();
    if(!Number.isFinite(Number(db.settings.formLastN))) db.settings.formLastN = 5;
    if(!Number.isFinite(Number(db.settings.formWeight))) db.settings.formWeight = 0.35;
    if(!Number.isFinite(Number(db.settings.homeAdvantage))) db.settings.homeAdvantage = 0.05;
    if(typeof db.settings.apiSportsKey !== "string") db.settings.apiSportsKey = "";
    if(!Number.isFinite(Number(db.settings.apiCacheHours))) db.settings.apiCacheHours = 12;

    v.innerHTML = `
      <div class="fl-card">
        <div style="font-weight:900;">⚙️ Ajustes</div>
        <div class="fl-small" style="margin-top:6px;">Esto controla cómo “la temporada actual” influye en la simulación.</div>
      </div>

      <div class="fl-card">
        <div class="fl-grid2">
          <div>
            <div class="fl-h3">Temporada actual</div>
            <input class="fl-input" id="season" value="${escapeHtml(db.settings.currentSeason)}" placeholder="Ej: 2025-2026">
            <div class="fl-small" style="margin-top:6px;">Solo los registros con esta temporada se usan para FormScore.</div>
          </div>

          <div>
            <div class="fl-h3">Últimos N partidos</div>
            <input class="fl-input" id="lastN" type="number" min="1" max="20" step="1" value="${db.settings.formLastN}">
            <div class="fl-small" style="margin-top:6px;">Cuántos partidos recientes cuentan para la forma.</div>
          </div>

          <div>
            <div class="fl-h3">Peso de forma (0..1)</div>
            <input class="fl-input" id="formW" type="number" min="0" max="1" step="0.05" value="${fmt(db.settings.formWeight,2)}">
            <div class="fl-small" style="margin-top:6px;">Qué tanto la forma mueve el rating efectivo.</div>
          </div>

          <div>
            <div class="fl-h3">Localía</div>
            <input class="fl-input" id="homeAdv" type="number" min="0" max="0.30" step="0.01" value="${fmt(db.settings.homeAdvantage,2)}">
            <div class="fl-small" style="margin-top:6px;">Bonus al total del equipo local.</div>
          </div>

          <div>
            <div class="fl-h3">API-SPORTS Key</div>
            <input class="fl-input" id="apiSportsKey" placeholder="Tu key de v3.football.api-sports.io" value="${escapeHtml(db.settings.apiSportsKey || "")}">
            <div class="fl-small" style="margin-top:6px;">Se usa para /fixtures?team=..&last=5 y se guarda local.</div>
          </div>

          <div>
            <div class="fl-h3">Cache API (horas)</div>
            <input class="fl-input" id="apiCacheHours" type="number" min="1" max="168" step="1" value="${clampNum(db.settings.apiCacheHours,1,168,12)}">
            <div class="fl-small" style="margin-top:6px;">Evita gastar llamadas del free tier (100/día).</div>
          </div>
        </div>

        <div class="fl-row" style="margin-top:12px;">
          <button class="mc-btn" id="save">Guardar</button>
          <button class="mc-btn" id="resetSeason">Auto-temporada</button>
        </div>
      </div>

      <div class="fl-card">
        <div style="font-weight:800;">📌 Glosario rápido de posiciones</div>
        <div class="fl-small" style="margin-top:8px;">
          ${Object.keys(POS_LABELS).map(k=>`• <b>${k}</b>: ${escapeHtml(POS_LABELS[k].split("—")[1].trim())}`).join("<br/>")}
        </div>
      </div>
    `;

    document.getElementById("save").onclick = ()=>{
      db.settings.currentSeason = document.getElementById("season").value.trim() || getAutoSeasonLabel();
      db.settings.formLastN = clamp(parseInt(document.getElementById("lastN").value)||5, 1, 20);
      db.settings.formWeight = clamp(parseFloat(document.getElementById("formW").value)||0.35, 0, 1);
      db.settings.homeAdvantage = clamp(parseFloat(document.getElementById("homeAdv").value)||0.05, 0, 0.30);
      db.settings.apiSportsKey = String(document.getElementById("apiSportsKey").value || "").trim();
      db.settings.apiCacheHours = clamp(parseInt(document.getElementById("apiCacheHours").value)||12, 1, 168);
      saveDB(db);
      alert("Guardado.");
      openLab("settings");
    };

    document.getElementById("resetSeason").onclick = ()=>{
      db.settings.currentSeason = getAutoSeasonLabel();
      saveDB(db);
      openLab("settings");
    };
  }


  // --- Debug hook (V6e) ---
  try{
    publishFootballLabApi();
    window.__footballLabInitialized = true;
  }catch(e){ console.warn("FootballLab debug hook failed", e); }


// end initFootballLab
}

window.initFootballLab = initFootballLab;

// Auto-init on module load (so main.js can open immediately)
try{
  if(!window.__FOOTBALL_LAB__?.open){
    initFootballLab();
  }
}catch(e){
  try{ window.__footballLabInitialized = false; }catch(_e){}
  console.warn("FootballLab auto-init failed", e);
}
}

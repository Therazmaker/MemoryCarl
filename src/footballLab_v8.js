
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
  console.log("⚽ FOOTBALL LAB V6e ACTIVE");

  const KEY = "footballDB";

  const DEFAULT_DB = {
    settings: {
      currentSeason: getAutoSeasonLabel(), // e.g., "2025-2026"
      homeAdvantage: 0.05,                // +5%
      formLastN: 5,                       // last N matches in current season
      formWeight: 0.35                    // how much match form pulls rating (0..1)
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
    lineups: {}  // lineups[teamId][formation][pos] = playerId
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
    document.getElementById("navSettings").onclick = ()=>openLab("settings");
    document.getElementById("navBack").onclick = ()=>location.reload();

    // render
    if(view==="home") renderHome(db);
    if(view==="teams") renderTeams(db);
    if(view==="team") renderTeam(db, payload.teamId);
    if(view==="lineup") renderLineup(db, payload.teamId);
    if(view==="logger") renderLogger(db, payload.teamId);
    if(view==="versus") renderVersus(db);
    if(view==="settings") renderSettings(db);
    if(view==="player") renderPlayer(db, payload.playerId);

  }

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
        const id = b.getAttribute("data-del");
        if(!confirm("¿Eliminar equipo y sus jugadores?")) return;
        db.teams = db.teams.filter(t=>t.id!==id);
        db.players = db.players.filter(p=>p.teamId!==id);
        // keep matches (historical), but they reference playerId; that's ok for study. optionally prune:
        // db.matches = db.matches.filter(m => db.players.some(p=>p.id===m.playerId));
        saveDB(db);
        openLab("teams");
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
          <button class="mc-btn" id="fl_impRun">Importar</button>
          <button class="mc-btn" id="fl_impClear">Limpiar</button>
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
          newRating: newRating
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

        <div class="fl-row" style="margin-top:10px;">
          <button class="mc-btn" id="pl_saveMatch">Guardar partido</button>
          <div id="pl_savedInfo" class="fl-small"></div>
        </div>
      </div>
    `;

    // set date default
    const iso = new Date().toISOString().slice(0,10);
    document.getElementById("pl_date").value = iso;

    document.getElementById("backTeam").onclick = ()=> openLab("team",{teamId:p.teamId});
    document.getElementById("openLogger").onclick = ()=> openLab("logger",{teamId:p.teamId});

    // last matches view
    const last = logs.slice(0, 8);
    document.getElementById("lastMatches").innerHTML = last.map(m=>{
      return `• ${escapeHtml(m.date)} — score <b>${fmt(m.score,2)}</b> • min ${m.stats?.minutes ?? 0} • G ${m.stats?.goals ?? 0} • A ${m.stats?.assists ?? 0}<br/>`;
    }).join("") || `<span style="opacity:.75;">Aún no hay partidos registrados en esta temporada.</span>`;

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


      const score = computeMatchScore(db, p.position, {
        minutes, goals, assists, yellow, red, losses,
        shotsOn, keyPasses, progPasses, passC, passA,
        dribblesWon, duelsWon, duelsTot, defActions,
        saves, conceded, cleanSheet,
        xG, xA, possessionLost,
        longBallC, longBallA,
        ownHalfPassC, ownHalfPassA,
        oppHalfPassC, oppHalfPassA,
        highClaims, punches
      });

      // Elo-style update (performance vs expected), scaled by minutes
      const expected = p.rating;
      const upd = updateEloRating(expected, score, minutes, 0.20);
      const newRating = upd.newRating;

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

    function buildSlots(){
      const f = formationSel.value;
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
          <button class="mc-btn" id="openHomeXI">XI Local</button>
          <button class="mc-btn" id="openAwayXI">XI Visitante</button>
        </div>
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

    document.getElementById("run").onclick = ()=>{
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
  }

  function computeStrengthFallback(db, teamId){
    const ps = db.players.filter(p=>p.teamId===teamId);
    if(ps.length===0) return {attack:0, defense:0, control:0, total:0};
    // Use effective ratings across squad as coarse fallback
    const effs = ps.map(p=>getEffectiveRating(db,p.id));
    const avg = effs.reduce((a,b)=>a+b,0)/effs.length;
    return {attack:avg, defense:avg, control:avg, total:avg};
  }

  // ---- Settings ----
  function renderSettings(db){
    const v = document.getElementById("fl_view");

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
    window.__FOOTBALL_LAB__ = {
      version: "V6e",
      open: (view, payload)=> openLab(view, payload),
      db: ()=> loadDB(),
      setDB: (db)=> saveDB(db),
      help: "window.__FOOTBALL_LAB__.open('player',{playerId:'...'})"
    };
  }catch(e){ console.warn("FootballLab debug hook failed", e); }

} // end initFootballLab

/**
 * Football Lab — Clean rebuild
 * Local-first simulator with JSON import and football-data.org helpers.
 */

export function initFootballLab(){
  if(window.__footballLabInitialized && window.__FOOTBALL_LAB__?.open){
    return window.__FOOTBALL_LAB__;
  }

  window.__footballLabInitialized = true;
  window.FOOTBALL_LAB_FILE = "footballLab_v8.js";

  const KEY = "footballDB";
  const COMP_CACHE_KEY = "footballLab_competitions";
  const TEAMS_CACHE_PREFIX = "footballLab_teams_";
  const FOOTBALL_DATA_BASE_URL = "https://api.football-data.org/v4";

  const defaultDb = {
    settings: {
      apiToken: "",
      season: String(new Date().getFullYear()),
      selectedLeagueId: ""
    },
    leagues: [],
    teams: [],
    players: [],
    tracker: [],
    versus: { homeAdvantage: 1.1 }
  };

  function uid(prefix){
    return `${prefix}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`;
  }

  function loadDb(){
    const raw = localStorage.getItem(KEY);
    if(!raw){
      localStorage.setItem(KEY, JSON.stringify(defaultDb));
      return structuredClone(defaultDb);
    }
    try{
      const db = JSON.parse(raw);
      db.settings ||= structuredClone(defaultDb.settings);
      db.leagues ||= [];
      db.teams ||= [];
      db.players ||= [];
      db.tracker ||= [];
      db.versus ||= { homeAdvantage: 1.1 };
      return db;
    }catch(_e){
      localStorage.setItem(KEY, JSON.stringify(defaultDb));
      return structuredClone(defaultDb);
    }
  }

  function saveDb(db){
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  async function apiFetch(path, token){
    const res = await fetch(`${FOOTBALL_DATA_BASE_URL}${path}`, {
      headers: { "X-Auth-Token": token }
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function ensureStyles(){
    if(document.getElementById("fl-clean-styles")) return;
    const style = document.createElement("style");
    style.id = "fl-clean-styles";
    style.textContent = `
      .fl-wrap{max-width:1100px;margin:18px auto;padding:0 12px;color:#e8edf3;font-family:Inter,system-ui,sans-serif}
      .fl-card{background:#161b22;border:1px solid #2d333b;border-radius:14px;padding:14px;margin-bottom:12px}
      .fl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .fl-grid{display:grid;gap:10px}
      .fl-grid.two{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
      .fl-btn,.fl-input,.fl-select,.fl-text{border-radius:10px;border:1px solid #2d333b;background:#0d1117;color:#e8edf3;padding:8px 10px}
      .fl-btn{cursor:pointer;font-weight:700}
      .fl-btn.active{background:#1f6feb}
      .fl-text{min-height:140px;width:100%;resize:vertical}
      .fl-title{font-size:22px;font-weight:900;margin-bottom:8px}
      .fl-muted{color:#9ca3af;font-size:13px}
      .fl-table{width:100%;border-collapse:collapse}
      .fl-table td,.fl-table th{border-bottom:1px solid #2d333b;padding:6px;text-align:left;font-size:13px}
    `;
    document.head.appendChild(style);
  }

  function teamStrength(db, teamId){
    const players = db.players.filter(p=>p.teamId===teamId);
    if(!players.length) return 1.0;
    const avg = players.reduce((acc,p)=>acc+(Number(p.rating)||5),0)/players.length;
    return Math.max(0.6, avg/5);
  }

  function poisson(lambda, goals){
    let fact = 1;
    for(let i=2;i<=goals;i++) fact*=i;
    return (Math.exp(-lambda) * (lambda**goals))/fact;
  }

  function versusModel(db, homeId, awayId){
    const home = teamStrength(db, homeId) * (Number(db.versus.homeAdvantage)||1.1);
    const away = teamStrength(db, awayId);
    const lHome = 1.2 * home;
    const lAway = 1.1 * away;
    let pHome=0,pDraw=0,pAway=0;
    for(let h=0;h<=5;h++){
      for(let a=0;a<=5;a++){
        const p = poisson(lHome,h) * poisson(lAway,a);
        if(h>a) pHome += p;
        if(h===a) pDraw += p;
        if(h<a) pAway += p;
      }
    }
    return { lHome, lAway, pHome, pDraw, pAway };
  }

  function normalizeImport(raw){
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const root = data?.liga ? data : data?.league ? { liga: data.league } : data;
    const league = root?.liga || root?.league;
    if(!league) throw new Error("JSON inválido: falta liga/league");

    const leagueName = league.name || league.nombre || "Liga importada";
    const leagueCode = league.code || league.codigo || "";
    const leagueId = league.id ? String(league.id) : uid("lg");

    const teamsSrc = league.equipos || league.teams || [];
    const teams = teamsSrc.map(t=>([
      {
        id: t.id ? String(t.id) : uid("tm"),
        name: t.name || t.nombre || "Equipo",
        apiTeamId: t.apiTeamId ? String(t.apiTeamId) : "",
        leagueId
      },
      (t.jugadores || t.players || []).map(p=>({
        id: p.id ? String(p.id) : uid("pl"),
        name: p.name || p.nombre || "Jugador",
        teamId: t.id ? String(t.id) : null,
        pos: p.pos || p.position || "",
        rating: Number(p.rating) || 5
      }))
    ]));

    const flatTeams = teams.map(x=>x[0]);
    const players = teams.flatMap(x=>x[1].map(p=>({ ...p, teamId: p.teamId || x[0].id })));
    return {
      league: { id: leagueId, name: leagueName, code: leagueCode },
      teams: flatTeams,
      players,
      tracker: root.tracker || [],
      versus: root.versus || null
    };
  }

  function render(view="home"){
    ensureStyles();
    const app = document.getElementById("app");
    if(!app) return;
    const db = loadDb();

    const tabs = ["home","liga","equipos","jugadores","tracker","versus"];
    const nav = tabs.map(t=>`<button class="fl-btn ${view===t?"active":""}" data-tab="${t}">${t.toUpperCase()}</button>`).join("");

    app.innerHTML = `
      <div class="fl-wrap">
        <div class="fl-row fl-card">
          <div class="fl-title">⚽ Football Lab limpio</div>
          ${nav}
        </div>
        <div id="fl-content"></div>
      </div>
    `;

    app.querySelectorAll("[data-tab]").forEach(btn=>{
      btn.onclick = ()=>render(btn.dataset.tab);
    });

    const content = document.getElementById("fl-content");

    if(view==="home"){
      content.innerHTML = `
        <div class="fl-card">
          <div><b>Arquitectura:</b> Liga → Equipos → Jugadores + Tracker + Versus.</div>
          <div class="fl-muted">Importa/pega JSON y sincroniza IDs reales desde football-data.org.</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Importar JSON</div>
          <textarea id="jsonImport" class="fl-text" placeholder='{"liga":{"name":"Premier League","equipos":[...]}}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="runImport">Importar</button>
            <span id="importStatus" class="fl-muted"></span>
          </div>
        </div>
      `;
      document.getElementById("runImport").onclick = ()=>{
        try{
          const parsed = normalizeImport(document.getElementById("jsonImport").value.trim());
          db.leagues = [parsed.league, ...db.leagues.filter(l=>l.id!==parsed.league.id)];
          db.teams = [...db.teams.filter(t=>t.leagueId!==parsed.league.id), ...parsed.teams];
          db.players = [...db.players.filter(p=>!parsed.teams.some(t=>t.id===p.teamId)), ...parsed.players];
          if(Array.isArray(parsed.tracker) && parsed.tracker.length) db.tracker = [...db.tracker, ...parsed.tracker];
          if(parsed.versus) db.versus = { ...db.versus, ...parsed.versus };
          db.settings.selectedLeagueId = parsed.league.id;
          saveDb(db);
          document.getElementById("importStatus").textContent = "✅ JSON importado";
        }catch(err){
          document.getElementById("importStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      return;
    }

    if(view==="liga"){
      const rows = db.leagues.map(l=>`<tr><td>${l.name}</td><td>${l.code||"-"}</td><td>${l.id}</td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card fl-grid two">
          <div>
            <div class="fl-muted">Token football-data.org</div>
            <input id="apiToken" class="fl-input" value="${db.settings.apiToken || ""}" placeholder="X-Auth-Token" />
            <div class="fl-row" style="margin-top:8px;">
              <button class="fl-btn" id="saveToken">Guardar token</button>
              <button class="fl-btn" id="syncCompetitions">Sync /competitions</button>
              <span id="lgStatus" class="fl-muted"></span>
            </div>
          </div>
          <div>
            <div class="fl-muted">Alta manual de liga</div>
            <div class="fl-row">
              <input id="leagueName" class="fl-input" placeholder="Nombre" />
              <input id="leagueCode" class="fl-input" placeholder="Code" />
              <button id="addLeague" class="fl-btn">Agregar</button>
            </div>
          </div>
        </div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Liga</th><th>Code</th><th>ID</th></tr></thead><tbody>${rows||"<tr><td colspan='3'>Sin ligas</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("saveToken").onclick = ()=>{ db.settings.apiToken = document.getElementById("apiToken").value.trim(); saveDb(db); };
      document.getElementById("addLeague").onclick = ()=>{ db.leagues.push({ id: uid("lg"), name: document.getElementById("leagueName").value.trim(), code: document.getElementById("leagueCode").value.trim() }); saveDb(db); render("liga"); };
      document.getElementById("syncCompetitions").onclick = async ()=>{
        const status = document.getElementById("lgStatus");
        try{
          status.textContent = "Sincronizando...";
          const token = document.getElementById("apiToken").value.trim();
          if(!token) throw new Error("Falta token");
          const data = await apiFetch("/competitions", token);
          const comps = (data.competitions||[]).map(c=>({ id: String(c.id), name: c.name, code: c.code || "" }));
          db.leagues = comps;
          localStorage.setItem(COMP_CACHE_KEY, JSON.stringify(comps));
          saveDb(db);
          render("liga");
        }catch(err){ status.textContent = `Error: ${String(err.message||err)}`; }
      };
      return;
    }

    if(view==="equipos"){
      const options = db.leagues.map(l=>`<option value="${l.id}" ${db.settings.selectedLeagueId===l.id?"selected":""}>${l.name}</option>`).join("");
      const leagueTeams = db.teams.filter(t=>t.leagueId===db.settings.selectedLeagueId);
      const rows = leagueTeams.map(t=>`<tr><td>${t.name}</td><td>${t.apiTeamId||"-"}</td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-row">
            <select id="selLeague" class="fl-select"><option value="">Liga</option>${options}</select>
            <input id="teamName" class="fl-input" placeholder="Equipo" />
            <input id="teamApi" class="fl-input" placeholder="API Team ID" />
            <button class="fl-btn" id="addTeam">Agregar</button>
            <button class="fl-btn" id="syncTeams">Sync /competitions/{id}/teams</button>
            <span id="tmStatus" class="fl-muted"></span>
          </div>
        </div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Equipo</th><th>API ID</th></tr></thead><tbody>${rows||"<tr><td colspan='2'>Sin equipos</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("selLeague").onchange = (e)=>{ db.settings.selectedLeagueId = e.target.value; saveDb(db); render("equipos"); };
      document.getElementById("addTeam").onclick = ()=>{ db.teams.push({ id: uid("tm"), name: document.getElementById("teamName").value.trim(), apiTeamId: document.getElementById("teamApi").value.trim(), leagueId: db.settings.selectedLeagueId }); saveDb(db); render("equipos"); };
      document.getElementById("syncTeams").onclick = async ()=>{
        const status = document.getElementById("tmStatus");
        try{
          status.textContent = "Sincronizando equipos...";
          if(!db.settings.selectedLeagueId) throw new Error("Selecciona liga");
          if(!db.settings.apiToken) throw new Error("Falta token");
          const data = await apiFetch(`/competitions/${db.settings.selectedLeagueId}/teams?season=${db.settings.season}`, db.settings.apiToken);
          const incoming = (data.teams||[]).map(t=>({ id: uid("tm"), name: t.name, apiTeamId: String(t.id), leagueId: db.settings.selectedLeagueId }));
          db.teams = [...db.teams.filter(t=>t.leagueId!==db.settings.selectedLeagueId), ...incoming];
          localStorage.setItem(`${TEAMS_CACHE_PREFIX}${db.settings.selectedLeagueId}`, JSON.stringify(incoming));
          saveDb(db);
          render("equipos");
        }catch(err){ status.textContent = `Error: ${String(err.message||err)}`; }
      };
      return;
    }

    if(view==="jugadores"){
      const teamOptions = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const rows = db.players.map(p=>`<tr><td>${p.name}</td><td>${db.teams.find(t=>t.id===p.teamId)?.name||"-"}</td><td>${p.pos||"-"}</td><td>${p.rating}</td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card"><div class="fl-row">
          <input id="playerName" class="fl-input" placeholder="Jugador" />
          <select id="playerTeam" class="fl-select"><option value="">Equipo</option>${teamOptions}</select>
          <input id="playerPos" class="fl-input" placeholder="Pos" />
          <input id="playerRating" class="fl-input" type="number" min="1" max="10" step="0.1" value="5" />
          <button id="addPlayer" class="fl-btn">Agregar</button>
        </div></div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Jugador</th><th>Equipo</th><th>Pos</th><th>Rating</th></tr></thead><tbody>${rows||"<tr><td colspan='4'>Sin jugadores</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("addPlayer").onclick = ()=>{ db.players.push({ id: uid("pl"), name: document.getElementById("playerName").value.trim(), teamId: document.getElementById("playerTeam").value, pos: document.getElementById("playerPos").value.trim(), rating: Number(document.getElementById("playerRating").value)||5 }); saveDb(db); render("jugadores"); };
      return;
    }

    if(view==="tracker"){
      const options = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const rows = db.tracker.map(t=>`<tr><td>${t.date||""}</td><td>${db.teams.find(x=>x.id===t.homeId)?.name||"-"}</td><td>${t.homeGoals}-${t.awayGoals}</td><td>${db.teams.find(x=>x.id===t.awayId)?.name||"-"}</td><td>${t.note||""}</td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card"><div class="fl-row">
          <input id="trDate" type="date" class="fl-input" />
          <select id="trHome" class="fl-select"><option value="">Local</option>${options}</select>
          <input id="trHG" type="number" class="fl-input" placeholder="GL" style="width:74px" />
          <input id="trAG" type="number" class="fl-input" placeholder="GV" style="width:74px" />
          <select id="trAway" class="fl-select"><option value="">Visitante</option>${options}</select>
          <input id="trNote" class="fl-input" placeholder="Nota" />
          <button class="fl-btn" id="addTrack">Guardar</button>
        </div></div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Fecha</th><th>Local</th><th>Marcador</th><th>Visitante</th><th>Nota</th></tr></thead><tbody>${rows||"<tr><td colspan='5'>Sin eventos</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("addTrack").onclick = ()=>{ db.tracker.push({ id: uid("tr"), date: document.getElementById("trDate").value, homeId: document.getElementById("trHome").value, awayId: document.getElementById("trAway").value, homeGoals: Number(document.getElementById("trHG").value)||0, awayGoals: Number(document.getElementById("trAG").value)||0, note: document.getElementById("trNote").value.trim() }); saveDb(db); render("tracker"); };
      return;
    }

    if(view==="versus"){
      const options = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-row">
            <select id="vsHome" class="fl-select"><option value="">Home</option>${options}</select>
            <select id="vsAway" class="fl-select"><option value="">Away</option>${options}</select>
            <input id="vsHA" class="fl-input" type="number" step="0.05" value="${db.versus.homeAdvantage}" title="Home Advantage" />
            <button class="fl-btn" id="runVs">Simular</button>
          </div>
          <div id="vsOut" style="margin-top:10px;" class="fl-muted">Selecciona dos equipos.</div>
        </div>
      `;
      document.getElementById("runVs").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        db.versus.homeAdvantage = Number(document.getElementById("vsHA").value)||1.1;
        saveDb(db);
        if(!homeId || !awayId || homeId===awayId) return;
        const result = versusModel(db, homeId, awayId);
        document.getElementById("vsOut").innerHTML = `
          λ Home: <b>${result.lHome.toFixed(2)}</b> · λ Away: <b>${result.lAway.toFixed(2)}</b><br/>
          Prob Home: <b>${(result.pHome*100).toFixed(1)}%</b> · Draw: <b>${(result.pDraw*100).toFixed(1)}%</b> · Away: <b>${(result.pAway*100).toFixed(1)}%</b>
        `;
      };
    }
  }

  window.__FOOTBALL_LAB__ = {
    open(view="home"){ render(view); },
    getDB(){ return loadDb(); },
    help: "window.__FOOTBALL_LAB__.open('liga'|'equipos'|'jugadores'|'tracker'|'versus')"
  };

  return window.__FOOTBALL_LAB__;
}

window.initFootballLab = initFootballLab;

try{
  if(!window.__FOOTBALL_LAB__?.open){
    initFootballLab();
  }
}catch(e){
  console.warn("FootballLab auto-init failed", e);
}

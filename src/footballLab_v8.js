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
      .fl-squad-section-title{font-size:30px;font-weight:900;margin-bottom:10px;color:#f6f8fa}
      .fl-squad-table{display:grid;gap:8px}
      .fl-squad-head,.fl-squad-row{display:grid;grid-template-columns:52px minmax(230px,1.8fr) 54px 54px 74px 52px 52px 42px 42px;align-items:center;column-gap:8px}
      .fl-squad-head{background:#21262d;border:1px solid #30363d;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;letter-spacing:.07em;color:#9ca3af;text-transform:uppercase}
      .fl-squad-row{background:#1b222c;border:1px solid #30363d;border-radius:10px;padding:12px 10px;font-size:15px}
      .fl-squad-row:hover{background:#242d3a}
      .fl-squad-cell-center{text-align:center}
      .fl-squad-name{display:flex;align-items:center;gap:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fl-flag{font-size:16px;line-height:1}
      .fl-card-yellow{display:inline-block;width:10px;height:16px;border-radius:3px;background:#f5c400}
      .fl-card-red{display:inline-block;width:10px;height:16px;border-radius:3px;background:#e10600}
      .fl-vs-layout{display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1.25fr);gap:12px}
      .fl-vs-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
      .fl-vs-cell{border:1px solid #30363d;border-radius:8px;padding:6px;text-align:center;font-size:12px;background:#111722}
      .fl-vs-cell.head{background:#202a37;font-weight:800}
      .fl-vs-cell.hot{border-color:#2ea043;box-shadow:0 0 0 1px rgba(46,160,67,.25) inset}
      .fl-kpi{display:grid;grid-template-columns:repeat(3,minmax(88px,1fr));gap:8px}
      .fl-kpi > div{background:#111722;border:1px solid #2d333b;border-radius:10px;padding:8px;text-align:center}
      .fl-kpi b{display:block;font-size:18px;color:#f6f8fa}
    `;
    document.head.appendChild(style);
  }

  function pickFirstNumber(...values){
    for(const value of values){
      if(value===null || value===undefined || value==="") continue;
      const raw = typeof value === "string" ? value.replace(",", ".") : value;
      const n = Number(raw);
      if(Number.isFinite(n)) return n;
    }
    return null;
  }

  function pickFirstString(...values){
    for(const value of values){
      if(typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
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

  function impliedProb(odd){
    const n = Number(odd);
    if(!Number.isFinite(n) || n<=1.01) return null;
    return 1/n;
  }

  function clean1x2Probs(oddH, oddD, oddA){
    const pH = impliedProb(oddH);
    const pD = impliedProb(oddD);
    const pA = impliedProb(oddA);
    if(pH===null || pD===null || pA===null) return null;
    const overround = pH+pD+pA;
    if(!overround) return null;
    return { pH: pH/overround, pD: pD/overround, pA: pA/overround };
  }

  function parseStatsPayload(raw){
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.stats) ? data.stats
      : Array.isArray(data?.estadisticas) ? data.estadisticas
      : Array.isArray(data?.statistics) ? data.statistics
      : [];

    const stats = list.map(item=>({
      key: String(item?.key || item?.label || item?.name || item?.stat || "Métrica").trim(),
      home: String(item?.home ?? item?.local ?? item?.a ?? "0").trim(),
      away: String(item?.away ?? item?.visitante ?? item?.b ?? "0").trim()
    })).filter(s=>s.key);

    if(!stats.length) throw new Error("JSON de estadísticas inválido");
    return stats;
  }

  function toNumLoose(value){
    if(value===null || value===undefined) return null;
    const clean = String(value).replace('%','').replace(',','.').trim();
    if(!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  function statsBarsHtml(stats){
    return stats.map(s=>{
      const h = toNumLoose(s.home);
      const a = toNumLoose(s.away);
      const total = (h!==null && a!==null) ? h+a : null;
      const hPct = total && total>0 ? (h/total)*100 : 50;
      const aPct = total && total>0 ? (a/total)*100 : 50;
      return `
        <div style="margin-bottom:12px;">
          <div class="fl-row" style="justify-content:space-between;font-weight:700;">
            <span>${s.home}</span>
            <span>${s.key}</span>
            <span>${s.away}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
            <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#ff3b69 ${hPct}%, #2d333b ${hPct}%);"></div>
            <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#2d333b ${100-aPct}%, #1f6feb ${100-aPct}%);"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function teamFormFromTracker(db, teamId, limit=6){
    const games = db.tracker
      .filter(g=>g.homeId===teamId || g.awayId===teamId)
      .slice(-limit);
    if(!games.length) return { attack:1, defense:1, momentum:1, played:0 };
    let gf=0, ga=0, pts=0;
    games.forEach(g=>{
      const isHome = g.homeId===teamId;
      const goalsFor = isHome ? Number(g.homeGoals)||0 : Number(g.awayGoals)||0;
      const goalsAgainst = isHome ? Number(g.awayGoals)||0 : Number(g.homeGoals)||0;
      gf += goalsFor;
      ga += goalsAgainst;
      pts += goalsFor>goalsAgainst ? 3 : goalsFor===goalsAgainst ? 1 : 0;
    });
    const n = games.length;
    const avgFor = gf/n;
    const avgAgainst = ga/n;
    const pointsRate = pts/(n*3);
    return {
      attack: Math.max(0.7, Math.min(1.45, 0.8 + avgFor*0.35)),
      defense: Math.max(0.7, Math.min(1.45, 0.8 + avgAgainst*0.35)),
      momentum: Math.max(0.85, Math.min(1.2, 0.9 + pointsRate*0.4)),
      played: n
    };
  }

  function versusModel(db, homeId, awayId){
    const homeStrength = teamStrength(db, homeId);
    const awayStrength = teamStrength(db, awayId);
    const homeAdv = Number(db.versus.homeAdvantage)||1.1;
    const pace = Math.max(0.85, Math.min(1.3, Number(db.versus.paceFactor)||1));
    const fHome = teamFormFromTracker(db, homeId);
    const fAway = teamFormFromTracker(db, awayId);

    const atkHome = homeStrength * fHome.attack * fHome.momentum * homeAdv;
    const atkAway = awayStrength * fAway.attack * fAway.momentum;
    const defHome = homeStrength * (2 - fHome.defense*0.9);
    const defAway = awayStrength * (2 - fAway.defense*0.9);

    const lHome = Math.max(0.2, Math.min(4.5, 1.15 * atkHome / Math.max(0.65, defAway) * pace));
    const lAway = Math.max(0.2, Math.min(4.5, 1.05 * atkAway / Math.max(0.65, defHome) * pace));

    const maxGoals = 5;
    const matrix = [];
    let pHome=0,pDraw=0,pAway=0, pTotal=0;
    let best = { h:0, a:0, p:0 };

    for(let h=0;h<=maxGoals;h++){
      const row = [];
      for(let a=0;a<=maxGoals;a++){
        const p = poisson(lHome,h) * poisson(lAway,a);
        row.push(p);
        pTotal += p;
        if(h>a) pHome += p;
        if(h===a) pDraw += p;
        if(h<a) pAway += p;
        if(p>best.p) best = { h, a, p };
      }
      matrix.push(row);
    }

    if(pTotal>0){
      pHome /= pTotal;
      pDraw /= pTotal;
      pAway /= pTotal;
      best.p /= pTotal;
      for(let h=0;h<=maxGoals;h++){
        for(let a=0;a<=maxGoals;a++) matrix[h][a] /= pTotal;
      }
    }

    return { lHome, lAway, pHome, pDraw, pAway, matrix, maxGoals, best, factors: { fHome, fAway, pace, homeAdv } };
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


  function sectionToPos(section){
    const sec = String(section||"").toLowerCase();
    if(sec.includes("portero")) return "GK";
    if(sec.includes("defensa")) return "DF";
    if(sec.includes("centrocamp") || sec.includes("medio")) return "MF";
    if(sec.includes("delanter")) return "FW";
    return "OT";
  }

  function parseImportedSquadRow(row, fallbackPos){
    const flag = pickFirstString(row.flag, row.flagEmoji, row.countryFlag, row.nationalityFlag, row.country?.flag, row.nationality?.flag);
    return {
      name: String(row.name||"").trim(),
      pos: fallbackPos,
      rating: 5,
      number: pickFirstNumber(row.number, row.shirtNumber, row.shirt, row.jersey, row.dorsal, row["#"]),
      age: pickFirstNumber(row.age, row.edad),
      appearances: pickFirstNumber(row.appearances, row.apps, row.matches, row.matchesPlayed, row.partidos, row.titularidades),
      minutes: pickFirstNumber(row.minutes, row.min, row.minutos, row.playedMinutes),
      goals: pickFirstNumber(row.goals, row.goles),
      assists: pickFirstNumber(row.assists, row.asistencias),
      yellowCards: pickFirstNumber(row.yellowCards, row.yellow, row.amarillas, row.bookings),
      redCards: pickFirstNumber(row.redCards, row.red, row.rojas),
      flag
    };
  }

  function renderSquadSection(title, players){
    const rows = players.map(pl=>`
      <div class="fl-squad-row">
        <div class="fl-squad-cell-center">${pl.number ?? "-"}</div>
        <div class="fl-squad-name">${pl.flag ? `<span class="fl-flag">${pl.flag}</span>` : ""}<span>${pl.name}</span></div>
        <div class="fl-squad-cell-center">${pl.age ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.appearances ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.minutes ?? "-"}</div>
        <div class="fl-squad-cell-center">${pl.goals ?? 0}</div>
        <div class="fl-squad-cell-center">${pl.assists ?? 0}</div>
        <div class="fl-squad-cell-center">${pl.yellowCards ? pl.yellowCards : 0}</div>
        <div class="fl-squad-cell-center">${pl.redCards ? pl.redCards : 0}</div>
      </div>
    `).join("");

    return `
      <div class="fl-card">
        <div class="fl-squad-section-title">${title}</div>
        <div class="fl-squad-table">
          <div class="fl-squad-head">
            <div class="fl-squad-cell-center">#</div>
            <div>Nombre</div>
            <div class="fl-squad-cell-center">Edad</div>
            <div class="fl-squad-cell-center">👕</div>
            <div class="fl-squad-cell-center">Min</div>
            <div class="fl-squad-cell-center">⚽</div>
            <div class="fl-squad-cell-center">A</div>
            <div class="fl-squad-cell-center"><span class="fl-card-yellow" title="Amarillas"></span></div>
            <div class="fl-squad-cell-center"><span class="fl-card-red" title="Rojas"></span></div>
          </div>
          ${rows || `<div class="fl-muted">Sin jugadores</div>`}
        </div>
      </div>
    `;
  }

  function render(view="home", payload={}){
    ensureStyles();
    const app = document.getElementById("app");
    if(!app) return;
    const db = loadDb();

    const tabs = ["home","liga","tracker","versus"];
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
      if(!db.settings.selectedLeagueId && db.leagues[0]) db.settings.selectedLeagueId = db.leagues[0].id;
      const leagueCards = db.leagues.map(l=>{
        const teams = db.teams.filter(t=>t.leagueId===l.id);
        const open = db.settings.selectedLeagueId===l.id;
        const names = teams.map(t=>`<div class="fl-row" style="justify-content:space-between;"><span>${t.name}</span><button class="fl-btn" data-open-team="${t.id}">Abrir</button></div>`).join("");
        return `<div class="fl-card"><button class="fl-btn" data-select-league="${l.id}" style="width:100%;text-align:left;">${open?"▾":"▸"} ${l.name}</button><div class="fl-muted" style="margin-top:6px;">${teams.length} equipos</div><div style="display:${open?"block":"none"};margin-top:8px;">${names||"<div class='fl-muted'>Sin equipos</div>"}</div></div>`;
      }).join("");

      content.innerHTML = `
        <div class="fl-card fl-grid two">
          <div>
            <div class="fl-muted">Alta manual de liga</div>
            <div class="fl-row">
              <input id="leagueName" class="fl-input" placeholder="Nombre" />
              <input id="leagueCode" class="fl-input" placeholder="Code" />
              <button id="addLeague" class="fl-btn">Agregar</button>
            </div>
          </div>
          <div>
            <div class="fl-muted">Agregar equipo a la liga seleccionada</div>
            <div class="fl-row">
              <input id="teamName" class="fl-input" placeholder="Equipo" />
              <button class="fl-btn" id="addTeamLiga">Agregar</button>
            </div>
          </div>
        </div>
        ${leagueCards || '<div class="fl-card"><div class="fl-muted">Sin ligas</div></div>'}
      `;

      document.getElementById("addLeague").onclick = ()=>{
        const name = document.getElementById("leagueName").value.trim();
        if(!name) return;
        const lg = { id: uid("lg"), name, code: document.getElementById("leagueCode").value.trim() };
        db.leagues.push(lg);
        db.settings.selectedLeagueId = lg.id;
        saveDb(db);
        render("liga");
      };
      document.getElementById("addTeamLiga").onclick = ()=>{
        const name = document.getElementById("teamName").value.trim();
        if(!name || !db.settings.selectedLeagueId) return;
        db.teams.push({ id: uid("tm"), name, apiTeamId:"", leagueId: db.settings.selectedLeagueId, meta: { stadium:"", city:"", capacity:"" } });
        saveDb(db);
        render("liga");
      };
      content.querySelectorAll("[data-select-league]").forEach(btn=>btn.onclick = ()=>{
        db.settings.selectedLeagueId = btn.getAttribute("data-select-league");
        saveDb(db);
        render("liga");
      });
      content.querySelectorAll("[data-open-team]").forEach(btn=>btn.onclick = ()=> render("equipo", { teamId: btn.getAttribute("data-open-team") }));
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

    if(view==="equipo"){
      const teamId = payload.teamId || payload?.id;
      const team = db.teams.find(t=>t.id===teamId);
      if(!team){
        content.innerHTML = `<div class="fl-card">Equipo no encontrado.</div>`;
        return;
      }
      team.meta ||= { stadium:"", city:"", capacity:"" };
      const players = db.players.filter(p=>p.teamId===team.id);
      const byPos = { GK:[], DF:[], MF:[], FW:[], OT:[] };
      players.forEach(p=>{ const pos = p.pos || "OT"; (byPos[pos]||byPos.OT).push(p); });
      const teamMatches = db.tracker
        .filter(m=>m.homeId===team.id || m.awayId===team.id)
        .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
      const sections = [["Porteros","GK"],["Defensas","DF"],["Centrocampistas","MF"],["Delanteros","FW"],["Otros","OT"]]
        .map(([title,key])=>renderSquadSection(title, byPos[key]||[])).join("");
      const matchRows = teamMatches.map(m=>{
        const isHome = m.homeId===team.id;
        const rival = db.teams.find(t=>t.id===(isHome ? m.awayId : m.homeId));
        const league = db.leagues.find(l=>l.id===m.leagueId);
        const home = db.teams.find(t=>t.id===m.homeId)?.name || "-";
        const away = db.teams.find(t=>t.id===m.awayId)?.name || "-";
        return `<tr>
          <td>${m.date||"-"}</td>
          <td>${league?.name || "Liga"}</td>
          <td>${home} ${m.homeGoals}-${m.awayGoals} ${away}</td>
          <td>${rival?.name || "-"}</td>
          <td><button class="fl-btn" data-open-match="${m.id}">Abrir</button></td>
        </tr>`;
      }).join("");

      content.innerHTML = `
        <div class="fl-card">
          <div style="font-size:30px;font-weight:900;">${team.name}</div>
          <div>Estadio: <b>${team.meta.stadium || '-'}</b> ${team.meta.city?`(${team.meta.city})`:''}</div>
          <div>Capacidad: <b>${team.meta.capacity || '-'}</b></div>
          <div class="fl-row" style="margin-top:8px;">${["RESUMEN","NOTICIAS","RESULTADOS","PARTIDOS","CLASIFICACIÓN","TRASPASOS","PLANTILLA"].map(t=>`<span class="fl-muted" style="padding:4px 6px;border-bottom:${t==='PLANTILLA'?'2px solid #ff3b69':'2px solid transparent'};">${t}</span>`).join("")}</div>
        </div>
        <div class="fl-card fl-row">
          <input id="teamStadium" class="fl-input" placeholder="Estadio" value="${team.meta.stadium || ''}">
          <input id="teamCity" class="fl-input" placeholder="Ciudad" value="${team.meta.city || ''}">
          <input id="teamCapacity" class="fl-input" placeholder="Capacidad" value="${team.meta.capacity || ''}">
          <button class="fl-btn" id="saveMeta">Guardar</button>
          <button class="fl-btn" id="backLiga">Volver a ligas</button>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">Importar plantilla JSON</div>
          <textarea id="squadImport" class="fl-text" placeholder='{"team":{},"squadBySection":[]}'></textarea>
          <div class="fl-row" style="margin-top:8px;"><button class="fl-btn" id="runSquadImport">Importar plantilla</button><span id="squadStatus" class="fl-muted"></span></div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">RESULTADOS (clic para estadísticas)</div>
          <table class="fl-table">
            <thead><tr><th>Fecha</th><th>Liga</th><th>Partido</th><th>Rival</th><th></th></tr></thead>
            <tbody>${matchRows || "<tr><td colspan='5'>Sin partidos todavía</td></tr>"}</tbody>
          </table>
        </div>
        ${sections}
      `;
      document.getElementById("backLiga").onclick = ()=>render("liga");
      document.getElementById("saveMeta").onclick = ()=>{
        team.meta = {
          stadium: document.getElementById("teamStadium").value.trim(),
          city: document.getElementById("teamCity").value.trim(),
          capacity: document.getElementById("teamCapacity").value.trim()
        };
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      document.getElementById("runSquadImport").onclick = ()=>{
        try{
          const raw = document.getElementById("squadImport").value.trim();
          const data = JSON.parse(raw);
          const rows = (data.squadBySection||[]).flatMap(sec=>(sec.rows||[]).map(r=>parseImportedSquadRow(r, sectionToPos(sec.section))));
          if(data.team?.name){
            team.name = String(data.team.name).replace(/^Fútbol:\s*/i,"").replace(/\s*-\s*plantilla$/i,"").trim() || team.name;
          }
          let created=0, updated=0;
          rows.forEach(r=>{
            const name = String(r.name||"").trim();
            if(!name) return;
            let p = db.players.find(x=>x.teamId===team.id && x.name.toLowerCase()===name.toLowerCase());
            if(!p){
              db.players.push({ id: uid("pl"), teamId: team.id, ...r });
              created++;
            }else{
              p.pos = p.pos || r.pos;
              p.number = r.number ?? p.number;
              p.age = r.age ?? p.age;
              p.appearances = r.appearances ?? p.appearances;
              p.minutes = r.minutes ?? p.minutes;
              p.goals = r.goals ?? p.goals;
              p.assists = r.assists ?? p.assists;
              p.yellowCards = r.yellowCards ?? p.yellowCards;
              p.redCards = r.redCards ?? p.redCards;
              p.flag = r.flag || p.flag;
              updated++;
            }
          });
          saveDb(db);
          document.getElementById("squadStatus").textContent = `✅ Importado. Nuevos: ${created}, actualizados: ${updated}`;
          render("equipo", { teamId: team.id });
        }catch(err){
          document.getElementById("squadStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      content.querySelectorAll("[data-open-match]").forEach(btn=>btn.onclick = ()=>{
        render("match", { matchId: btn.getAttribute("data-open-match"), backTeamId: team.id });
      });
      return;
    }

    if(view==="tracker"){
      if(!db.settings.selectedLeagueId && db.leagues[0]) db.settings.selectedLeagueId = db.leagues[0].id;
      const leagueOptions = db.leagues.map(l=>`<option value="${l.id}" ${db.settings.selectedLeagueId===l.id?"selected":""}>${l.name}</option>`).join("");
      const leagueTeams = db.teams.filter(t=>!db.settings.selectedLeagueId || t.leagueId===db.settings.selectedLeagueId);
      const options = leagueTeams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const rows = db.tracker.map(t=>`<tr><td>${t.date||""}</td><td>${db.leagues.find(l=>l.id===t.leagueId)?.name||"-"}</td><td>${db.teams.find(x=>x.id===t.homeId)?.name||"-"}</td><td>${t.homeGoals}-${t.awayGoals}</td><td>${db.teams.find(x=>x.id===t.awayId)?.name||"-"}</td><td>${t.note||""}</td><td><button class="fl-btn" data-open-match="${t.id}">Abrir</button></td></tr>`).join("");
      content.innerHTML = `
        <div class="fl-card"><div class="fl-row">
          <select id="trLeague" class="fl-select"><option value="">Liga</option>${leagueOptions}</select>
          <input id="trDate" type="date" class="fl-input" />
          <select id="trHome" class="fl-select"><option value="">Local</option>${options}</select>
          <input id="trHG" type="number" class="fl-input" placeholder="GL" style="width:74px" />
          <input id="trAG" type="number" class="fl-input" placeholder="GV" style="width:74px" />
          <select id="trAway" class="fl-select"><option value="">Visitante</option>${options}</select>
          <input id="trNote" class="fl-input" placeholder="Nota" />
          <button class="fl-btn" id="addTrack">Guardar</button>
        </div></div>
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Fecha</th><th>Liga</th><th>Local</th><th>Marcador</th><th>Visitante</th><th>Nota</th><th></th></tr></thead><tbody>${rows||"<tr><td colspan='7'>Sin eventos</td></tr>"}</tbody></table></div>
      `;
      document.getElementById("trLeague").onchange = (e)=>{
        db.settings.selectedLeagueId = e.target.value;
        saveDb(db);
        render("tracker");
      };
      document.getElementById("addTrack").onclick = ()=>{
        const homeId = document.getElementById("trHome").value;
        const awayId = document.getElementById("trAway").value;
        if(!homeId || !awayId || homeId===awayId) return;
        db.tracker.push({
          id: uid("tr"),
          leagueId: db.settings.selectedLeagueId || db.teams.find(t=>t.id===homeId)?.leagueId || "",
          date: document.getElementById("trDate").value,
          homeId,
          awayId,
          homeGoals: Number(document.getElementById("trHG").value)||0,
          awayGoals: Number(document.getElementById("trAG").value)||0,
          note: document.getElementById("trNote").value.trim(),
          stats: []
        });
        saveDb(db);
        render("tracker");
      };
      content.querySelectorAll("[data-open-match]").forEach(btn=>btn.onclick = ()=>render("match", { matchId: btn.getAttribute("data-open-match") }));
      return;
    }

    if(view==="match"){
      const match = db.tracker.find(m=>m.id===payload.matchId);
      if(!match){
        content.innerHTML = `<div class="fl-card">Partido no encontrado.</div>`;
        return;
      }
      match.stats ||= [];
      const home = db.teams.find(t=>t.id===match.homeId);
      const away = db.teams.find(t=>t.id===match.awayId);
      const league = db.leagues.find(l=>l.id===match.leagueId);
      const statsHtml = match.stats.length
        ? statsBarsHtml(match.stats)
        : `<div class="fl-muted">Sin estadísticas. Pega JSON para cargar.</div>`;

      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-muted">${league?.name || "Liga"} • ${match.date || "sin fecha"}</div>
          <div style="font-size:28px;font-weight:900;margin-top:4px;">${home?.name || "Local"} ${match.homeGoals}-${match.awayGoals} ${away?.name || "Visitante"}</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Estadísticas</div>
          ${statsHtml}
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">Importar estadísticas JSON</div>
          <textarea id="statsImport" class="fl-text" placeholder='{"stats":[{"key":"Posesión","home":"67%","away":"33%"}]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="saveStats">Guardar estadísticas</button>
            <button class="fl-btn" id="goBackMatch">Volver</button>
            <span id="statsStatus" class="fl-muted"></span>
          </div>
        </div>
      `;

      document.getElementById("saveStats").onclick = ()=>{
        try{
          const stats = parseStatsPayload(document.getElementById("statsImport").value.trim());
          match.stats = stats;
          saveDb(db);
          render("match", payload);
        }catch(err){
          document.getElementById("statsStatus").textContent = `❌ ${String(err.message||err)}`;
        }
      };
      document.getElementById("goBackMatch").onclick = ()=>{
        if(payload.backTeamId) return render("equipo", { teamId: payload.backTeamId });
        render("tracker");
      };
      return;
    }

    if(view==="versus"){
      db.versus ||= { homeAdvantage: 1.1, paceFactor: 1 };
      const options = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      content.innerHTML = `
        <div class="fl-card fl-vs-layout">
          <div>
            <div class="fl-row" style="margin-bottom:8px;">
              <select id="vsHome" class="fl-select"><option value="">Home</option>${options}</select>
              <select id="vsAway" class="fl-select"><option value="">Away</option>${options}</select>
            </div>
            <div class="fl-row" style="margin-bottom:8px;">
              <input id="vsHA" class="fl-input" type="number" step="0.05" value="${db.versus.homeAdvantage}" title="Home Advantage" />
              <input id="vsPace" class="fl-input" type="number" step="0.05" value="${db.versus.paceFactor || 1}" title="Pace Factor" />
              <button class="fl-btn" id="runVs">Simular</button>
            </div>
            <div class="fl-row">
              <input id="vsOddH" class="fl-input" type="number" step="0.01" placeholder="Cuota 1" style="width:120px" />
              <input id="vsOddD" class="fl-input" type="number" step="0.01" placeholder="Cuota X" style="width:120px" />
              <input id="vsOddA" class="fl-input" type="number" step="0.01" placeholder="Cuota 2" style="width:120px" />
            </div>
            <div id="vsOut" style="margin-top:10px;" class="fl-muted">Selecciona dos equipos.</div>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:6px;">Matriz de marcador exacto (0-5)</div>
            <div id="vsMatrix" class="fl-vs-grid"></div>
          </div>
        </div>
      `;

      const renderMatrix = (matrix, best, maxGoals)=>{
        const grid = document.getElementById("vsMatrix");
        if(!grid) return;
        const cells = [];
        cells.push('<div class="fl-vs-cell head">L/A</div>');
        for(let a=0;a<=maxGoals;a++) cells.push(`<div class="fl-vs-cell head">${a}</div>`);
        for(let h=0;h<=maxGoals;h++){
          cells.push(`<div class="fl-vs-cell head">${h}</div>`);
          for(let a=0;a<=maxGoals;a++){
            const hot = best && h===best.h && a===best.a ? "hot" : "";
            cells.push(`<div class="fl-vs-cell ${hot}">${(matrix[h][a]*100).toFixed(1)}%</div>`);
          }
        }
        grid.innerHTML = cells.join("");
      };

      document.getElementById("runVs").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        db.versus.homeAdvantage = Number(document.getElementById("vsHA").value)||1.1;
        db.versus.paceFactor = Number(document.getElementById("vsPace").value)||1;
        saveDb(db);
        if(!homeId || !awayId || homeId===awayId) return;
        const result = versusModel(db, homeId, awayId);
        const market = clean1x2Probs(
          document.getElementById("vsOddH").value,
          document.getElementById("vsOddD").value,
          document.getElementById("vsOddA").value
        );
        const marketLine = market
          ? `<div class="fl-muted" style="margin-top:6px;">Mercado limpio → 1: <b>${(market.pH*100).toFixed(1)}%</b> · X: <b>${(market.pD*100).toFixed(1)}%</b> · 2: <b>${(market.pA*100).toFixed(1)}%</b></div>`
          : "";

        document.getElementById("vsOut").innerHTML = `
          <div>λ Home: <b>${result.lHome.toFixed(2)}</b> · λ Away: <b>${result.lAway.toFixed(2)}</b></div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Home Win</span><b>${(result.pHome*100).toFixed(1)}%</b></div>
            <div><span>Draw</span><b>${(result.pDraw*100).toFixed(1)}%</b></div>
            <div><span>Away Win</span><b>${(result.pAway*100).toFixed(1)}%</b></div>
          </div>
          <div style="margin-top:8px;">Marcador más probable: <b>${result.best.h} - ${result.best.a}</b> (${(result.best.p*100).toFixed(1)}%)</div>
          <div class="fl-muted" style="margin-top:6px;">Forma (últ. ${result.factors.fHome.played}/${result.factors.fAway.played}): local ${result.factors.fHome.attack.toFixed(2)} / visitante ${result.factors.fAway.attack.toFixed(2)}</div>
          ${marketLine}
        `;

        renderMatrix(result.matrix, result.best, result.maxGoals);
      };
    }
  }

  window.__FOOTBALL_LAB__ = {
    open(view="home", payload={}){ render(view, payload); },
    getDB(){ return loadDb(); },
    help: "window.__FOOTBALL_LAB__.open('liga'|'equipo'|'tracker'|'versus')"
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

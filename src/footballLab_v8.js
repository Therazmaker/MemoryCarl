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
    versus: {
      homeAdvantage: 1.1,
      paceFactor: 1,
      sampleSize: 20,
      marketBlend: 0.35,
      matchday: 20,
      tableContextTrust: 0.45,
      tableContext: {}
    },
    predictions: [],
    learning: {
      schemaVersion: 2,
      leagueScale: {},
      teamBias: {},
      metrics: { global: null, byLeague: {} },
      marketTrust: 0.35,
      lrLeague: 0.12,
      lrTeam: 0.08
    }
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
      db.versus.paceFactor = clamp(Number(db.versus.paceFactor) || 1, 0.82, 1.35);
      db.versus.sampleSize = clamp(Number(db.versus.sampleSize) || 20, 5, 40);
      db.versus.marketBlend = clamp(Number(db.versus.marketBlend) || defaultDb.versus.marketBlend, 0, 0.8);
      db.versus.matchday = clamp(Number(db.versus.matchday) || defaultDb.versus.matchday, 1, 50);
      db.versus.tableContextTrust = clamp(Number(db.versus.tableContextTrust) || defaultDb.versus.tableContextTrust, 0, 1);
      db.versus.tableContext ||= {};
      db.predictions ||= [];
      db.learning ||= structuredClone(defaultDb.learning);
      db.learning.schemaVersion = Number(db.learning.schemaVersion) || 2;
      db.learning.leagueScale ||= {};
      db.learning.teamBias ||= {};
      db.learning.metrics ||= { global: null, byLeague: {} };
      db.learning.metrics.byLeague ||= {};
      db.learning.marketTrust = clamp(Number(db.learning.marketTrust) || defaultDb.learning.marketTrust, 0, 0.85);
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
    const sectionStats = Array.isArray(data?.sections)
      ? data.sections.flatMap(section=>(section?.stats||[]).map(stat=>({
        key: stat?.category || stat?.key || stat?.label || stat?.name || stat?.stat || "Métrica",
        home: stat?.home?.main ?? stat?.home?.raw ?? stat?.home,
        away: stat?.away?.main ?? stat?.away?.raw ?? stat?.away
      })))
      : [];
    const list = Array.isArray(data)
      ? data
      : sectionStats.length ? sectionStats
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

  function openStatsModal({ db, match, onSave } = {}){
    if(!match) return;
    const backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
    backdrop.innerHTML = `
      <div class="fl-card" style="width:min(860px,100%);max-height:90vh;overflow:auto;">
        <div class="fl-row" style="justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:900;">Estadísticas del partido</div>
          <button class="fl-btn" id="closeStatsModal">Cerrar</button>
        </div>
        <div class="fl-muted" style="margin-bottom:8px;">Pega JSON con formato <code>stats</code>, <code>statistics</code> o <code>sections[].stats[]</code>.</div>
        <textarea id="statsImportModal" class="fl-text" placeholder='{"kind":"match_stats","sections":[{"section":"Estadísticas principales","stats":[{"category":"Posesión","home":{"main":"67%"},"away":{"main":"33%"}}]}]}'></textarea>
        <div class="fl-row" style="margin-top:8px;">
          <button class="fl-btn" id="saveStatsModal">Guardar estadísticas</button>
          <span id="statsModalStatus" class="fl-muted"></span>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = ()=>backdrop.remove();
    backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) close(); });
    backdrop.querySelector("#closeStatsModal").onclick = close;
    backdrop.querySelector("#saveStatsModal").onclick = ()=>{
      const status = backdrop.querySelector("#statsModalStatus");
      try{
        const stats = parseStatsPayload(backdrop.querySelector("#statsImportModal").value.trim());
        match.stats = stats;
        saveDb(db);
        status.textContent = `✅ Guardado (${stats.length} métricas)`;
        onSave?.();
        setTimeout(close, 500);
      }catch(err){
        status.textContent = `❌ ${String(err.message||err)}`;
      }
    };
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

  function normalizeStatKey(key){
    return String(key || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  }

  function statNumberFromSide(raw){
    if(raw===null || raw===undefined) return null;
    const clean = String(raw).replace("%", "").replace(",", ".").trim();
    if(!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  function metricFromStats(stats, patterns, side){
    if(!Array.isArray(stats) || !stats.length) return null;
    for(const item of stats){
      const key = normalizeStatKey(item?.key);
      if(!patterns.some(pattern=>key.includes(pattern))) continue;
      const value = statNumberFromSide(side==="home" ? item?.home : item?.away);
      if(Number.isFinite(value)) return value;
    }
    return null;
  }

  function tableContextForTeam({ teamContext, matchday, isHome }){
    const pos = clamp(Number(teamContext?.pos) || 10, 1, 20);
    const objective = pickFirstString(teamContext?.objective, "mid").toLowerCase();
    const phase = matchday>=28 ? "late" : matchday>=12 ? "mid" : "early";
    const relegationZone = pos>=18;
    const titleZone = pos<=3;
    let pressure = 0.18 + (phase==="late" ? 0.18 : phase==="mid" ? 0.08 : 0);
    if(relegationZone) pressure += phase==="late" ? 0.48 : 0.28;
    if(titleZone) pressure += phase==="late" ? 0.3 : 0.18;
    if(objective==="relegation" || objective==="survival") pressure += 0.14;
    if(objective==="title" || objective==="europe") pressure += 0.12;
    if(objective==="mid") pressure -= 0.05;

    let riskMode = 0;
    if(relegationZone) riskMode += isHome ? 0.2 : -0.1;
    if(titleZone) riskMode += isHome ? 0.1 : -0.2;
    if(objective==="cupfocus") riskMode -= 0.2;
    if(objective==="relegation") riskMode += isHome ? 0.15 : -0.05;
    if(phase==="late") riskMode += pressure>0.55 ? -0.05 : 0;

    return {
      pos,
      objective,
      pressure: clamp(pressure, 0, 1),
      riskMode: clamp(riskMode, -1, 1),
      phase
    };
  }

  function applyDrawBoostToMatrix(matrix, drawBoost){
    const safeBoost = clamp(Number(drawBoost) || 0, 0, 0.25);
    const adjusted = matrix.map((row, h)=>row.map((cell, a)=>{
      if(h!==a) return cell;
      return cell * (1 + safeBoost);
    }));
    let total = 0;
    adjusted.forEach(row=>row.forEach(p=>{ total += p; }));
    if(!(total>0)) return matrix;
    return adjusted.map(row=>row.map(p=>p/total));
  }

  function summarizeMatrix(matrix){
    let pHome = 0, pDraw = 0, pAway = 0;
    let best = { h: 0, a: 0, p: 0 };
    for(let h=0; h<matrix.length; h++){
      for(let a=0; a<matrix[h].length; a++){
        const p = matrix[h][a];
        if(h>a) pHome += p;
        else if(h===a) pDraw += p;
        else pAway += p;
        if(p>best.p) best = { h, a, p };
      }
    }
    return { pHome, pDraw, pAway, best };
  }

  function weightedAverage(items, valueFn, decay=0.9){
    if(!items.length) return null;
    let weighted = 0;
    let totalWeight = 0;
    const ordered = items.slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
    ordered.forEach((item, idx)=>{
      const value = Number(valueFn(item));
      if(!Number.isFinite(value)) return;
      const weight = decay ** (ordered.length - idx - 1);
      weighted += value * weight;
      totalWeight += weight;
    });
    return totalWeight>0 ? weighted/totalWeight : null;
  }

  function listLeagueMatches(db, leagueId, limit=140){
    return db.tracker
      .filter(m=>!leagueId || m.leagueId===leagueId)
      .slice(-limit);
  }

  function leagueContextFromTracker(db, leagueId){
    const matches = listLeagueMatches(db, leagueId, 180);
    if(!matches.length){
      return {
        matches: 0,
        avgGoalsHome: 1.35,
        avgGoalsAway: 1.15,
        avgCornersTotal: 9.2,
        avgCardsTotal: 4.4
      };
    }
    const avg = (getter, fallback=0)=>{
      const vals = matches.map(getter).filter(v=>Number.isFinite(v));
      if(!vals.length) return fallback;
      return vals.reduce((a,b)=>a+b,0)/vals.length;
    };
    const cornersAvg = avg(m=>{
      const h = pickFirstNumber(m.homeCorners, m.cornersHome, m.corners?.home);
      const a = pickFirstNumber(m.awayCorners, m.cornersAway, m.corners?.away);
      return Number.isFinite(h) && Number.isFinite(a) ? h+a : NaN;
    }, 9.2);
    const cardsAvg = avg(m=>{
      const hy = pickFirstNumber(m.homeYellow, m.cardsHomeYellow, m.cards?.homeYellow, 0) || 0;
      const ay = pickFirstNumber(m.awayYellow, m.cardsAwayYellow, m.cards?.awayYellow, 0) || 0;
      const hr = pickFirstNumber(m.homeRed, m.cardsHomeRed, m.cards?.homeRed, 0) || 0;
      const ar = pickFirstNumber(m.awayRed, m.cardsAwayRed, m.cards?.awayRed, 0) || 0;
      return hy + ay + (hr + ar) * 1.6;
    }, 4.4);

    return {
      matches: matches.length,
      avgGoalsHome: avg(m=>Number(m.homeGoals)||0, 1.35),
      avgGoalsAway: avg(m=>Number(m.awayGoals)||0, 1.15),
      avgCornersTotal: cornersAvg,
      avgCardsTotal: cardsAvg
    };
  }

  function teamAnalytics(db, teamId, leagueId, limit=20){
    const games = db.tracker
      .filter(g=>(g.homeId===teamId || g.awayId===teamId) && (!leagueId || g.leagueId===leagueId))
      .slice(-limit);
    const homeGames = games.filter(g=>g.homeId===teamId);
    const awayGames = games.filter(g=>g.awayId===teamId);

    const avgSide = (list, forKey, againstKey, fallbackFor, fallbackAgainst)=>{
      const forWeighted = weightedAverage(list, g=>pickFirstNumber(g[forKey], g[fallbackFor]), 0.9);
      const againstWeighted = weightedAverage(list, g=>pickFirstNumber(g[againstKey], g[fallbackAgainst]), 0.9);
      return {
        for: Number.isFinite(forWeighted) ? forWeighted : 0,
        against: Number.isFinite(againstWeighted) ? againstWeighted : 0,
        played: list.length
      };
    };

    const goalsHome = avgSide(homeGames, "homeGoals", "awayGoals");
    const goalsAway = avgSide(awayGames, "awayGoals", "homeGoals");
    const xgHome = avgSide(homeGames, "homeXg", "awayXg", "xgHome", "xgAway");
    const xgAway = avgSide(awayGames, "awayXg", "homeXg", "xgAway", "xgHome");

    const cornersFor = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      return pickFirstNumber(isHome ? g.homeCorners : g.awayCorners, isHome ? g.cornersHome : g.cornersAway);
    }, 0.9) || 0;
    const cornersAgainst = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      return pickFirstNumber(isHome ? g.awayCorners : g.homeCorners, isHome ? g.cornersAway : g.cornersHome);
    }, 0.9) || 0;
    const cardsRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const y = pickFirstNumber(isHome ? g.homeYellow : g.awayYellow, 0) || 0;
      const r = pickFirstNumber(isHome ? g.homeRed : g.awayRed, 0) || 0;
      return y + r*1.6;
    }, 0.88) || 0;

    const statsAttackRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const side = isHome ? "home" : "away";
      const shotsOnTarget = metricFromStats(g.stats, ["shots on target", "tiros a puerta", "remates a puerta"], side);
      const dangerous = metricFromStats(g.stats, ["big chances", "ocasiones", "ataques peligrosos"], side);
      const poss = metricFromStats(g.stats, ["possession", "posesion"], side);
      const values = [
        Number.isFinite(shotsOnTarget) ? shotsOnTarget * 0.12 : null,
        Number.isFinite(dangerous) ? dangerous * 0.06 : null,
        Number.isFinite(poss) ? poss / 100 : null
      ].filter(v=>Number.isFinite(v));
      if(!values.length) return null;
      return values.reduce((a,b)=>a+b,0)/values.length;
    }, 0.9);

    const statsDefenseRate = weightedAverage(games, g=>{
      const isHome = g.homeId===teamId;
      const oppSide = isHome ? "away" : "home";
      const oppShotsOnTarget = metricFromStats(g.stats, ["shots on target", "tiros a puerta", "remates a puerta"], oppSide);
      const oppDangerous = metricFromStats(g.stats, ["big chances", "ocasiones", "ataques peligrosos"], oppSide);
      const values = [
        Number.isFinite(oppShotsOnTarget) ? oppShotsOnTarget * 0.12 : null,
        Number.isFinite(oppDangerous) ? oppDangerous * 0.06 : null
      ].filter(v=>Number.isFinite(v));
      if(!values.length) return null;
      return values.reduce((a,b)=>a+b,0)/values.length;
    }, 0.9);

    const form5Games = games.slice(-5);
    let formPts = 0, formGF = 0, formGA = 0;
    form5Games.forEach(g=>{
      const isHome = g.homeId===teamId;
      const gf = isHome ? Number(g.homeGoals)||0 : Number(g.awayGoals)||0;
      const ga = isHome ? Number(g.awayGoals)||0 : Number(g.homeGoals)||0;
      formGF += gf;
      formGA += ga;
      formPts += gf>ga ? 3 : gf===ga ? 1 : 0;
    });

    return {
      sample: games.length,
      goalsHome,
      goalsAway,
      xgHome,
      xgAway,
      cornersFor,
      cornersAgainst,
      cardsRate,
      statsImpact: {
        attack: Number.isFinite(statsAttackRate) ? clamp(0.88 + statsAttackRate * 0.35, 0.78, 1.35) : 1,
        defenseWeakness: Number.isFinite(statsDefenseRate) ? clamp(0.85 + statsDefenseRate * 0.4, 0.72, 1.38) : 1,
        sample: games.filter(g=>Array.isArray(g.stats) && g.stats.length>0).length
      },
      form5: {
        played: form5Games.length,
        points: formPts,
        gf: formGF,
        ga: formGA,
        gd: formGF - formGA
      }
    };
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function ensureLearningState(db){
    db.learning ||= structuredClone(defaultDb.learning);
    db.learning.schemaVersion = Number(db.learning.schemaVersion) || 2;
    db.learning.leagueScale ||= {};
    db.learning.teamBias ||= {};
    db.learning.metrics ||= { global: null, byLeague: {} };
    db.learning.metrics.byLeague ||= {};
    db.predictions ||= [];
  }

  function createMetricState(){
    return {
      nMatches: 0,
      avgLogLoss: 0,
      brierScore: 0,
      avgGoalErrorHome: 0,
      avgGoalErrorAway: 0
    };
  }

  function rollingAverage(prevAvg, n, value){
    return ((prevAvg * n) + value) / (n + 1);
  }

  function updateMetricState(target, { logLoss, brier, errHome, errAway }){
    const state = target || createMetricState();
    const n = Number(state.nMatches) || 0;
    state.avgLogLoss = rollingAverage(Number(state.avgLogLoss) || 0, n, logLoss);
    state.brierScore = rollingAverage(Number(state.brierScore) || 0, n, brier);
    state.avgGoalErrorHome = rollingAverage(Number(state.avgGoalErrorHome) || 0, n, Math.abs(errHome));
    state.avgGoalErrorAway = rollingAverage(Number(state.avgGoalErrorAway) || 0, n, Math.abs(errAway));
    state.nMatches = n + 1;
    return state;
  }

  function getLeagueScale(db, leagueId){
    ensureLearningState(db);
    const raw = db.learning.leagueScale[leagueId] || {};
    return {
      home: clamp(Number(raw.home) || 1, 0.75, 1.35),
      away: clamp(Number(raw.away) || 1, 0.75, 1.35)
    };
  }

  function getTeamBias(db, teamId){
    ensureLearningState(db);
    const raw = db.learning.teamBias[teamId] || {};
    return {
      attack: clamp(Number(raw.attack) || 0, -0.35, 0.35),
      defense: clamp(Number(raw.defense) || 0, -0.35, 0.35)
    };
  }

  function topScoreCells(matrix, topN=3){
    const cells = [];
    for(let h=0;h<matrix.length;h++){
      for(let a=0;a<matrix[h].length;a++) cells.push({ h, a, p: matrix[h][a] });
    }
    return cells.sort((a,b)=>b.p-a.p).slice(0, topN);
  }

  function bttsProbability(matrix){
    let sum = 0;
    for(let h=1;h<matrix.length;h++){
      for(let a=1;a<matrix[h].length;a++) sum += matrix[h][a];
    }
    return sum;
  }

  function updateLearningFromResult(db, prediction, result){
    ensureLearningState(db);
    const leagueId = prediction.leagueId || "global";
    const lrLeague = clamp(Number(db.learning.lrLeague) || 0.12, 0.01, 0.35);
    const lrTeam = clamp(Number(db.learning.lrTeam) || 0.08, 0.01, 0.25);
    const leagueScaleBefore = getLeagueScale(db, leagueId);
    const leagueScale = { ...leagueScaleBefore };

    const confidence = Math.max(Number(prediction.pHome) || 0, Number(prediction.pDraw) || 0, Number(prediction.pAway) || 0);
    const recencyDays = Math.max(0, (Date.now() - new Date(prediction.createdAt || prediction.updatedAt || Date.now()).getTime()) / 86400000);
    const recencyWeight = clamp(Math.exp(-recencyDays / 240), 0.45, 1);

    const xgHome = pickFirstNumber(result.xgHome, result.homeXg, result.expectedHomeGoals);
    const xgAway = pickFirstNumber(result.xgAway, result.awayXg, result.expectedAwayGoals);
    const targetHome = xgHome ?? result.homeGoals;
    const targetAway = xgAway ?? result.awayGoals;
    const xgDistance = (xgHome===null || xgAway===null)
      ? 0
      : (Math.abs(result.homeGoals - xgHome) + Math.abs(result.awayGoals - xgAway)) / 2;
    const xgTrust = xgHome===null || xgAway===null ? 1 : clamp(1 - xgDistance*0.12, 0.65, 1.05);

    const lrEffectiveLeague = lrLeague * (0.5 + confidence) * recencyWeight * xgTrust;
    const lrEffectiveTeam = lrTeam * (0.5 + confidence) * recencyWeight * xgTrust;

    const ratioHome = clamp((targetHome + 0.25) / Math.max(0.25, prediction.lambdaHome), 0.75, 1.25);
    const ratioAway = clamp((targetAway + 0.25) / Math.max(0.25, prediction.lambdaAway), 0.75, 1.25);
    leagueScale.home = clamp(leagueScale.home * (1 - lrEffectiveLeague + lrEffectiveLeague * ratioHome), 0.75, 1.35);
    leagueScale.away = clamp(leagueScale.away * (1 - lrEffectiveLeague + lrEffectiveLeague * ratioAway), 0.75, 1.35);
    db.learning.leagueScale[leagueId] = leagueScale;

    const homeBiasBefore = getTeamBias(db, prediction.homeId);
    const awayBiasBefore = getTeamBias(db, prediction.awayId);
    const homeBias = { ...homeBiasBefore };
    const awayBias = { ...awayBiasBefore };
    const homeErr = clamp(targetHome - prediction.lambdaHome, -1.6, 1.6);
    const awayErr = clamp(targetAway - prediction.lambdaAway, -1.6, 1.6);

    homeBias.attack = clamp(homeBias.attack + homeErr * lrEffectiveTeam * 0.09, -0.35, 0.35);
    homeBias.defense = clamp(homeBias.defense - awayErr * lrEffectiveTeam * 0.06, -0.35, 0.35);
    awayBias.attack = clamp(awayBias.attack + awayErr * lrEffectiveTeam * 0.09, -0.35, 0.35);
    awayBias.defense = clamp(awayBias.defense - homeErr * lrEffectiveTeam * 0.06, -0.35, 0.35);

    db.learning.teamBias[prediction.homeId] = homeBias;
    db.learning.teamBias[prediction.awayId] = awayBias;

    const actual = result.homeGoals===result.awayGoals ? "draw" : result.homeGoals>result.awayGoals ? "home" : "away";
    const pActual = actual==="home" ? prediction.pHome : actual==="draw" ? prediction.pDraw : prediction.pAway;
    const logLoss = -Math.log(Math.max(1e-9, pActual));
    const brier = ((prediction.pHome - (actual==="home" ? 1 : 0))**2
      + (prediction.pDraw - (actual==="draw" ? 1 : 0))**2
      + (prediction.pAway - (actual==="away" ? 1 : 0))**2) / 3;

    db.learning.metrics.global = updateMetricState(db.learning.metrics.global, {
      logLoss,
      brier,
      errHome: result.homeGoals - prediction.lambdaHome,
      errAway: result.awayGoals - prediction.lambdaAway
    });
    db.learning.metrics.byLeague[leagueId] = updateMetricState(db.learning.metrics.byLeague[leagueId], {
      logLoss,
      brier,
      errHome: result.homeGoals - prediction.lambdaHome,
      errAway: result.awayGoals - prediction.lambdaAway
    });

    return {
      homeErr,
      awayErr,
      logLoss,
      brier,
      confidence,
      lrEffectiveLeague,
      lrEffectiveTeam,
      leagueScale,
      leagueScaleBefore,
      homeBias,
      awayBias,
      homeBiasBefore,
      awayBiasBefore,
      metricsGlobal: db.learning.metrics.global,
      metricsLeague: db.learning.metrics.byLeague[leagueId]
    };
  }

  function calibrateToMarket(base, marketProb, modelProb){
    if(!Number.isFinite(marketProb) || !Number.isFinite(modelProb) || !modelProb || !base) return base;
    const ratio = clamp(marketProb/modelProb, 0.82, 1.22);
    return base * ratio;
  }

  function probsFromLambdas(lHome, lAway, maxGoals=5){
    const matrix = [];
    let pHome=0,pDraw=0,pAway=0,pTotal=0;
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
    return { matrix, pHome, pDraw, pAway, maxGoals, best };
  }

  function versusModel(db, homeId, awayId, opts={}){
    ensureLearningState(db);
    db.versus ||= {};
    db.versus.tableContext ||= {};
    const homeTeam = db.teams.find(t=>t.id===homeId);
    const awayTeam = db.teams.find(t=>t.id===awayId);
    const leagueId = opts.leagueId || homeTeam?.leagueId || awayTeam?.leagueId || "";

    const leagueCtx = leagueContextFromTracker(db, leagueId);
    const homeForm = teamFormFromTracker(db, homeId);
    const awayForm = teamFormFromTracker(db, awayId);
    const homeData = teamAnalytics(db, homeId, leagueId, Number(db.versus.sampleSize)||20);
    const awayData = teamAnalytics(db, awayId, leagueId, Number(db.versus.sampleSize)||20);

    const homeStrength = teamStrength(db, homeId);
    const awayStrength = teamStrength(db, awayId);
    const homeAdv = Number(db.versus.homeAdvantage)||1.1;
    const pace = clamp(Number(db.versus.paceFactor)||1, 0.82, 1.35);
    const leagueScale = getLeagueScale(db, leagueId);
    const homeBias = getTeamBias(db, homeId);
    const awayBias = getTeamBias(db, awayId);

    const baseHomeFor = homeData.xgHome.for>0 ? homeData.xgHome.for : homeData.goalsHome.for;
    const baseHomeAgainst = homeData.xgHome.against>0 ? homeData.xgHome.against : homeData.goalsHome.against;
    const baseAwayFor = awayData.xgAway.for>0 ? awayData.xgAway.for : awayData.goalsAway.for;
    const baseAwayAgainst = awayData.xgAway.against>0 ? awayData.xgAway.against : awayData.goalsAway.against;

    const attackHome = clamp((baseHomeFor || leagueCtx.avgGoalsHome) / Math.max(0.35, leagueCtx.avgGoalsHome), 0.55, 1.9);
    const defenseAwayWeakness = clamp((baseAwayAgainst || leagueCtx.avgGoalsHome) / Math.max(0.35, leagueCtx.avgGoalsHome), 0.55, 1.9);
    const attackAway = clamp((baseAwayFor || leagueCtx.avgGoalsAway) / Math.max(0.35, leagueCtx.avgGoalsAway), 0.55, 1.9);
    const defenseHomeWeakness = clamp((baseHomeAgainst || leagueCtx.avgGoalsAway) / Math.max(0.35, leagueCtx.avgGoalsAway), 0.55, 1.9);

    let lHome = leagueCtx.avgGoalsHome * attackHome * defenseAwayWeakness;
    let lAway = leagueCtx.avgGoalsAway * attackAway * defenseHomeWeakness;

    lHome *= leagueScale.home * (1 + homeBias.attack) * (1 - awayBias.defense);
    lAway *= leagueScale.away * (1 + awayBias.attack) * (1 - homeBias.defense);

    const statsHome = homeData.statsImpact || { attack: 1, defenseWeakness: 1, sample: 0 };
    const statsAway = awayData.statsImpact || { attack: 1, defenseWeakness: 1, sample: 0 };

    lHome *= homeAdv * pace * homeStrength * homeForm.momentum;
    lAway *= pace * awayStrength * awayForm.momentum;

    lHome *= statsHome.attack * statsAway.defenseWeakness;
    lAway *= statsAway.attack * statsHome.defenseWeakness;

    lHome = clamp(lHome, 0.05, 4.5);
    lAway = clamp(lAway, 0.05, 4.5);

    const tableContextRaw = db.versus.tableContext || {};
    const matchday = clamp(Number(opts.matchday ?? db.versus.matchday ?? 20) || 20, 1, 50);
    const homeContext = tableContextForTeam({ teamContext: tableContextRaw[homeId], matchday, isHome: true });
    const awayContext = tableContextForTeam({ teamContext: tableContextRaw[awayId], matchday, isHome: false });
    const trust = clamp(Number(opts.tableContextTrust ?? db.versus.tableContextTrust ?? 0.45) || 0.45, 0, 1);
    const drawBoostBase = ((homeContext.pressure + awayContext.pressure) / 2) * 0.14
      + (Math.max(0, -homeContext.riskMode) + Math.max(0, -awayContext.riskMode)) * 0.08;
    const drawBoost = clamp(drawBoostBase * trust, 0, 0.25);

    const dist = probsFromLambdas(lHome, lAway, 5);
    dist.matrix = applyDrawBoostToMatrix(dist.matrix, drawBoost);
    const distSummary = summarizeMatrix(dist.matrix);
    dist.pHome = distSummary.pHome;
    dist.pDraw = distSummary.pDraw;
    dist.pAway = distSummary.pAway;
    dist.best = distSummary.best;

    const cardsExpected = clamp((homeData.cardsRate + awayData.cardsRate + leagueCtx.avgCardsTotal)/2, 1.8, 8.8);
    const cornersExpected = clamp(
      (homeData.cornersFor + awayData.cornersAgainst + homeData.cornersAgainst + awayData.cornersFor + leagueCtx.avgCornersTotal) / 3,
      5.5,
      15.5
    );

    return {
      lHome,
      lAway,
      pHome: dist.pHome,
      pDraw: dist.pDraw,
      pAway: dist.pAway,
      matrix: dist.matrix,
      maxGoals: dist.maxGoals,
      best: dist.best,
      cardsExpected,
      cornersExpected,
      leagueCtx,
      teams: { homeData, awayData },
      factors: {
        homeForm,
        awayForm,
        pace,
        homeAdv,
        attackHome,
        attackAway,
        defenseAwayWeakness,
        defenseHomeWeakness,
        leagueScale,
        teamBias: { homeBias, awayBias },
        breakdown: {
          leagueBase: { home: leagueCtx.avgGoalsHome, away: leagueCtx.avgGoalsAway },
          homeAttackBoost: attackHome,
          awayDefenseWeakness: defenseAwayWeakness,
          awayAttackPenalty: attackAway,
          marketMultiplier: 1,
          homeDefenseStrength: defenseHomeWeakness,
          homeFormMomentum: homeForm.momentum,
          awayFormMomentum: awayForm.momentum,
          statsAttackHome: statsHome.attack,
          statsAttackAway: statsAway.attack,
          statsSample: { home: statsHome.sample, away: statsAway.sample },
          tableFactorGoals: {
            homeRisk: homeContext.riskMode,
            awayRisk: awayContext.riskMode,
            homePressure: homeContext.pressure,
            awayPressure: awayContext.pressure,
            matchday
          },
          drawBoost,
          tableContextTrust: trust,
          leagueScale,
          teamBias: { home: homeBias, away: awayBias }
        }
      },
      tableContext: { home: homeContext, away: awayContext, drawBoost, matchday, trust }
    };
  }

  function sanitizeFiniteNumber(value, fallback){
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeLearning(rawLearning){
    const learning = rawLearning && typeof rawLearning === "object" ? structuredClone(rawLearning) : {};
    learning.schemaVersion = Number(learning.schemaVersion) || 2;
    learning.leagueScale ||= {};
    learning.teamBias ||= {};
    learning.metrics ||= { global: null, byLeague: {} };
    learning.metrics.byLeague ||= {};
    learning.marketTrust = clamp(sanitizeFiniteNumber(learning.marketTrust, 0.35), 0, 0.85);
    learning.lrLeague = clamp(sanitizeFiniteNumber(learning.lrLeague, 0.12), 0.01, 0.35);
    learning.lrTeam = clamp(sanitizeFiniteNumber(learning.lrTeam, 0.08), 0.01, 0.25);
    Object.keys(learning.leagueScale).forEach((leagueId)=>{
      const item = learning.leagueScale[leagueId] || {};
      learning.leagueScale[leagueId] = {
        home: clamp(sanitizeFiniteNumber(item.home, 1), 0.75, 1.35),
        away: clamp(sanitizeFiniteNumber(item.away, 1), 0.75, 1.35)
      };
    });
    Object.keys(learning.teamBias).forEach((teamId)=>{
      const item = learning.teamBias[teamId] || {};
      learning.teamBias[teamId] = {
        attack: clamp(sanitizeFiniteNumber(item.attack, 0), -0.35, 0.35),
        defense: clamp(sanitizeFiniteNumber(item.defense, 0), -0.35, 0.35)
      };
    });
    return learning;
  }

  function normalizeImport(raw){
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const root = data?.liga ? data : data?.league ? { liga: data.league, ...data } : data;
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
        rating: clamp(sanitizeFiniteNumber(p.rating, 5), 1, 10)
      }))
    ]));

    const flatTeams = teams.map(x=>x[0]);
    const players = teams.flatMap(x=>x[1].map(p=>({ ...p, teamId: p.teamId || x[0].id })));
    const predictions = Array.isArray(root.predictions) ? root.predictions.filter(Boolean).map((pred)=>({
      ...pred,
      id: pred.id || uid("pred"),
      createdAt: pred.createdAt || new Date().toISOString(),
      lambdaHome: clamp(sanitizeFiniteNumber(pred.lambdaHome, 1.2), 0.05, 4.5),
      lambdaAway: clamp(sanitizeFiniteNumber(pred.lambdaAway, 1), 0.05, 4.5),
      pHome: clamp(sanitizeFiniteNumber(pred.pHome, 0.33), 0, 1),
      pDraw: clamp(sanitizeFiniteNumber(pred.pDraw, 0.34), 0, 1),
      pAway: clamp(sanitizeFiniteNumber(pred.pAway, 0.33), 0, 1),
      resolved: Boolean(pred.resolved)
    })) : [];

    return {
      league: { id: leagueId, name: leagueName, code: leagueCode },
      teams: flatTeams,
      players,
      tracker: Array.isArray(root.tracker) ? root.tracker : [],
      versus: root.versus || null,
      predictions,
      learning: normalizeLearning(root.learning)
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
          if(Array.isArray(parsed.predictions) && parsed.predictions.length) db.predictions = [...db.predictions, ...parsed.predictions];
          if(parsed.learning){
            db.learning = normalizeLearning({
              ...db.learning,
              ...parsed.learning,
              leagueScale: { ...(db.learning?.leagueScale||{}), ...(parsed.learning.leagueScale||{}) },
              teamBias: { ...(db.learning?.teamBias||{}), ...(parsed.learning.teamBias||{}) },
              metrics: {
                global: parsed.learning.metrics?.global || db.learning?.metrics?.global || null,
                byLeague: { ...(db.learning?.metrics?.byLeague||{}), ...(parsed.learning.metrics?.byLeague||{}) }
              }
            });
          }
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
      const rows = leagueTeams.map(t=>`<tr><td><input class="fl-input" data-edit-team-name="${t.id}" value="${t.name}"></td><td><input class="fl-input" data-edit-team-api="${t.id}" value="${t.apiTeamId||""}"></td><td><button class="fl-btn" data-save-team="${t.id}">Guardar</button></td></tr>`).join("");
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
        <div class="fl-card"><table class="fl-table"><thead><tr><th>Equipo (editable)</th><th>API ID</th><th></th></tr></thead><tbody>${rows||"<tr><td colspan='3'>Sin equipos</td></tr>"}</tbody></table></div>
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
      content.querySelectorAll("[data-save-team]").forEach(btn=>btn.onclick = ()=>{
        const teamId = btn.getAttribute("data-save-team");
        const team = db.teams.find(t=>t.id===teamId);
        if(!team) return;
        const name = content.querySelector(`[data-edit-team-name="${teamId}"]`)?.value.trim();
        const apiTeamId = content.querySelector(`[data-edit-team-api="${teamId}"]`)?.value.trim();
        if(name) team.name = name;
        team.apiTeamId = apiTeamId || "";
        saveDb(db);
        render("equipos");
      });
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
          <td class="fl-row" style="gap:6px;">
            <button class="fl-btn" data-open-stats-modal="${m.id}">Estadísticas</button>
            <button class="fl-btn" data-edit-match="${m.id}">Editar</button>
            <button class="fl-btn" data-delete-match="${m.id}">Borrar</button>
          </td>
        </tr>`;
      }).join("");
      const resultTeamOptions = db.teams
        .filter(t=>t.leagueId===team.leagueId)
        .map(t=>`<option value="${t.id}" ${t.id===team.id?"selected":""}>${t.name}</option>`)
        .join("");

      content.innerHTML = `
        <div class="fl-card">
          <div class="fl-row" style="justify-content:space-between;align-items:center;gap:10px;">
            <div style="font-size:30px;font-weight:900;">${team.name}</div>
            <button class="fl-btn" id="editTeamName">Editar nombre</button>
          </div>
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
          <div class="fl-row" style="margin-bottom:10px;">
            <input id="resDate" type="date" class="fl-input" />
            <select id="resHome" class="fl-select"><option value="">Local</option>${resultTeamOptions}</select>
            <input id="resHG" type="number" class="fl-input" placeholder="GL" style="width:74px" />
            <input id="resAG" type="number" class="fl-input" placeholder="GV" style="width:74px" />
            <select id="resAway" class="fl-select"><option value="">Visitante</option>${resultTeamOptions}</select>
            <button class="fl-btn" id="addResult">Guardar partido</button>
            <span id="resultStatus" class="fl-muted"></span>
          </div>
          <table class="fl-table">
            <thead><tr><th>Fecha</th><th>Liga</th><th>Partido</th><th>Rival</th><th>Acciones</th></tr></thead>
            <tbody>${matchRows || "<tr><td colspan='5'>Sin partidos todavía</td></tr>"}</tbody>
          </table>
        </div>
        ${sections}
      `;
      document.getElementById("editTeamName").onclick = ()=>{
        const name = prompt("Nuevo nombre del equipo", team.name);
        const nextName = String(name||"").trim();
        if(!nextName) return;
        team.name = nextName;
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
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
      document.getElementById("addResult").onclick = ()=>{
        const homeId = document.getElementById("resHome").value;
        const awayId = document.getElementById("resAway").value;
        const status = document.getElementById("resultStatus");
        if(!homeId || !awayId || homeId===awayId){
          status.textContent = "Selecciona local y visitante distintos.";
          return;
        }
        db.tracker.push({
          id: uid("tr"),
          leagueId: team.leagueId || db.settings.selectedLeagueId || "",
          date: document.getElementById("resDate").value,
          homeId,
          awayId,
          homeGoals: Number(document.getElementById("resHG").value)||0,
          awayGoals: Number(document.getElementById("resAG").value)||0,
          note: "",
          stats: []
        });
        saveDb(db);
        render("equipo", { teamId: team.id });
      };
      content.querySelectorAll("[data-open-stats-modal]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-open-stats-modal"));
        openStatsModal({ db, match, onSave: ()=>render("equipo", { teamId: team.id }) });
      });
      content.querySelectorAll("[data-edit-match]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-edit-match"));
        if(!match) return;
        const date = prompt("Fecha del partido (YYYY-MM-DD)", match.date || "") || match.date || "";
        const homeGoals = prompt("Goles del local", String(match.homeGoals ?? 0));
        const awayGoals = prompt("Goles del visitante", String(match.awayGoals ?? 0));
        if(homeGoals===null || awayGoals===null) return;
        match.date = String(date).trim();
        match.homeGoals = Number(homeGoals)||0;
        match.awayGoals = Number(awayGoals)||0;
        saveDb(db);
        render("equipo", { teamId: team.id });
      });
      content.querySelectorAll("[data-delete-match]").forEach(btn=>btn.onclick = ()=>{
        const matchId = btn.getAttribute("data-delete-match");
        const match = db.tracker.find(m=>m.id===matchId);
        if(!match) return;
        if(!confirm("¿Borrar este partido?")) return;
        db.tracker = db.tracker.filter(m=>m.id!==matchId);
        saveDb(db);
        render("equipo", { teamId: team.id });
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
        </div>
        <div class="fl-row" style="margin-top:8px;">
          <input id="trHXg" type="number" step="0.01" class="fl-input" placeholder="xG L" style="width:84px" />
          <input id="trAXg" type="number" step="0.01" class="fl-input" placeholder="xG V" style="width:84px" />
          <input id="trHC" type="number" class="fl-input" placeholder="Corners L" style="width:94px" />
          <input id="trAC" type="number" class="fl-input" placeholder="Corners V" style="width:94px" />
          <input id="trHY" type="number" class="fl-input" placeholder="Amarillas L" style="width:104px" />
          <input id="trAY" type="number" class="fl-input" placeholder="Amarillas V" style="width:104px" />
          <input id="trRefCards" type="number" step="0.1" class="fl-input" placeholder="Tarjetas árbitro" style="width:130px" />
          <input id="trOddH" type="number" step="0.01" class="fl-input" placeholder="Cuota 1" style="width:84px" />
          <input id="trOddD" type="number" step="0.01" class="fl-input" placeholder="Cuota X" style="width:84px" />
          <input id="trOddA" type="number" step="0.01" class="fl-input" placeholder="Cuota 2" style="width:84px" />
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
          homeXg: pickFirstNumber(document.getElementById("trHXg").value),
          awayXg: pickFirstNumber(document.getElementById("trAXg").value),
          homeCorners: pickFirstNumber(document.getElementById("trHC").value),
          awayCorners: pickFirstNumber(document.getElementById("trAC").value),
          homeYellow: pickFirstNumber(document.getElementById("trHY").value),
          awayYellow: pickFirstNumber(document.getElementById("trAY").value),
          refereeCardsAvg: pickFirstNumber(document.getElementById("trRefCards").value),
          oddsHome: pickFirstNumber(document.getElementById("trOddH").value),
          oddsDraw: pickFirstNumber(document.getElementById("trOddD").value),
          oddsAway: pickFirstNumber(document.getElementById("trOddA").value),
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
      db.versus ||= { homeAdvantage: 1.1, paceFactor: 1, sampleSize: 20, marketBlend: 0.35, matchday: 20, tableContextTrust: 0.45, tableContext: {} };
      db.versus.tableContext ||= {};
      ensureLearningState(db);
      db.versus.marketBlend = clamp(Number(db.learning.marketTrust) || Number(db.versus.marketBlend) || 0.35, 0, 0.8);
      const options = db.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
      const pendingPredictions = db.predictions.filter(p=>!p.resolved).slice(-20).reverse();
      const pendingOptions = pendingPredictions.map(p=>{
        const home = db.teams.find(t=>t.id===p.homeId)?.name || "Local";
        const away = db.teams.find(t=>t.id===p.awayId)?.name || "Visitante";
        return `<option value="${p.id}">${p.date || "sin fecha"} · ${home} vs ${away}</option>`;
      }).join("");

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
              <input id="vsN" class="fl-input" type="number" step="1" min="5" max="40" value="${db.versus.sampleSize || 20}" title="Muestra N" />
              <input id="vsBlend" class="fl-input" type="number" step="0.05" min="0" max="0.8" value="${db.versus.marketBlend || 0.35}" title="Blend mercado" />
              <button class="fl-btn" id="runVs">Simular</button>
            </div>
            <div class="fl-row">
              <input id="vsOddH" class="fl-input" type="number" step="0.01" placeholder="Cuota 1" style="width:120px" />
              <input id="vsOddD" class="fl-input" type="number" step="0.01" placeholder="Cuota X" style="width:120px" />
              <input id="vsOddA" class="fl-input" type="number" step="0.01" placeholder="Cuota 2" style="width:120px" />
            </div>
            <div class="fl-row" style="margin-top:8px;">
              <input id="vsMatchday" class="fl-input" type="number" min="1" max="50" value="${db.versus.matchday || 20}" title="Jornada" style="width:120px" />
              <input id="vsCtxTrust" class="fl-input" type="number" step="0.05" min="0" max="1" value="${db.versus.tableContextTrust || 0.45}" title="Peso contexto tabla" style="width:170px" />
              <input id="vsHomePos" class="fl-input" type="number" min="1" max="20" placeholder="Pos local" style="width:120px" />
              <select id="vsHomeObj" class="fl-select" style="width:140px"><option value="">Obj local</option><option value="title">title</option><option value="europe">europe</option><option value="mid">mid</option><option value="survival">survival</option><option value="relegation">relegation</option><option value="cupFocus">cupFocus</option></select>
              <input id="vsAwayPos" class="fl-input" type="number" min="1" max="20" placeholder="Pos visita" style="width:120px" />
              <select id="vsAwayObj" class="fl-select" style="width:140px"><option value="">Obj visita</option><option value="title">title</option><option value="europe">europe</option><option value="mid">mid</option><option value="survival">survival</option><option value="relegation">relegation</option><option value="cupFocus">cupFocus</option></select>
            </div>
            <div id="vsOut" style="margin-top:10px;" class="fl-muted">Selecciona dos equipos.</div>
            <div class="fl-row" style="margin-top:8px;">
              <button class="fl-btn" id="saveVsPrediction">Guardar predicción</button>
              <span id="vsSaveStatus" class="fl-muted"></span>
            </div>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:6px;">Matriz de marcador exacto (0-5)</div>
            <div id="vsMatrix" class="fl-vs-grid"></div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Feedback / training</div>
          <div class="fl-row">
            <select id="fbPrediction" class="fl-select"><option value="">Predicción pendiente</option>${pendingOptions}</select>
            <input id="fbHG" type="number" class="fl-input" placeholder="Goles local reales" style="width:160px" />
            <input id="fbAG" type="number" class="fl-input" placeholder="Goles visitante reales" style="width:170px" />
            <button class="fl-btn" id="applyFeedback">Actualizar modelo</button>
          </div>
          <div id="fbOut" class="fl-muted" style="margin-top:8px;">Registra un resultado real para recalibrar league scale y team bias.</div>
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

      let lastSimulation = null;

      const syncTableContextInputs = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const homeCtx = db.versus.tableContext?.[homeId] || {};
        const awayCtx = db.versus.tableContext?.[awayId] || {};
        document.getElementById("vsHomePos").value = homeCtx.pos || "";
        document.getElementById("vsAwayPos").value = awayCtx.pos || "";
        document.getElementById("vsHomeObj").value = homeCtx.objective || "";
        document.getElementById("vsAwayObj").value = awayCtx.objective || "";
      };

      document.getElementById("vsHome").onchange = syncTableContextInputs;
      document.getElementById("vsAway").onchange = syncTableContextInputs;

      document.getElementById("runVs").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        db.versus.homeAdvantage = Number(document.getElementById("vsHA").value)||1.1;
        db.versus.paceFactor = Number(document.getElementById("vsPace").value)||1;
        db.versus.sampleSize = Number(document.getElementById("vsN").value)||20;
        db.versus.marketBlend = clamp(Number(document.getElementById("vsBlend").value)||0.35, 0, 0.8);
        db.versus.matchday = clamp(Number(document.getElementById("vsMatchday").value)||20, 1, 50);
        db.versus.tableContextTrust = clamp(Number(document.getElementById("vsCtxTrust").value)||0.45, 0, 1);
        db.learning.marketTrust = db.versus.marketBlend;
        saveDb(db);
        if(!homeId || !awayId || homeId===awayId) return;

        const homePos = pickFirstNumber(document.getElementById("vsHomePos").value);
        const awayPos = pickFirstNumber(document.getElementById("vsAwayPos").value);
        const homeObjective = pickFirstString(document.getElementById("vsHomeObj").value);
        const awayObjective = pickFirstString(document.getElementById("vsAwayObj").value);
        if(homePos!==null || homeObjective){
          db.versus.tableContext[homeId] = {
            ...(db.versus.tableContext[homeId] || {}),
            ...(homePos!==null ? { pos: clamp(homePos, 1, 20) } : {}),
            ...(homeObjective ? { objective: homeObjective } : {})
          };
        }
        if(awayPos!==null || awayObjective){
          db.versus.tableContext[awayId] = {
            ...(db.versus.tableContext[awayId] || {}),
            ...(awayPos!==null ? { pos: clamp(awayPos, 1, 20) } : {}),
            ...(awayObjective ? { objective: awayObjective } : {})
          };
        }
        saveDb(db);
        const result = versusModel(db, homeId, awayId, { matchday: db.versus.matchday, tableContextTrust: db.versus.tableContextTrust });
        const market = clean1x2Probs(
          document.getElementById("vsOddH").value,
          document.getElementById("vsOddD").value,
          document.getElementById("vsOddA").value
        );
        const baseLambdaHome = result.lHome;
        const baseLambdaAway = result.lAway;
        if(market){
          const blend = db.versus.marketBlend || 0;
          const calHome = calibrateToMarket(result.lHome, market.pH, result.pHome);
          const calAway = calibrateToMarket(result.lAway, market.pA, result.pAway);
          const oddsShift = ((calHome - result.lHome) + (calAway - result.lAway))/2;
          result.lHome = result.lHome * (1-blend) + calHome * blend;
          result.lAway = result.lAway * (1-blend) + calAway * blend;
          const calibrated = probsFromLambdas(result.lHome, result.lAway, result.maxGoals);
          result.matrix = calibrated.matrix;
          result.pHome = calibrated.pHome;
          result.pDraw = calibrated.pDraw;
          result.pAway = calibrated.pAway;
          result.best = calibrated.best;
          result.factors.breakdown.oddsCalibration = { applied: true, shift: oddsShift };
        }else{
          result.factors.breakdown.oddsCalibration = { applied: false, shift: 0 };
        }
        result.factors.breakdown.marketMultiplier = ((result.lHome / Math.max(0.05, baseLambdaHome)) + (result.lAway / Math.max(0.05, baseLambdaAway))) / 2;
        const dominant = topScoreCells(result.matrix, 3);
        const btts = bttsProbability(result.matrix);
        const awayZero = result.matrix.reduce((acc,row)=>acc + (row[0] || 0), 0);
        const breakdown = result.factors.breakdown;

        const marketLine = market
          ? `<div class="fl-muted" style="margin-top:6px;">Mercado limpio → 1: <b>${(market.pH*100).toFixed(1)}%</b> · X: <b>${(market.pD*100).toFixed(1)}%</b> · 2: <b>${(market.pA*100).toFixed(1)}%</b></div>`
          : "";

        const homeFacts = result.teams.homeData.form5;
        const awayFacts = result.teams.awayData.form5;
        const narrative = `Forma últimos 5: local ${homeFacts.points} pts (${homeFacts.gf}-${homeFacts.ga}) y visitante ${awayFacts.points} pts (${awayFacts.gf}-${awayFacts.ga}). `
          + `En esta liga el promedio es ${result.leagueCtx.avgGoalsHome.toFixed(2)}-${result.leagueCtx.avgGoalsAway.toFixed(2)} goles (L/V).`;
        const explainers = [
          `El local sube λ por ataque reciente (${((breakdown.homeAttackBoost-1)*100).toFixed(0)}%) y debilidad defensiva rival (${((breakdown.awayDefenseWeakness-1)*100).toFixed(0)}%).`,
          `El visitante se ajusta por su ataque fuera (${((breakdown.awayAttackPenalty-1)*100).toFixed(0)}%) y la defensa local (${((breakdown.homeDefenseStrength-1)*100).toFixed(0)}%).`,
          breakdown.oddsCalibration.applied
            ? `La calibración por mercado movió λ en ${breakdown.oddsCalibration.shift.toFixed(2)} (blend ${(db.versus.marketBlend*100).toFixed(0)}%).`
            : "Sin cuotas, no se aplicó calibración de mercado.",
          `Estadísticas guardadas: impacto ataque local ×${(breakdown.statsAttackHome || 1).toFixed(2)} y visitante ×${(breakdown.statsAttackAway || 1).toFixed(2)} (muestras ${breakdown.statsSample?.home || 0}/${breakdown.statsSample?.away || 0}).`,
          `Contexto tabla jornada ${result.tableContext.matchday}: pressure ${result.tableContext.home.pressure.toFixed(2)} / ${result.tableContext.away.pressure.toFixed(2)}, risk ${result.tableContext.home.riskMode.toFixed(2)} / ${result.tableContext.away.riskMode.toFixed(2)} → empate +${(result.tableContext.drawBoost*100).toFixed(1)}%.`
        ];
        const dominantTxt = dominant.map(c=>`${c.h}-${c.a} (${(c.p*100).toFixed(1)}%)`).join(", ");
        const bttsTxt = `BTTS: ${(btts*100).toFixed(1)}% (Away=0 en ${(awayZero*100).toFixed(1)}%)`;

        const multiplierLines = [
          `Base liga: ${breakdown.leagueBase.home.toFixed(2)}`,
          `Ataque local: ×${breakdown.homeAttackBoost.toFixed(2)}`,
          `Defensa rival: ×${breakdown.awayDefenseWeakness.toFixed(2)}`,
          `Bias local: ×${(1 + (breakdown.teamBias.home.attack || 0)).toFixed(2)}`,
          `Stats: ×${((breakdown.statsAttackHome || 1) * (breakdown.statsAttackAway || 1)).toFixed(2)}`,
          `Table draw boost: +${((breakdown.drawBoost || 0)*100).toFixed(1)}%`,
          `Mercado: ×${(breakdown.marketMultiplier || 1).toFixed(2)}`
        ];

        const createdAt = new Date().toISOString();
        const dateOnly = createdAt.slice(0,10);
        const leagueKey = db.teams.find(t=>t.id===homeId)?.leagueId || "global";
        const matrixTop = topScoreCells(result.matrix, 6);
        const predictionId = uid("pred");
        lastSimulation = {
          id: predictionId,
          predictionId,
          createdAt,
          updatedAt: createdAt,
          date: dateOnly,
          matchKey: `${homeId}-${awayId}-${dateOnly}`,
          leagueId: leagueKey,
          leagueKey,
          homeId,
          awayId,
          teamIds: { homeId, awayId },
          lambdaHome: result.lHome,
          lambdaAway: result.lAway,
          pHome: result.pHome,
          pDraw: result.pDraw,
          pAway: result.pAway,
          best: result.best,
          dominant,
          btts,
          breakdown,
          matrix: result.matrix,
          matrixTop,
          odds: market || null,
          marketOdds: market || null,
          features: {
            pace: result.factors.pace,
            homeAdv: result.factors.homeAdv,
            teamStrength: { home: teamStrength(db, homeId), away: teamStrength(db, awayId) },
            formMomentum: { home: result.factors.homeForm.momentum, away: result.factors.awayForm.momentum }
          },
          resolved: false
        };

        document.getElementById("vsOut").innerHTML = `
          <div>λ Home: <b>${result.lHome.toFixed(2)}</b> · λ Away: <b>${result.lAway.toFixed(2)}</b></div>
          <div class="fl-kpi" style="margin-top:8px;">
            <div><span>Home Win</span><b>${(result.pHome*100).toFixed(1)}%</b></div>
            <div><span>Draw</span><b>${(result.pDraw*100).toFixed(1)}%</b></div>
            <div><span>Away Win</span><b>${(result.pAway*100).toFixed(1)}%</b></div>
          </div>
          <div style="margin-top:8px;">Marcador más probable: <b>${result.best.h} - ${result.best.a}</b> (${(result.best.p*100).toFixed(1)}%)</div>
          <div class="fl-muted" style="margin-top:6px;">Marcadores dominantes: <b>${dominantTxt}</b></div>
          <div class="fl-muted" style="margin-top:6px;">${bttsTxt}</div>
          <div class="fl-muted" style="margin-top:6px;">Corners esperados: <b>${result.cornersExpected.toFixed(1)}</b> · Tarjetas esperadas: <b>${result.cardsExpected.toFixed(1)}</b></div>
          <div class="fl-muted" style="margin-top:6px;">${narrative}</div>
          <div class="fl-muted" style="margin-top:6px;">• ${explainers.join("<br/>• ")}</div>
          <div class="fl-muted" style="margin-top:6px;">Contribuciones λ local → <b>${multiplierLines.join(" · ")}</b></div>
          ${marketLine}
        `;

        renderMatrix(result.matrix, result.best, result.maxGoals);
      };

      document.getElementById("saveVsPrediction").onclick = ()=>{
        const status = document.getElementById("vsSaveStatus");
        if(!lastSimulation){
          status.textContent = "❌ Ejecuta una simulación primero.";
          return;
        }
        db.predictions.push({ ...lastSimulation });
        saveDb(db);
        status.textContent = "✅ Predicción guardada para feedback.";
      };

      document.getElementById("applyFeedback").onclick = ()=>{
        const predId = document.getElementById("fbPrediction").value;
        const homeGoals = pickFirstNumber(document.getElementById("fbHG").value);
        const awayGoals = pickFirstNumber(document.getElementById("fbAG").value);
        const out = document.getElementById("fbOut");
        if(!predId || homeGoals===null || awayGoals===null){
          out.textContent = "❌ Selecciona predicción y resultado real.";
          return;
        }
        const prediction = db.predictions.find(p=>p.id===predId && !p.resolved);
        if(!prediction){
          out.textContent = "❌ Predicción no encontrada.";
          return;
        }
        prediction.resolved = true;
        prediction.actual = { homeGoals, awayGoals };
        prediction.updatedAt = new Date().toISOString();
        prediction.goalError = { home: homeGoals - prediction.lambdaHome, away: awayGoals - prediction.lambdaAway };

        const metrics = updateLearningFromResult(db, prediction, { homeGoals, awayGoals });
        prediction.logLoss = metrics.logLoss;
        prediction.brierScore = metrics.brier;
        prediction.learningUpdate = {
          leagueScaleBefore: metrics.leagueScaleBefore,
          leagueScaleAfter: metrics.leagueScale,
          homeBiasBefore: metrics.homeBiasBefore,
          homeBiasAfter: metrics.homeBias,
          awayBiasBefore: metrics.awayBiasBefore,
          awayBiasAfter: metrics.awayBias,
          confidence: metrics.confidence,
          effectiveLr: { league: metrics.lrEffectiveLeague, team: metrics.lrEffectiveTeam }
        };
        saveDb(db);
        out.innerHTML = `✅ Feedback aplicado. Error goles: <b>${prediction.goalError.home.toFixed(2)}</b> / <b>${prediction.goalError.away.toFixed(2)}</b> · log-loss <b>${metrics.logLoss.toFixed(3)}</b> · brier <b>${metrics.brier.toFixed(3)}</b><br/>`
          + `🧠 leagueScale ${metrics.leagueScaleBefore.home.toFixed(3)}→${metrics.leagueScale.home.toFixed(3)} / ${metrics.leagueScaleBefore.away.toFixed(3)}→${metrics.leagueScale.away.toFixed(3)} · `
          + `bias local atk ${metrics.homeBiasBefore.attack.toFixed(3)}→${metrics.homeBias.attack.toFixed(3)} · visitante atk ${metrics.awayBiasBefore.attack.toFixed(3)}→${metrics.awayBias.attack.toFixed(3)}.<br/>`
          + `📈 Métrica global: ${metrics.metricsGlobal.nMatches} partidos · log-loss ${metrics.metricsGlobal.avgLogLoss.toFixed(3)} · brier ${metrics.metricsGlobal.brierScore.toFixed(3)}.`;
        render("versus");
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

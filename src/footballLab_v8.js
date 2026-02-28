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
    diagProfiles: {},
    versus: {
      homeAdvantage: 1.1,
      paceFactor: 1,
      sampleSize: 20,
      marketBlend: 0.35,
      matchday: 20,
      tableContextTrust: 0.45,
      tableContext: {},
      simV2: {
        baseGoalRatePerBlock: 0.22,
        globalVolatility: 0.34,
        leagueGoalsAvg: 2.6
      }
    },
    predictions: [],
    bitacora: {
      bank: 15,
      kellyFraction: 0.25,
      minUnit: 1,
      maxStakePct: 0.2,
      dailyGoalPct: 0.05,
      dailyRiskPct: 0.15,
      stopLoss: 2,
      stopWin: 1,
      maxBetsPerDay: 3,
      maxConsecutiveLosses: 2,
      entries: []
    },
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
      db.diagProfiles ||= {};
      db.versus ||= { homeAdvantage: 1.1 };
      db.versus.paceFactor = clamp(Number(db.versus.paceFactor) || 1, 0.82, 1.35);
      db.versus.sampleSize = clamp(Number(db.versus.sampleSize) || 20, 5, 40);
      db.versus.marketBlend = clamp(Number(db.versus.marketBlend) || defaultDb.versus.marketBlend, 0, 0.8);
      db.versus.matchday = clamp(Number(db.versus.matchday) || defaultDb.versus.matchday, 1, 50);
      db.versus.tableContextTrust = clamp(Number(db.versus.tableContextTrust) || defaultDb.versus.tableContextTrust, 0, 1);
      db.versus.tableContext ||= {};
      db.versus.simV2 ||= structuredClone(defaultDb.versus.simV2);
      db.versus.simV2.baseGoalRatePerBlock = clamp(Number(db.versus.simV2.baseGoalRatePerBlock) || defaultDb.versus.simV2.baseGoalRatePerBlock, 0.08, 0.6);
      db.versus.simV2.globalVolatility = clamp(Number(db.versus.simV2.globalVolatility) || defaultDb.versus.simV2.globalVolatility, 0.1, 0.8);
      db.versus.simV2.leagueGoalsAvg = clamp(Number(db.versus.simV2.leagueGoalsAvg) || defaultDb.versus.simV2.leagueGoalsAvg, 1.6, 4.2);
      db.predictions ||= [];
      db.bitacora = ensureBitacoraState(db.bitacora);
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
      .fl-mini{font-size:12px;color:#9ca3af}
      .fl-chip{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #2d333b;background:#111722;font-size:12px}
      .fl-chip.ok{border-color:#238636;color:#3fb950}
      .fl-chip.warn{border-color:#d29922;color:#f2cc60}
      .fl-chip.bad{border-color:#da3633;color:#ff7b72}
    `;
    document.head.appendChild(style);
  }

  function ensureBitacoraState(raw){
    const base = {
      bank: 15,
      kellyFraction: 0.25,
      minUnit: 1,
      maxStakePct: 0.2,
      dailyGoalPct: 0.05,
      dailyRiskPct: 0.15,
      stopLoss: 2,
      stopWin: 1,
      maxBetsPerDay: 3,
      maxConsecutiveLosses: 2,
      entries: []
    };
    const st = { ...base, ...(raw || {}) };
    st.bank = Math.max(1, Number(st.bank) || base.bank);
    st.kellyFraction = clamp(Number(st.kellyFraction) || base.kellyFraction, 0.05, 1);
    st.minUnit = Math.max(0.5, Number(st.minUnit) || base.minUnit);
    st.maxStakePct = clamp(Number(st.maxStakePct) || base.maxStakePct, 0.05, 0.5);
    st.dailyGoalPct = clamp(Number(st.dailyGoalPct) || base.dailyGoalPct, 0.01, 0.2);
    st.dailyRiskPct = clamp(Number(st.dailyRiskPct) || base.dailyRiskPct, 0.05, 0.4);
    st.stopLoss = Math.max(0.5, Number(st.stopLoss) || base.stopLoss);
    st.stopWin = Math.max(0.5, Number(st.stopWin) || base.stopWin);
    st.maxBetsPerDay = clamp(Number(st.maxBetsPerDay) || base.maxBetsPerDay, 1, 8);
    st.maxConsecutiveLosses = clamp(Number(st.maxConsecutiveLosses) || base.maxConsecutiveLosses, 1, 5);
    st.entries = Array.isArray(st.entries) ? st.entries : [];
    return st;
  }

  function calcBitacoraSuggestion({ bank, odds, probability, kellyFraction, minUnit, maxStakePct }){
    const b = Math.max(0, Number(odds) - 1);
    const p = clamp(Number(probability) || 0, 0, 1);
    const q = 1 - p;
    const ev = p * b - q;
    const kellyStar = b > 0 ? (p * b - q) / b : -1;
    const frac = Math.max(0, kellyStar * (Number(kellyFraction) || 0.25));
    const rawStake = Math.max(0, frac * Number(bank || 0));
    const maxStake = Math.max(Number(minUnit) || 1, (Number(bank) || 0) * (Number(maxStakePct) || 0.2));
    const rounded = Math.round(rawStake / minUnit) * minUnit;
    const suggestedStake = ev > 0
      ? clamp(Math.max(minUnit, rounded || minUnit), minUnit, maxStake)
      : 0;
    return { ev, b, kellyStar, frac, rawStake, suggestedStake, noBet: ev <= 0 };
  }

  function projectBankroll({ bank, p, odds, stake, steps=12, paths=1000 }){
    const safeStake = Math.max(0.01, Number(stake) || 0);
    const safeOdds = Math.max(1.01, Number(odds) || 1.01);
    const safeP = clamp(Number(p) || 0.5, 0.01, 0.99);
    const walk = Array.from({ length: paths }, ()=>{
      let b = Number(bank) || 0;
      const line = [b];
      for(let i=0;i<steps;i++){
        const win = Math.random() < safeP;
        b += win ? safeStake * (safeOdds - 1) : -safeStake;
        line.push(b);
      }
      return line;
    });
    const quant = (arr, q)=>{
      const sorted = [...arr].sort((a,b)=>a-b);
      const idx = Math.floor((sorted.length - 1) * q);
      return sorted[idx] ?? 0;
    };
    return Array.from({ length: steps + 1 }, (_v, idx)=>{
      const bucket = walk.map(pth=>pth[idx]);
      const mean = bucket.reduce((s,v)=>s+v,0) / (bucket.length || 1);
      return { step: idx, mean, p10: quant(bucket, 0.1), p90: quant(bucket, 0.9) };
    });
  }

  function sparklinePath(values, width=640, height=200, minY=null, maxY=null){
    if(!values.length) return "";
    const low = minY ?? Math.min(...values);
    const high = maxY ?? Math.max(...values);
    const spread = (high - low) || 1;
    return values.map((v,i)=>{
      const x = values.length===1 ? 0 : (i/(values.length-1))*width;
      const y = height - ((v - low) / spread) * height;
      return `${i===0?"M":"L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
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

  function buildTeamBehaviorSeries(db, teamId){
    const ordered = db.tracker
      .filter(g=>g.homeId===teamId || g.awayId===teamId)
      .slice()
      .sort((a,b)=>String(a.date || "").localeCompare(String(b.date || "")));
    let cumulativePoints = 0;
    let cumulativeGoalDiff = 0;
    const formQueue = [];
    let wins = 0;
    let draws = 0;
    let losses = 0;

    const series = ordered.map((match, idx)=>{
      const isHome = match.homeId===teamId;
      const gf = isHome ? Number(match.homeGoals)||0 : Number(match.awayGoals)||0;
      const ga = isHome ? Number(match.awayGoals)||0 : Number(match.homeGoals)||0;
      const points = gf>ga ? 3 : gf===ga ? 1 : 0;
      if(points===3) wins += 1;
      else if(points===1) draws += 1;
      else losses += 1;
      cumulativePoints += points;
      cumulativeGoalDiff += gf - ga;
      formQueue.push(points);
      if(formQueue.length > 5) formQueue.shift();
      const formAvg = formQueue.reduce((acc, val)=>acc+val, 0) / formQueue.length;
      const momentumNow = clamp(formAvg / 3, 0, 1);

      return {
        index: idx + 1,
        label: match.date || `J${idx+1}`,
        cumulativePoints,
        cumulativeGoalDiff,
        momentumNow,
        gf,
        ga
      };
    });

    const last = series[series.length - 1] || null;
    const prev = series.length > 1 ? series[series.length - 2] : null;
    return {
      series,
      summary: {
        played: series.length,
        points: last?.cumulativePoints || 0,
        goalDiff: last?.cumulativeGoalDiff || 0,
        wins,
        draws,
        losses,
        currentMomentum: last?.momentumNow || 0,
        momentumDelta: last && prev ? (last.momentumNow - prev.momentumNow) : 0
      }
    };
  }

  let _teamBehaviorChart = null;
  function renderTeamBehaviorChart(canvas, behavior){
    if(!canvas || typeof Chart === "undefined") return;
    const series = behavior?.series || [];
    try{ if(_teamBehaviorChart){ _teamBehaviorChart.destroy(); _teamBehaviorChart = null; } }catch(_e){}
    if(!series.length) return;

    _teamBehaviorChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: series.map((row, idx)=> row.label || `J${idx+1}`),
        datasets: [
          {
            label: "Puntos acumulados",
            data: series.map(row=>row.cumulativePoints),
            borderColor: "#1f6feb",
            backgroundColor: "rgba(31,111,235,.2)",
            tension: 0.25,
            yAxisID: "y"
          },
          {
            label: "Momentum actual (0-100)",
            data: series.map(row=>Math.round(row.momentumNow * 100)),
            borderColor: "#2ea043",
            backgroundColor: "rgba(46,160,67,.18)",
            tension: 0.3,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { position: "left", ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } },
          y1: {
            position: "right",
            min: 0,
            max: 100,
            ticks: { color: "#9ca3af" },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  function parseStatNumber(value){
    if(value===null || value===undefined) return null;
    if(typeof value === "number") return Number.isFinite(value) ? value : null;
    const txt = String(value).replace(/,/g, ".");
    const m = txt.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function getMatchStatForTeam(match, teamId, regexList=[]){
    const stats = Array.isArray(match?.stats) ? match.stats : [];
    if(!stats.length) return null;
    const isHome = match.homeId===teamId;
    const keyField = (row)=>String(row?.key || row?.name || row?.label || "").toLowerCase();
    for(const row of stats){
      const key = keyField(row);
      if(!regexList.some(rx=>rx.test(key))) continue;
      const sideValue = isHome ? (row.home ?? row.local ?? row.teamA) : (row.away ?? row.visitante ?? row.teamB);
      const parsed = parseStatNumber(sideValue);
      if(Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function average(values, fallback=0){
    const clean = values.filter(v=>Number.isFinite(v));
    if(!clean.length) return fallback;
    return clean.reduce((a,b)=>a+b,0) / clean.length;
  }

  function stdDev(values){
    const clean = values.filter(v=>Number.isFinite(v));
    if(clean.length < 2) return 0;
    const mean = average(clean, 0);
    const variance = clean.reduce((acc, val)=>acc + (val - mean) ** 2, 0) / clean.length;
    return Math.sqrt(Math.max(0, variance));
  }

    function engineForTeam(db, teamId){
    return recomputeTeamGlobalEngine(db, teamId) || getOrCreateDiagProfile(db, teamId, "").engineV1 || {};
  }

function computeTeamIntelligencePanel(db, teamId){
    const matches = db.tracker
      .filter(m=>m.homeId===teamId || m.awayId===teamId)
      .slice()
      .sort((a,b)=>String(a.date || "").localeCompare(String(b.date || "")));
    const engine = recomputeTeamGlobalEngine(db, teamId) || getOrCreateDiagProfile(db, teamId, "").engineV1 || {};
    if(!matches.length){
      return {
        matches: [],
        metrics: { powerIndex: 50, trend: "→ Plano", trendSlope: 0, consistencyScore: 50, momentum5: 0.5 },
        psych: { aggressiveness: 50, resilience: 50, volatility: 50, fatigue: 50 },
        tactical: { directAttack: 50, possession: 50, transitions: 50, press: 50, setPieces: 50 },
        momentum: { labels: [], xgDifferential: [], realPerformance: [], expectedPerformance: [] },
        prediction: { eloDynamic: 1500, offenseRating: 50, defenseRating: 50, psychIndex: 50, consistencyIndex: 50 }
      };
    }

    const pointsSeries = [];
    const xgDiffSeries = [];
    const expectedSeries = [];
    const powerSeries = [];
    const fatigueLoad = [];
    const labels = [];
    let comebackPoints = 0;
    let comebackSamples = 0;
    let travelPenalty = 0;

    matches.forEach((m, idx)=>{
      const isHome = m.homeId===teamId;
      const gf = isHome ? Number(m.homeGoals)||0 : Number(m.awayGoals)||0;
      const ga = isHome ? Number(m.awayGoals)||0 : Number(m.homeGoals)||0;
      const pts = gf>ga ? 3 : gf===ga ? 1 : 0;
      const xgFor = isHome ? parseStatNumber(m.homeXg) : parseStatNumber(m.awayXg);
      const xgAgainst = isHome ? parseStatNumber(m.awayXg) : parseStatNumber(m.homeXg);
      const xgDiff = Number.isFinite(xgFor) && Number.isFinite(xgAgainst) ? xgFor - xgAgainst : (gf - ga) * 0.6;
      const expectedPts = clamp(1.5 + xgDiff * 1.2, 0, 3);
      labels.push(m.date || `J${idx+1}`);
      pointsSeries.push(pts);
      xgDiffSeries.push(xgDiff);
      expectedSeries.push(expectedPts / 3);
      if(ga > 0){
        comebackSamples += 1;
        if(gf >= ga) comebackPoints += pts;
      }
      if(!isHome) travelPenalty += 1;
      const dateTs = Date.parse(m.date || "");
      const prevTs = idx>0 ? Date.parse(matches[idx-1].date || "") : NaN;
      const restDays = Number.isFinite(dateTs) && Number.isFinite(prevTs) ? Math.max(0, (dateTs - prevTs)/(1000*60*60*24)) : 5;
      fatigueLoad.push(clamp((4 - restDays) / 4, 0, 1));

      const shortPoints = pointsSeries.slice(Math.max(0, pointsSeries.length - 5));
      const momentum5 = average(shortPoints, 1.5) / 3;
      const consistencyInv = 1 - clamp(stdDev(pointsSeries) / 1.5, 0, 1);
      const homeMatches = matches.slice(0, idx+1).filter(x=>x.homeId===teamId);
      const awayMatches = matches.slice(0, idx+1).filter(x=>x.awayId===teamId);
      const homePpg = average(homeMatches.map(x=>{ const g1=Number(x.homeGoals)||0, g2=Number(x.awayGoals)||0; return g1>g2?3:g1===g2?1:0; }), 1.2) / 3;
      const awayPpg = average(awayMatches.map(x=>{ const g1=Number(x.awayGoals)||0, g2=Number(x.homeGoals)||0; return g1>g2?3:g1===g2?1:0; }), 1.0) / 3;
      const locality = clamp(0.5 + (homePpg - awayPpg) * 0.5, 0, 1);
      const psychInverse = 1 - clamp(Number(engine?.profile?.psychLoad) || 0.5, 0, 1);
      const shockInverse = 1 - clamp(Number(engine?.profile?.shock) || 0.5, 0, 1);
      const xgNorm = clamp(0.5 + average(xgDiffSeries, 0) / 2.2, 0, 1);
      const power = clamp((0.30*xgNorm + 0.20*momentum5 + 0.15*consistencyInv + 0.15*locality + 0.10*psychInverse + 0.10*shockInverse) * 100, 0, 100);
      powerSeries.push(power);
    });

    const momentum5 = average(pointsSeries.slice(-5), 1.5) / 3;
    const consistencyScore = clamp((1 - stdDev(pointsSeries)/1.5) * 100, 0, 100);
    const powerIndex = powerSeries[powerSeries.length-1] || 50;
    const recentAvg = average(powerSeries.slice(-5), powerIndex);
    const prevAvg = average(powerSeries.slice(-10, -5), recentAvg);
    const trendSlope = recentAvg - prevAvg;

    const aggression = clamp(
      35 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/falta/, /foul/]) ?? 12), 12) / 20
      + 20 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/amarilla/, /yellow/]) ?? 2.2), 2.2) / 5
      + 25 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/duel/]) ?? 50), 50) / 100
      + 20 * average(matches.map(m=>getMatchStatForTeam(m, teamId, [/tiro.*20/, /shot.*20/]) ?? 2), 2) / 6,
      0,
      100
    );
    const resilience = clamp(
      50 * (comebackSamples ? (comebackPoints / (comebackSamples*3)) : 0.5)
      + 30 * clamp(average(pointsSeries.slice(-5), 1.5) / 3, 0, 1)
      + 20 * clamp((Number(engine?.haTraits?.awayResilience)||0), 0, 1),
      0,
      100
    );
    const perfResidual = pointsSeries.map((pts, i)=>(pts/3) - expectedSeries[i]);
    const volatility = clamp(stdDev(perfResidual) * 220, 0, 100);
    const fatigue = clamp((average(fatigueLoad, 0.4)*60) + (travelPenalty / Math.max(1, matches.length))*40, 0, 100);

    const possession = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/posesi/]) ?? 50), 50), 0, 100);
    const wingPlay = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/banda/, /cross/, /centro/]) ?? 40), 40), 0, 100);
    const inBoxShots = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/área/, /area/, /box/]) ?? 45), 45), 0, 100);
    const progressivePass = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/progres/]) ?? 48), 48), 0, 100);
    const highPress = clamp(average(matches.map(m=>getMatchStatForTeam(m, teamId, [/presi/, /press/]) ?? 46), 46), 0, 100);

    return {
      matches,
      metrics: {
        powerIndex,
        trendSlope,
        trend: trendSlope > 2 ? "↗ Subiendo" : trendSlope < -2 ? "↘ Cayendo" : "→ Plano",
        consistencyScore,
        momentum5,
        powerSeries,
        labels
      },
      psych: { aggressiveness: aggression, resilience, volatility, fatigue },
      tactical: {
        directAttack: clamp((wingPlay*0.4 + inBoxShots*0.6), 0, 100),
        possession,
        transitions: clamp((progressivePass*0.6 + highPress*0.4), 0, 100),
        press: highPress,
        setPieces: clamp((average(matches.map(m=>isFinite(parseStatNumber(m.homeCorners)||parseStatNumber(m.awayCorners)) ? (m.homeId===teamId ? Number(m.homeCorners)||0 : Number(m.awayCorners)||0) : 5), 5) / 12) * 100, 0, 100)
      },
      momentum: {
        labels,
        xgDifferential: xgDiffSeries.map(v=>clamp(50 + v*20, 0, 100)),
        realPerformance: pointsSeries.map(v=>Math.round((v/3)*100)),
        expectedPerformance: expectedSeries.map(v=>Math.round(v*100))
      },
      prediction: {
        eloDynamic: Math.round(1450 + powerIndex*3.2),
        offenseRating: clamp(50 + average(xgDiffSeries, 0)*18 + average(pointsSeries.slice(-5), 1.5)*8, 0, 100),
        defenseRating: clamp(55 - average(xgDiffSeries, 0)*14 + consistencyScore*0.25, 0, 100),
        psychIndex: clamp(100 - ((fatigue*0.45) + (volatility*0.25) - (resilience*0.2) - (aggression*0.1)), 0, 100),
        consistencyIndex: consistencyScore
      }
    };
  }

  function renderSimpleLineChart(canvas, labels, datasets){
    if(!canvas || typeof Chart !== "function") return;
    if(canvas._chart){ try{ canvas._chart.destroy(); }catch(_e){} }
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { min: 0, max: 100, ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } }
        }
      }
    });
  }

  function renderRadarChart(canvas, labels, data, color="#1f6feb"){
    if(!canvas || typeof Chart !== "function") return;
    if(canvas._chart){ try{ canvas._chart.destroy(); }catch(_e){} }
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels,
        datasets: [{ label: "Índice", data, borderColor: color, backgroundColor: `${color}33`, pointBackgroundColor: color }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        scales: { r: { suggestedMin: 0, suggestedMax: 100, angleLines: { color: "rgba(255,255,255,.1)" }, grid: { color: "rgba(255,255,255,.09)" }, pointLabels: { color: "#9ca3af" }, ticks: { color: "#9ca3af", backdropColor: "transparent" } } }
      }
    });
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function ensureDiagProfileState(db){
    db.diagProfiles ||= {};
  }

  function createEmptyDiagProfile(teamName=""){
    return {
      team: teamName,
      version: "diagProfile_v1",
      matchesCount: 0,
      traits: {
        territorial_strength: 0.5,
        finishing_quality: 0.5,
        transition_attack: 0.5,
        transition_defense: 0.5,
        low_block_execution: 0.5,
        chance_creation: 0.5,
        discipline_risk: 0.5,
        late_game_management: 0.5
      },
      lastUpdated: null
    };
  }

  function getOrCreateDiagProfile(db, teamId, teamName){
    ensureDiagProfileState(db);
    if(!db.diagProfiles[teamId]) db.diagProfiles[teamId] = createEmptyDiagProfile(teamName || "");
    const profile = db.diagProfiles[teamId];
    profile.team = teamName || profile.team || "";
    profile.version = "diagProfile_v1";
    profile.matchesCount = Number(profile.matchesCount) || 0;
    profile.traits ||= createEmptyDiagProfile().traits;
    Object.keys(createEmptyDiagProfile().traits).forEach(key=>{
      profile.traits[key] = clamp(Number(profile.traits[key]) || 0.5, 0, 1);
    });
    return profile;
  }

  function classifyStyle(traits={}){
    if((traits.territorial_strength||0)>0.58 && (traits.finishing_quality||0)<0.45) return "sterile_domination";
    if((traits.low_block_execution||0)>0.55 && (traits.transition_attack||0)>0.55) return "absorb_and_strike";
    if((traits.late_game_management||0)>0.58) return "late_collider";
    if((traits.discipline_risk||0)>0.62) return "high_variance";
    if((traits.territorial_strength||0)>0.56 && (traits.chance_creation||0)>0.52) return "territorial_builder";
    return "balanced";
  }

  function createRng(seed){
    if(!Number.isFinite(Number(seed))) return Math.random;
    let x = (Number(seed) >>> 0) || 1;
    return ()=>{
      x += 0x6D2B79F5;
      let r = Math.imul(x ^ (x >>> 15), x | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng){
    const u = Math.max(1e-9, rng());
    const v = Math.max(1e-9, rng());
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }

  function buildMatchPlan(teamAProfile, teamBProfile, context={}){
    const h = teamAProfile.traits || {};
    const a = teamBProfile.traits || {};
    const clash = [];
    if((h.territorial_strength||0)>0.56 && (a.transition_attack||0)>0.55 && (h.transition_defense||0)<0.47) clash.push("away_transition_window");
    if((a.territorial_strength||0)>0.56 && (h.transition_attack||0)>0.55 && (a.transition_defense||0)<0.47) clash.push("home_transition_window");
    if((h.territorial_strength||0)>0.58 && (h.finishing_quality||0)<0.45) clash.push("home_sterile_risk");
    if((a.territorial_strength||0)>0.58 && (a.finishing_quality||0)<0.45) clash.push("away_sterile_risk");
    return {
      home: teamAProfile.team,
      away: teamBProfile.team,
      context: {
        homeAdv: clamp(Number(context.homeAdv)||0.06, 0, 0.3),
        leagueGoalsAvg: clamp(Number(context.leagueGoalsAvg)||2.6, 1.6, 4.2)
      },
      matchup: {
        homeStyle: classifyStyle(h),
        awayStyle: classifyStyle(a),
        styleClash: clash
      },
      rates: {
        baseGoalRatePerBlock: clamp(Number(context.baseGoalRatePerBlock)||0.22, 0.08, 0.6),
        volatility: clamp(Number(context.globalVolatility)||0.34, 0.1, 0.8)
      },
      homeProfile: teamAProfile,
      awayProfile: teamBProfile
    };
  }

  function generateCandlesFromBlocks(blocks=[], team="home"){
    let prev = 0;
    return blocks.map(b=>{
      const close = team==="home" ? Number(b.iddHome)||0 : Number(b.iddAway)||0;
      const item = { label: `${b.t0}-${b.t1}`, open: prev, close, high: Math.max(prev, close), low: Math.min(prev, close) };
      prev = close;
      return item;
    });
  }

  function generateDiagnosis(candles=[], blocksEvents=[]){
    const closes = candles.map(c=>Number(c.close)||0);
    const diffs = closes.slice(1).map((v, i)=>v-closes[i]);
    let breakIdx = 0;
    let maxDelta = -1;
    diffs.forEach((d, i)=>{ if(Math.abs(d)>maxDelta){ maxDelta = Math.abs(d); breakIdx = i+1; } });
    const breakBlock = candles[breakIdx]?.label || "0-10";
    const late = closes.slice(8);
    const lateStrength = late.length ? late.reduce((a,b)=>a+b,0)/late.length : 0;
    const signs = closes.reduce((acc,v,i)=> acc + ((i>0 && Math.sign(v)!==Math.sign(closes[i-1])) ? 1 : 0), 0);
    const vol = closes.length ? Math.sqrt(closes.reduce((s,v)=>s + v*v,0)/closes.length) : 0;
    const patterns = [];
    if(blocksEvents.some(e=>e.type==="goal" && e.shock)) patterns.push("shock_transition");
    if(vol>0.35) patterns.push("oscillation");
    if(lateStrength<-0.12) patterns.push("late_risk_exposure");
    if(signs>=5) patterns.push("second_half_break");
    if(!blocksEvents.some(e=>e.type==="goal") && closes.reduce((a,b)=>a+b,0)>1.2) patterns.push("sterile_dominance");
    const text = [];
    if(patterns.includes("sterile_dominance")) text.push("Dominio sin conversión: presión sostenida sin premio.");
    if(patterns.includes("shock_transition")) text.push("Gol contra tendencia: transición castiga el control rival.");
    if(patterns.includes("late_risk_exposure")) text.push("Cierre vulnerable: exposición tardía.");
    if(!text.length) text.push("Partido por fases sin quiebre dominante.");
    return { breakBlock, patterns, text, metrics: { vol, lateStrength, switches: signs } };
  }

  function applyMatchToTeamProfile(profile, diagnostic, perspective="for"){
    const next = structuredClone(profile || createEmptyDiagProfile());
    const alpha = 0.12;
    const touch = (k, s)=>{ next.traits[k] = clamp(next.traits[k]*(1-alpha) + s*alpha, 0, 1); };
    const has = p=>diagnostic?.patterns?.includes(p);
    if(has("sterile_dominance")){ touch("territorial_strength", 0.66); touch("finishing_quality", 0.36); }
    if(has("shock_transition")){ touch("transition_attack", perspective==="for" ? 0.66 : 0.45); touch("transition_defense", perspective==="against" ? 0.35 : 0.58); }
    if(has("late_risk_exposure")) touch("late_game_management", 0.35);
    if(has("oscillation")) touch("discipline_risk", 0.64);
    next.matchesCount = (Number(next.matchesCount)||0) + 1;
    next.lastUpdated = new Date().toISOString();
    return next;
  }

  function normalizeIdd(value){
    const raw = clamp(Number(value) || 0, -1, 1);
    return clamp((raw + 1) / 2, 0, 1);
  }

  function computePerformanceIndex(metrics={}){
    const avgIDD = normalizeIdd(metrics.avgIDD);
    const threat = clamp(Number(metrics.threat) || 0, 0, 1);
    const lateIDD = normalizeIdd(metrics.lateIDD);
    const avgComposure = clamp(Number(metrics?.psych?.avgComposure) || 0, 0, 1);
    const avgTiltRisk = clamp(Number(metrics?.psych?.avgTiltRisk) || 0, 0, 1);
    return clamp(
      0.45 * avgIDD +
      0.25 * threat +
      0.10 * lateIDD +
      0.10 * avgComposure -
      0.10 * avgTiltRisk,
      0,
      1
    );
  }

  function createHomeAwayBucket(){
    return { n: 0, avgPI: 0.5, avgIDD: 0, avgThreat: 0.5, avgComposure: 0.5, avgTilt: 0.5, lateStrength: 0.5 };
  }

  function updateHomeAwayBucket(bucket, payload){
    const prevN = Number(bucket.n) || 0;
    const alpha = prevN < 10 ? 0.18 : 0.10;
    const ema = (oldVal, nextVal)=> oldVal * (1 - alpha) + nextVal * alpha;
    bucket.avgPI = clamp(ema(Number(bucket.avgPI) || 0.5, clamp(Number(payload.pi) || 0.5, 0, 1)), 0, 1);
    bucket.avgIDD = clamp(ema(Number(bucket.avgIDD) || 0, clamp(Number(payload.avgIDD) || 0, -1, 1)), -1, 1);
    bucket.avgThreat = clamp(ema(Number(bucket.avgThreat) || 0.5, clamp(Number(payload.threat) || 0, 0, 1)), 0, 1);
    bucket.avgComposure = clamp(ema(Number(bucket.avgComposure) || 0.5, clamp(Number(payload.avgComposure) || 0, 0, 1)), 0, 1);
    bucket.avgTilt = clamp(ema(Number(bucket.avgTilt) || 0.5, clamp(Number(payload.avgTilt) || 0, 0, 1)), 0, 1);
    bucket.lateStrength = clamp(ema(Number(bucket.lateStrength) || 0.5, normalizeIdd(payload.lateIDD)), 0, 1);
    bucket.n = prevN + 1;
    return bucket;
  }

  function computeHaTraits(homeBucket, awayBucket){
    const homeBoost = clamp((Number(homeBucket.avgPI) || 0.5) - (Number(awayBucket.avgPI) || 0.5), -0.30, 0.30);
    const awayResilience = clamp((Number(awayBucket.avgPI) || 0.5) / ((Number(homeBucket.avgPI) || 0.5) + 0.001), 0, 1);
    const awayFragility = clamp(1 - awayResilience, 0, 1);
    const crowdEnergy = clamp((Number(homeBucket.lateStrength) || 0.5) - (Number(awayBucket.lateStrength) || 0.5) + 0.5, 0, 1);
    const travelTilt = clamp((Number(awayBucket.avgTilt) || 0.5) - (Number(homeBucket.avgTilt) || 0.5) + 0.5, 0, 1);
    return { homeBoost, awayResilience, awayFragility, crowdEnergy, travelTilt };
  }

  function inferEngineMetricsFromMatch(match, teamId){
    const isHome = match?.homeId===teamId;
    const side = isHome ? "home" : "away";
    const oppSide = isHome ? "away" : "home";
    const narrativeLabels = match?.narrativeModule?.diagnostic?.diagnostic?.labels
      || match?.narrativeModule?.diagnostic?.labels
      || {};
    const avgIDD = clamp(Number(narrativeLabels.control_without_conversion) || 0, 0, 1) * 2 - 1;
    const lateIDD = clamp(Number(narrativeLabels.late_risk_exposure) || 0, 0, 1) * 2 - 1;
    const threat = metricFromStats(match?.stats, ["big chances", "ocasiones", "ataques peligrosos"], side);
    const intensityRaw = metricFromStats(match?.stats, ["shots", "remates", "shots on target", "tiros a puerta"], side);
    const ownXg = metricFromStats(match?.stats, ["goles esperados (xg)", "xg"], side);
    const oppXg = metricFromStats(match?.stats, ["goles esperados (xg)", "xg"], oppSide);
    const ownXgot = metricFromStats(match?.stats, ["xg a puerta", "xgot"], side);
    const shotsOn = metricFromStats(match?.stats, ["shots on target", "tiros a puerta", "remates a puerta"], side);
    const corners = metricFromStats(match?.stats, ["corners", "corneres", "córneres"], side);
    const touchesBox = metricFromStats(match?.stats, ["toques en el area rival", "toques en el área rival"], side);
    const fouls = metricFromStats(match?.stats, ["faltas", "fouls"], side);
    const yellows = metricFromStats(match?.stats, ["tarjetas amarillas", "yellow cards"], side);
    const tackles = metricFromStats(match?.stats, ["entradas", "tackles"], side);
    const duels = metricFromStats(match?.stats, ["duelos ganados", "duels won"], side);
    const interceptions = metricFromStats(match?.stats, ["intercepciones", "interceptions"], side);
    const narrativeEvents = match?.narrativeModule?.normalized?.events || [];
    const shockGoals = narrativeEvents.filter(evt=>evt?.type==="goal" && Number(evt?.min)>=70).length;
    const aggressionIndex = clamp(
      0.30 * clamp((Number(tackles) || 50) / 100, 0, 1) +
      0.20 * clamp((Number(duels) || 40) / 70, 0, 1) +
      0.16 * clamp((Number(interceptions) || 4) / 10, 0, 1) +
      0.20 * clamp((Number(fouls) || 8) / 16, 0, 1) +
      0.14 * clamp((Number(yellows) || 1) / 5, 0, 1),
      0,
      1
    );
    const shockIndex = clamp(
      0.35 * clamp(Number(narrativeLabels.transition_punished) || 0, 0, 1) +
      0.25 * clamp(Number(narrativeLabels.late_risk_exposure) || 0, 0, 1) +
      0.20 * clamp((Number(shockGoals) || 0) / 3, 0, 1) +
      0.20 * clamp((Number(oppXg) || 1.2) / 2.8, 0, 1),
      0,
      1
    );
    const psychLoad = clamp(
      0.36 * clamp(Number(narrativeLabels.control_without_conversion) || 0, 0, 1) +
      0.30 * clamp(Number(narrativeLabels.discipline_impact) || 0, 0, 1) +
      0.18 * aggressionIndex +
      0.16 * shockIndex,
      0,
      1
    );
    const confidence = clamp(
      0.35 * clamp((Number(ownXg) || 0.9) / 2.2, 0, 1) +
      0.25 * clamp((Number(ownXgot) || 1) / 2.5, 0, 1) +
      0.20 * clamp((Number(shotsOn) || 3) / 9, 0, 1) +
      0.20 * clamp((Number(touchesBox) || 14) / 45, 0, 1),
      0,
      1
    );
    const composure = clamp(0.62 - psychLoad * 0.34 + confidence * 0.24, 0, 1);
    const frustration = clamp(0.24 + psychLoad * 0.58 - confidence * 0.22, 0, 1);
    const tiltRisk = clamp(0.18 + psychLoad * 0.50 + aggressionIndex * 0.24 - composure * 0.26, 0, 1);
    return {
      avgIDD,
      lateIDD,
      threat: clamp(Number(threat) || 0.5, 0, 1),
      intensity: clamp(Number(intensityRaw) || 0.5, 0, 1),
      shockGoals,
      aggressionIndex,
      shockIndex,
      psychLoad,
      sterilePressure: clamp(Number(narrativeLabels.control_without_conversion) || 0.2, 0, 1),
      psych: {
        avgConfidence: confidence,
        avgComposure: composure,
        avgFrustration: frustration,
        avgTiltRisk: tiltRisk
      }
    };
  }

  function recomputeTeamGlobalEngine(db, teamId){
    const team = db.teams.find(t=>t.id===teamId);
    if(!team) return null;
    const profile = getOrCreateDiagProfile(db, teamId, team.name);
    const orderedMatches = db.tracker
      .filter(m=>(m.homeId===teamId || m.awayId===teamId) && m?.teamEngine?.[teamId])
      .sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
    const home = createHomeAwayBucket();
    const away = createHomeAwayBucket();
    const series = [];
    orderedMatches.forEach((match, idx)=>{
      const sample = match.teamEngine[teamId];
      const metrics = sample.metrics || {};
      const psych = metrics.psych || {};
      const pi = computePerformanceIndex(metrics);
      sample.pi = pi;
      const target = sample.isHome ? home : away;
      updateHomeAwayBucket(target, {
        pi,
        avgIDD: metrics.avgIDD,
        lateIDD: metrics.lateIDD,
        threat: metrics.threat,
        avgComposure: psych.avgComposure,
        avgTilt: psych.avgTiltRisk
      });
      const epa = clamp(Number(sample.epa) || 0.5, 0, 1);
      const ema = clamp(Number(sample.emaIntensity) || 0.5, 0, 1);
      const globalStrength = clamp(0.40*pi + 0.25*epa + 0.20*ema + 0.15*(1 - clamp(Number(psych.avgTiltRisk) || 0.5, 0, 1)), 0, 1);
      series.push({
        label: match.date || `M${idx+1}`,
        score: globalStrength,
        pi,
        epa,
        ema,
        aggression: clamp(Number(metrics.aggressionIndex) || 0.5, 0, 1),
        shock: clamp(Number(metrics.shockIndex) || 0.5, 0, 1),
        psychLoad: clamp(Number(metrics.psychLoad) || Number(psych.avgTiltRisk) || 0.5, 0, 1),
        isHome: sample.isHome
      });
    });
    const haTraits = computeHaTraits(home, away);
    const trend = series.slice(-5);
    const currentStrength = trend.length ? trend.reduce((sum, item)=>sum + item.score, 0) / trend.length : 0.5;
    profile.engineV1 = {
      version: "hae_epa_ema_v1",
      updatedAt: new Date().toISOString(),
      samples: series.length,
      currentStrength,
      homeAway: { home, away },
      haTraits,
      profile: {
        aggression: series.length ? series.reduce((sum, item)=>sum + item.aggression, 0) / series.length : 0.5,
        shock: series.length ? series.reduce((sum, item)=>sum + item.shock, 0) / series.length : 0.5,
        psychLoad: series.length ? series.reduce((sum, item)=>sum + item.psychLoad, 0) / series.length : 0.5
      },
      series
    };
    return profile.engineV1;
  }

  function renderTeamGlobalEngineChart(canvas, engine){
    if(!canvas || typeof Chart!=="function") return;
    if(canvas._chart){
      canvas._chart.destroy();
      canvas._chart = null;
    }
    const labels = (engine?.series || []).map(item=>item.label);
    const dataStrength = (engine?.series || []).map(item=>Math.round((item.score || 0) * 100));
    const dataEPA = (engine?.series || []).map(item=>Math.round((item.epa || 0) * 100));
    const dataEMA = (engine?.series || []).map(item=>Math.round((item.ema || 0) * 100));
    const dataAggression = (engine?.series || []).map(item=>Math.round((item.aggression || 0) * 100));
    const dataShock = (engine?.series || []).map(item=>Math.round((item.shock || 0) * 100));
    const dataPsychLoad = (engine?.series || []).map(item=>Math.round((item.psychLoad || 0) * 100));
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Fuerza global", data: dataStrength, borderColor: "#2ea043", backgroundColor: "rgba(46,160,67,.16)", tension: 0.25 },
          { label: "EPA", data: dataEPA, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.16)", tension: 0.25 },
          { label: "EMA psicológico", data: dataEMA, borderColor: "#d29922", backgroundColor: "rgba(210,153,34,.14)", tension: 0.25 },
          { label: "Agresividad", data: dataAggression, borderColor: "#ff7b72", backgroundColor: "rgba(255,123,114,.12)", tension: 0.2, borderDash: [5, 3] },
          { label: "Shock", data: dataShock, borderColor: "#a371f7", backgroundColor: "rgba(163,113,247,.14)", tension: 0.2, borderDash: [3, 3] },
          { label: "Carga psicológica", data: dataPsychLoad, borderColor: "#f2cc60", backgroundColor: "rgba(242,204,96,.10)", tension: 0.22 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#c9d1d9" } } },
        scales: {
          x: { ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { min: 0, max: 100, ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,.06)" } }
        }
      }
    });
  }

  function openTeamEngineModal({ db, match, team, onSave } = {}){
    if(!match || !team) return;
    const inferred = inferEngineMetricsFromMatch(match, team.id);
    const prev = match?.teamEngine?.[team.id] || {};
    const metrics = prev.metrics || inferred;
    const psych = metrics.psych || inferred.psych;
    const epa = clamp(Number(prev.epa) || 0.5, 0, 1);
    const emaIntensity = clamp(Number(prev.emaIntensity) || 0.5, 0, 1);
    const existingNarrative = match?.narrativeModule?.rawText || "";
    const existingStatsJson = match?.stats?.length
      ? JSON.stringify({ stats: match.stats }, null, 2)
      : "";
    const homeName = db.teams.find(t=>t.id===match.homeId)?.name || "Local";
    const awayName = db.teams.find(t=>t.id===match.awayId)?.name || "Visitante";
    const backdrop = document.createElement("div");
    backdrop.className = "fl-modal-backdrop";
    backdrop.innerHTML = `
      <div class="fl-modal" style="max-width:920px;max-height:90vh;overflow:auto;">
        <div class="fl-row" style="justify-content:space-between;align-items:center;">
          <div style="font-size:18px;font-weight:900;">EPA + EMA + Localía (${team.name})</div>
          <button class="fl-btn" id="closeEngineModal">Cerrar</button>
        </div>
        <div class="fl-card" style="margin-top:10px;">
          <div style="font-weight:800;margin-bottom:6px;">📋 Relato del partido</div>
          <textarea id="engNarrative" class="fl-text" placeholder="Pega el relato línea por línea con minutos.">${existingNarrative}</textarea>
        </div>
        <div class="fl-card" style="margin-top:10px;">
          <div style="font-weight:800;margin-bottom:6px;">📊 Estadísticas (JSON)</div>
          <textarea id="engStatsJson" class="fl-text" placeholder='{"stats":[{"key":"Posesión","home":"67%","away":"33%"}]}' style="min-height:160px;">${existingStatsJson}</textarea>
          <div class="fl-mini" style="margin-top:6px;">Si ya había datos, aquí los puedes ver y editar.</div>
        </div>
        <div class="fl-mini" style="margin-top:8px;">Las métricas del motor se recalculan desde el relato + estadísticas al guardar.</div>
        <div class="fl-grid two" style="margin-top:8px;">
          <label class="fl-mini">EPA (0-1)<input id="engEPA" class="fl-input" type="number" min="0" max="1" step="0.01" value="${epa}"></label>
          <label class="fl-mini">EMA intensidad velas (0-1)<input id="engEMA" class="fl-input" type="number" min="0" max="1" step="0.01" value="${emaIntensity}"></label>
        </div>
        <div class="fl-row" style="margin-top:10px;">
          <button class="fl-btn" id="saveEngineModal">Guardar en gráfico global</button>
          <span id="engineModalStatus" class="fl-muted"></span>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#closeEngineModal").onclick = ()=>backdrop.remove();
    backdrop.onclick = (ev)=>{ if(ev.target===backdrop) backdrop.remove(); };
    backdrop.querySelector("#saveEngineModal").onclick = ()=>{
      const status = backdrop.querySelector("#engineModalStatus");
      const narrativeRaw = backdrop.querySelector("#engNarrative").value.trim();
      const statsRaw = backdrop.querySelector("#engStatsJson").value.trim();
      if(narrativeRaw){
        const parsed = extractNarratedEvents(narrativeRaw, { home: homeName, away: awayName });
        const diagnostic = buildNarrativeDiagnostic({ match, teams: { home: homeName, away: awayName }, parsed });
        match.narrativeModule = {
          rawText: narrativeRaw,
          normalized: {
            matchId: match.id,
            teams: { home: homeName, away: awayName },
            events: parsed.events
          },
          diagnostic: { matchId: match.id, diagnostic }
        };
      }
      if(statsRaw){
        try{
          match.stats = parseStatsPayload(statsRaw);
        }catch(err){
          status.textContent = `❌ ${String(err.message || err)}`;
          return;
        }
      }
      const inferredFresh = inferEngineMetricsFromMatch(match, team.id);
      const mergedPsych = {
        ...inferredFresh.psych,
        ...(psych || {})
      };
      const finalMetrics = {
        ...inferredFresh,
        ...metrics,
        ...inferredFresh,
        psych: mergedPsych
      };
      const payload = {
        team: team.name,
        isHome: match.homeId===team.id,
        epa: clamp(Number(backdrop.querySelector("#engEPA").value) || 0, 0, 1),
        emaIntensity: clamp(Number(backdrop.querySelector("#engEMA").value) || 0, 0, 1),
        metrics: finalMetrics,
        updatedAt: new Date().toISOString()
      };
      payload.pi = computePerformanceIndex(payload.metrics);
      match.teamEngine ||= {};
      match.teamEngine[team.id] = payload;
      recomputeTeamGlobalEngine(db, team.id);
      saveDb(db);
      status.textContent = `✅ PI ${payload.pi.toFixed(3)} guardado y agregado al motor global.`;
      if(typeof onSave==="function") setTimeout(()=>{ backdrop.remove(); onSave(); }, 320);
    };
  }

  function simulateMatchV2(plan, rngSeed){
    const rng = createRng(rngSeed);
    const ht = plan.homeProfile.traits || {};
    const at = plan.awayProfile.traits || {};
    const attackH = 0.40*(ht.territorial_strength||0.5) + 0.35*(ht.chance_creation||0.5) + 0.25*(ht.finishing_quality||0.5);
    const attackA = 0.40*(at.territorial_strength||0.5) + 0.35*(at.chance_creation||0.5) + 0.25*(at.finishing_quality||0.5);
    const defenseH = 0.50*(ht.transition_defense||0.5) + 0.50*(ht.low_block_execution||0.5);
    const defenseA = 0.50*(at.transition_defense||0.5) + 0.50*(at.low_block_execution||0.5);
    const blocks = [];
    const allEvents = [];
    const score = { home: 0, away: 0 };
    let prevIdd = 0;
    for(let k=0;k<10;k++){
      const t0 = k*10;
      const t1 = k===9 ? 90 : (k+1)*10;
      const scoreDiff = score.home - score.away;
      const late = t0>=70;
      const state = scoreDiff<0 ? (late?0.15:0.08) : scoreDiff>0 ? -0.05 : 0;
      const noise = randn(rng) * ((Number(ht.discipline_risk)||0.5 + (Number(at.discipline_risk)||0.5))/2) * plan.rates.volatility;
      let style = 0;
      if(plan.matchup.styleClash.includes("home_transition_window")) style += 0.08;
      if(plan.matchup.styleClash.includes("away_transition_window")) style -= 0.08;
      if(plan.matchup.styleClash.includes("home_sterile_risk") && k>=3 && k<=7) style -= 0.06;
      if(plan.matchup.styleClash.includes("away_sterile_risk") && k>=3 && k<=7) style += 0.06;
      const base = (attackH-defenseA) - (attackA-defenseH)*0.65 + plan.context.homeAdv*0.4;
      const iddHome = clamp(0.55*prevIdd + 0.45*(base + style + state + noise), -1, 1);
      const iddAway = -iddHome;
      const events = [];
      const goalH = plan.rates.baseGoalRatePerBlock * (1 + 0.9*Math.max(0, iddHome)) * (ht.finishing_quality||0.5) * (1-defenseA*0.75);
      const goalA = plan.rates.baseGoalRatePerBlock * (1 + 0.9*Math.max(0, iddAway)) * (at.finishing_quality||0.5) * (1-defenseH*0.75);
      const shockH = 0.08*(ht.transition_attack||0.5)*Math.max(0,-iddHome)*(1-(at.transition_defense||0.5));
      const shockA = 0.08*(at.transition_attack||0.5)*Math.max(0,-iddAway)*(1-(ht.transition_defense||0.5));
      if(rng() < goalH + shockH){ score.home += 1; events.push({type:"goal", team:"home", min:t0+Math.floor(rng()*10), shock:rng() < shockH/(goalH+shockH+1e-6)}); }
      if(rng() < goalA + shockA){ score.away += 1; events.push({type:"goal", team:"away", min:t0+Math.floor(rng()*10), shock:rng() < shockA/(goalA+shockA+1e-6)}); }
      const cardH = 0.05 + (ht.discipline_risk||0.5)*0.2 + (iddHome<-0.3 ? 0.08 : 0);
      const cardA = 0.05 + (at.discipline_risk||0.5)*0.2 + (iddAway<-0.3 ? 0.08 : 0);
      if(rng()<cardH) events.push({type:"yellow", team:"home", min:t0+Math.floor(rng()*10)});
      if(rng()<cardA) events.push({type:"yellow", team:"away", min:t0+Math.floor(rng()*10)});
      allEvents.push(...events);
      blocks.push({ t0, t1, iddHome, iddAway, events });
      prevIdd = iddHome;
    }
    const candlesHome = generateCandlesFromBlocks(blocks, "home");
    const candlesAway = generateCandlesFromBlocks(blocks, "away");
    const diagnostic = generateDiagnosis(candlesHome, allEvents);
    return { score, blocks, candlesHome, candlesAway, diagnostic };
  }

  function parseMinuteToken(raw){
    const txt = String(raw || "").trim();
    const plus = txt.match(/(\d+)\s*\+\s*(\d+)\s*'?/);
    if(plus) return Number(plus[1]) + Number(plus[2]);
    const simple = txt.match(/(\d{1,3})\s*'?/);
    return simple ? Number(simple[1]) : null;
  }

  function normalizeTeamToken(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  function parseMatchNarrative(text, teamHints=[]){
    const teams = Array.isArray(teamHints) ? teamHints.filter(Boolean) : [];
    const lines = String(text || "").split(/\n+/).map(line=>line.trim()).filter(Boolean);
    const minuteRegex = /(\d+)(\+\d+)?\s*'/;
    const keywordMap = [
      { type: "goal", regex: /\bgol\b|anota|marca/i },
      { type: "red", regex: /tarjeta roja|\broja\b|expulsad/i },
      { type: "yellow", regex: /tarjeta|amonestad/i },
      { type: "corner", regex: /c[oó]rner/i },
      { type: "save", regex: /parada|atajad|interviene/i },
      { type: "big_chance", regex: /ocasi[oó]n clar[ií]sima|mano a mano|clar[ií]sima/i },
      { type: "shot", regex: /remata|disparo|chut/i },
      { type: "offside", regex: /fuera de juego/i },
      { type: "foul", regex: /falta|infracci[oó]n/i },
      { type: "pressure", regex: /presi[oó]n|asedia|encierra|domina/i }
    ];
    const teamNorm = teams.map(name=>({ name, token: normalizeTeamToken(name) })).filter(x=>x.token);
    const events = [];
    let pendingMinute = null;

    lines.forEach((line)=>{
      const minuteMatch = line.match(minuteRegex);
      if(minuteMatch){
        pendingMinute = Number(minuteMatch[1]) + Number((minuteMatch[2] || "").replace("+", "") || 0);
      }
      const eventType = keywordMap.find(item=>item.regex.test(line))?.type;
      if(!eventType) return;
      const lineNorm = normalizeTeamToken(line);
      const team = teamNorm.find(item=>lineNorm.includes(item.token))?.name;
      events.push({
        min: pendingMinute ?? null,
        type: eventType,
        team,
        text: line
      });
    });

    return { teams, events };
  }

  function buildEventTimeline(events=[]){
    return [...events]
      .map((evt, idx)=>({ ...evt, min: Number.isFinite(Number(evt.min)) ? Number(evt.min) : 0, idx }))
      .sort((a,b)=>a.min===b.min ? a.idx-b.idx : a.min-b.min)
      .map(({ idx, ...evt })=>evt);
  }

  function blockFromMinute(minute){
    const safeMinute = Number.isFinite(Number(minute)) ? Number(minute) : 0;
    if(safeMinute >= 90) return 9;
    return clamp(Math.floor(safeMinute / 10), 0, 8);
  }

  function createBlockStats(){
    return {
      shots: 0,
      big_chances: 0,
      corners: 0,
      goals: 0,
      goals_conceded: 0,
      saves_forced: 0,
      cards: 0,
      fouls: 0,
      pressure_mentions: 0,
      idd: 0,
      idd_normalized: 0
    };
  }

  function computeMomentumBlocks(events=[], teams=[]){
    const timeline = buildEventTimeline(events);
    const [homeTeam, awayTeam] = teams;
    const blocks = Array.from({ length: 10 }, (_v, idx)=>({
      block: idx,
      range: idx < 9 ? `${idx*10}-${(idx+1)*10}` : "90+",
      teams: {
        [homeTeam || "home"]: createBlockStats(),
        [awayTeam || "away"]: createBlockStats()
      },
      idd: {}
    }));
    const statMap = {
      shot: "shots",
      big_chance: "big_chances",
      corner: "corners",
      goal: "goals",
      foul: "fouls",
      yellow: "cards",
      red: "cards",
      pressure: "pressure_mentions"
    };

    timeline.forEach((event)=>{
      const blk = blocks[blockFromMinute(event.min)];
      const side = event.team === awayTeam ? awayTeam : homeTeam;
      const otherSide = side === homeTeam ? awayTeam : homeTeam;
      const key = statMap[event.type];
      if(key && blk.teams[side]) blk.teams[side][key] += 1;
      if(event.type === "save" && blk.teams[otherSide]) blk.teams[otherSide].saves_forced += 1;
      if(event.type === "goal" && blk.teams[otherSide]) blk.teams[otherSide].goals_conceded += 1;
    });

    blocks.forEach((block)=>{
      [homeTeam, awayTeam].forEach(team=>{
        const stats = block.teams[team];
        const idd =
          0.5 * stats.big_chances +
          0.4 * stats.shots +
          0.3 * stats.corners +
          0.2 * stats.pressure_mentions -
          0.6 * stats.goals_conceded -
          0.2 * stats.cards;
        stats.idd = idd;
        stats.idd_normalized = clamp(idd / 5, -1, 1);
        block.idd[team] = stats.idd_normalized;
      });
    });

    return blocks;
  }

  function generateCandles(blocks=[], team=""){
    let prev = 0;
    return blocks.map((block)=>{
      const close = Number(block.idd?.[team]) || 0;
      const open = prev;
      const high = Math.max(open, close);
      const low = Math.min(open, close);
      prev = close;
      return { block: block.block, label: block.range || (block.block===9?"90+":`${block.block*10}-${(block.block+1)*10}`), open, high, low, close };
    });
  }

  function cumulativeSum(series=[]){
    let acc = 0;
    return series.map((value)=>{
      acc += Number(value) || 0;
      return acc;
    });
  }

  function stdDev(series=[]){
    if(!series.length) return 0;
    const mean = series.reduce((sum, value)=>sum + (Number(value) || 0), 0) / series.length;
    const variance = series.reduce((sum, value)=>{
      const n = Number(value) || 0;
      return sum + (n-mean)*(n-mean);
    }, 0) / series.length;
    return Math.sqrt(variance);
  }

  function countSignChanges(series=[]){
    let prev = 0;
    return series.reduce((count, value)=>{
      const sign = (Number(value) || 0) > 0 ? 1 : ((Number(value) || 0) < 0 ? -1 : 0);
      if(sign===0) return count;
      if(prev!==0 && sign!==prev) count += 1;
      prev = sign;
      return count;
    }, 0);
  }

  function maxConsecutiveBy(series=[], predicate=()=>false){
    let curr = 0;
    let max = 0;
    series.forEach((value)=>{
      if(predicate(Number(value) || 0)){
        curr += 1;
        if(curr > max) max = curr;
      }else{
        curr = 0;
      }
    });
    return max;
  }

  function computeMomentumDiagnostic(candles=[]){
    const iddSeries = candles.map(c=>Number(c.close) || 0);
    const iddAccum = cumulativeSum(iddSeries);
    const deltas = iddAccum.slice(1).map((value, idx)=>value - iddAccum[idx]);
    const maxDeltaAbs = deltas.reduce((best, value)=>Math.max(best, Math.abs(value)), 0);
    const breakDeltaIdx = deltas.reduce((bestIdx, value, idx)=>(
      Math.abs(value) > Math.abs(deltas[bestIdx] || 0) ? idx : bestIdx
    ), 0);
    const breakIdx = deltas.length ? breakDeltaIdx + 1 : 0;
    const breakLabel = candles[breakIdx]?.label || candles[0]?.label || "-";
    const breakDelta = deltas[breakDeltaIdx] || 0;
    const vol = stdDev(iddSeries);
    const trend = (iddAccum.at(-1) || 0) - (iddAccum[0] || 0);
    const lateStrength = iddSeries.length ? (iddSeries.slice(-2).reduce((sum,v)=>sum+v,0) / Math.max(1, iddSeries.slice(-2).length)) : 0;
    const switches = countSignChanges(iddSeries);
    const greenStreakMax = maxConsecutiveBy(iddSeries, v=>v > 0.15);
    const redStreakMax = maxConsecutiveBy(iddSeries, v=>v < -0.15);
    const secondPhaseBreak = ["50-60", "60-70"].includes(breakLabel) && breakDelta < -0.2;
    const equilibrium = Math.abs(trend) < 0.2 && vol < 0.25;
    const dominantNoClose = trend > 0.2 && lateStrength < 0;
    const oscillation = switches >= 4;
    const lateWeakness = lateStrength < -0.2 || (iddSeries.at(-1) || 0) < -0.25;

    const tagScores = {
      equilibrium: clamp(1 - (Math.abs(trend)/0.2 + vol/0.25)/2, 0, 1),
      no_close: dominantNoClose ? clamp((trend/0.8) + Math.max(0, -lateStrength/0.5), 0, 1) : 0,
      second_phase_break: secondPhaseBreak ? clamp(Math.abs(breakDelta)/Math.max(0.01, maxDeltaAbs), 0, 1) : 0,
      oscillation: clamp(switches/6, 0, 1),
      late_weakness: clamp(Math.max(0, -lateStrength)/0.4, 0, 1)
    };

    const tags = [];
    if(equilibrium) tags.push("equilibrado_estable");
    if(dominantNoClose) tags.push("domino_sin_cierre");
    if(secondPhaseBreak) tags.push("second_phase_break");
    if(oscillation) tags.push("oscillation");
    if(lateWeakness) tags.push("late_weakness");

    const diagnosticText = [];
    if(Math.abs(trend) < 0.2) diagnosticText.push("Partido de equilibrio con fases alternadas.");
    else if(trend > 0.2) diagnosticText.push("Equipo A tuvo ventaja territorial global.");
    else diagnosticText.push("Equipo A fue superado en el global del desarrollo.");
    diagnosticText.push(`Quiebre principal: ${breakLabel} (cambio fuerte de momentum).`);
    diagnosticText.push(`Volatilidad: ${vol > 0.35 ? "alta" : (vol > 0.2 ? "media" : "baja")}.`);
    diagnosticText.push(`Final: ${lateStrength > 0.2 ? "fuerte" : (lateStrength < -0.2 ? "débil" : "neutral")}.`);

    if(oscillation) diagnosticText.push("Patrón: vaivén (alternancias frecuentes).");
    else if(secondPhaseBreak && lateWeakness) diagnosticText.push("Patrón: ruptura y caída final.");
    else if(greenStreakMax >= 2 && lateStrength < 0) diagnosticText.push("Patrón: acumulación estéril.");

    return {
      metrics: {
        vol,
        trend,
        breakLabel,
        breakDelta,
        lateStrength,
        switches,
        greenStreakMax,
        redStreakMax
      },
      tagScores,
      tags,
      iddSeries,
      iddAccum,
      diagnosticText
    };
  }

  function detectPatterns({ candles=[], blocks=[], team="", opponent="" }){
    const detected = [];
    let greenStreak = 0;
    let streakGoals = 0;
    candles.forEach((candle, idx)=>{
      if(candle.close > candle.open){
        greenStreak += 1;
        streakGoals += Number(blocks[idx]?.teams?.[team]?.goals || 0);
      }else{
        if(greenStreak >= 2 && streakGoals === 0) detected.push({ type: "accumulation_without_conversion", block: idx-1 });
        greenStreak = 0;
        streakGoals = 0;
      }
      if(candle.close > 0.4 && Number(blocks[idx+1]?.teams?.[opponent]?.goals || 0) > 0){
        detected.push({ type: "shock_transition", block: idx+1 });
      }
      if(candle.close < -0.3 && Number(blocks[idx]?.teams?.[team]?.saves_forced || 0) >= 2 && Number(blocks[idx]?.teams?.[team]?.goals_conceded || 0)===0){
        detected.push({ type: "low_block_success", block: idx });
      }
    });
    if(greenStreak >= 2 && streakGoals === 0) detected.push({ type: "accumulation_without_conversion", block: candles.length-1 });
    for(let i=3;i<candles.length;i++){
      const prev2 = candles[i-3].close > 0.2 && candles[i-2].close > 0.2;
      const next2 = candles[i-1].close < -0.2 && candles[i].close < -0.2;
      if(prev2 && next2) detected.push({ type: "reversion", block: i });
    }
    const pre70 = candles.slice(0,7).some(c=>c.close > 0.45);
    const post70Drop = candles.slice(7).some(c=>c.close < -0.25);
    const rivalLateGoal = blocks.slice(8).some(b=>Number(b.teams?.[opponent]?.goals || 0) > 0);
    if(pre70 && post70Drop && rivalLateGoal) detected.push({ type: "late_collapse", block: 8 });
    return detected;
  }

  function computeMomentumSignature(team, blocks=[], events=[]){
    const iddSeries = blocks.map(block=>Number(block.idd?.[team]) || 0);
    const avg_IDD = iddSeries.reduce((sum, v)=>sum+v, 0) / Math.max(1, iddSeries.length);
    const variance = iddSeries.reduce((sum, v)=>sum + (v-avg_IDD)*(v-avg_IDD), 0) / Math.max(1, iddSeries.length);
    const volatility = Math.sqrt(variance);
    const lateBlocks = blocks.filter(block=>block.block>=7);
    const late_strength = lateBlocks.reduce((sum, block)=>sum + (Number(block.idd?.[team]) || 0), 0) / Math.max(1, lateBlocks.length);
    const totals = blocks.reduce((acc, block)=>{
      const st = block.teams?.[team] || createBlockStats();
      acc.goals += Number(st.goals) || 0;
      acc.big_chances += Number(st.big_chances) || 0;
      acc.shots += Number(st.shots) || 0;
      return acc;
    }, { goals: 0, big_chances: 0, shots: 0 });
    const conversion_efficiency = clamp(totals.goals / Math.max(0.25, totals.big_chances + totals.shots*0.5), 0, 2);
    const teamGoals = events.filter(evt=>evt.type==="goal" && evt.team===team);
    const shockGoalsCount = teamGoals.filter(evt=>{
      const block = blocks[blockFromMinute(evt.min)];
      return Number(block?.idd?.[team]) < 0;
    }).length;
    const shock_goals = teamGoals.length ? shockGoalsCount / teamGoals.length : 0;
    const lowBlockSamples = blocks.filter(block=>Number(block.idd?.[team]) < -0.2);
    const lowBlockRes = lowBlockSamples.length
      ? lowBlockSamples.filter(block=>Number(block.teams?.[team]?.goals_conceded || 0)===0).length / lowBlockSamples.length
      : 0.5;

    return {
      team,
      momentumSignature: {
        avg_IDD,
        volatility,
        late_strength,
        conversion_efficiency,
        shock_goals,
        low_block_resistance: lowBlockRes
      }
    };
  }

  function signatureToPowers(signature){
    const s = signature || {};
    const attack_power =
      0.4*(Number(s.avg_IDD) || 0) +
      0.3*(Number(s.conversion_efficiency) || 0) +
      0.3*(Number(s.late_strength) || 0);
    const defense_power =
      0.5*(1 - clamp(Number(s.volatility) || 0, 0, 1)) +
      0.5*(Number(s.low_block_resistance) || 0.5);
    return { attack_power: clamp(attack_power, 0, 1.5), defense_power: clamp(defense_power, 0, 1.2) };
  }

  function updateTeamProfile(teamProfile, diagnostic){
    const current = teamProfile?.momentumSignature || null;
    const next = diagnostic?.momentumSignature || {};
    const alpha = current ? 0.25 : 1;
    const blend = (key, fallback=0)=>{
      const currV = Number(current?.[key]);
      const nextV = Number(next?.[key]);
      if(!Number.isFinite(nextV)) return Number.isFinite(currV) ? currV : fallback;
      if(!Number.isFinite(currV)) return nextV;
      return currV*(1-alpha) + nextV*alpha;
    };
    const momentumSignature = {
      avg_IDD: blend("avg_IDD", 0),
      volatility: blend("volatility", 0.5),
      late_strength: blend("late_strength", 0),
      conversion_efficiency: blend("conversion_efficiency", 0.5),
      shock_goals: blend("shock_goals", 0.3),
      low_block_resistance: blend("low_block_resistance", 0.5)
    };
    return {
      team: diagnostic?.team || teamProfile?.team || "",
      version: "momentumSignature_v1",
      samples: (Number(teamProfile?.samples) || 0) + 1,
      updatedAt: new Date().toISOString(),
      momentumSignature,
      simulation: signatureToPowers(momentumSignature)
    };
  }

  function createEarlyTeamStats(){
    return {
      shots: 0,
      bigChances: 0,
      corners: 0,
      dangerCross: 0,
      finalThird: 0,
      interceptions: 0,
      savesForced: 0,
      controlMentions: 0,
      lossMentions: 0,
      fouls: 0,
      cards: 0
    };
  }

  function detectEarlyType(line=""){
    if(/ocasi[oó]n clar[ií]sima|casi marca|mano a mano|\bsolo\b|punto de penalti/i.test(line)) return "bigChance";
    if(/dispara|remata|cabezazo|\btiro\b|disparo|chut/i.test(line)) return "shot";
    if(/c[oó]rner/i.test(line)) return "corner";
    if(/centro peligroso|cuelga al [aá]rea/i.test(line)) return "dangerCross";
    if(/dentro del [aá]rea|borde del [aá]rea|[aá]rea peque[nñ]a/i.test(line)) return "finalThird";
    if(/interceptado|despejado|rechaza/i.test(line)) return "interception";
    if(/parada|interviene|ataj|en los guantes/i.test(line)) return "save";
    if(/domina la posesi[oó]n|intercambian pases|combina/i.test(line)) return "control";
    if(/pierde la posesi[oó]n|error|bal[oó]n sale/i.test(line)) return "loss";
    if(/falta|entrada|infracci[oó]n/i.test(line)) return "foul";
    if(/tarjeta amarilla|\bamarilla\b|tarjeta roja|\broja\b/i.test(line)) return "card";
    return null;
  }

  function resolveEarlyWindow(windowKey="0-10"){
    const token = String(windowKey || "0-10").trim();
    const pair = token.match(/(\d{1,3})\s*-\s*(\d{1,3})/);
    if(pair){
      const start = Number(pair[1]);
      const end = Number(pair[2]);
      if(Number.isFinite(start) && Number.isFinite(end) && end > start){
        return { start, end, label: `${start}-${end}` };
      }
    }
    const end = Number(token);
    if(Number.isFinite(end) && end > 0) return { start: 0, end, label: `0-${end}` };
    return { start: 0, end: 10, label: "0-10" };
  }

  function parseEarlyNarrative(text, { teamA="", teamB="", windowKey="0-10" }={}){
    const windowRange = resolveEarlyWindow(windowKey);
    const lines = String(text || "").split(/\n+/).map(line=>line.trim()).filter(Boolean);
    const teams = [teamA, teamB].filter(Boolean);
    const statsByTeam = new Map();
    const pushTeam = (name)=>{
      if(!name || statsByTeam.has(name)) return;
      statsByTeam.set(name, createEarlyTeamStats());
    };
    teams.forEach(pushTeam);
    const events = [];
    let pendingMinute = null;

    const findTeamInLine = (line="")=>{
      const teamFromParens = line.match(/\(([^)]+)\)/);
      if(teamFromParens?.[1]) return teamFromParens[1].trim();
      const lineNorm = normalizeTeamToken(line);
      const explicit = [...statsByTeam.keys()].find(name=>lineNorm.includes(normalizeTeamToken(name)));
      return explicit || null;
    };

    lines.forEach(line=>{
      const minuteFound = line.match(/(\d{1,3}\s*\+\s*\d{1,2}|\d{1,3})\s*'/);
      if(minuteFound) pendingMinute = parseMinuteToken(minuteFound[1]);
      const minute = Number.isFinite(Number(pendingMinute)) ? Number(pendingMinute) : null;
      if(minute===null || minute <= windowRange.start || minute > windowRange.end) return;
      if(/^\d{1,3}\s*\+\s*\d{1,2}\s*'$/.test(line) || /^\d{1,3}\s*'$/.test(line)) return;

      const type = detectEarlyType(line);
      if(!type) return;
      const detectedTeam = findTeamInLine(line) || teamA || "Equipo A";
      pushTeam(detectedTeam);
      events.push({ minute, team: detectedTeam, type, text: line });
    });

    if(statsByTeam.size < 2) pushTeam(teamB || "Rival");
    const teamList = [...statsByTeam.keys()].slice(0, 2);
    teamList.forEach(name=>{ if(!statsByTeam.has(name)) statsByTeam.set(name, createEarlyTeamStats()); });

    events.forEach(evt=>{
      const teamStats = statsByTeam.get(evt.team);
      if(!teamStats) return;
      if(evt.type === "shot") teamStats.shots += 1;
      if(evt.type === "bigChance") teamStats.bigChances += 1;
      if(evt.type === "corner") teamStats.corners += 1;
      if(evt.type === "dangerCross") teamStats.dangerCross += 1;
      if(evt.type === "finalThird") teamStats.finalThird += 1;
      if(evt.type === "interception") teamStats.interceptions += 1;
      if(evt.type === "save") teamStats.savesForced += 1;
      if(evt.type === "control") teamStats.controlMentions += 1;
      if(evt.type === "loss") teamStats.lossMentions += 1;
      if(evt.type === "foul") teamStats.fouls += 1;
      if(evt.type === "card") teamStats.cards += 1;
      if(evt.type === "dangerCross" && /remata|disparo|tiro|cabezazo/i.test(evt.text)) teamStats.shots += 0.5;
    });

    return { teams: teamList, events, statsByTeam, windowRange };
  }

  function buildEarlyStatsFromEvents(eventsInput=[], { teamA="", teamB="", windowRange }={}){
    const events = Array.isArray(eventsInput) ? eventsInput : [];
    const teams = [teamA, teamB].filter(Boolean);
    const statsByTeam = new Map();
    const pushTeam = (name)=>{
      if(!name || statsByTeam.has(name)) return;
      statsByTeam.set(name, createEarlyTeamStats());
    };
    teams.forEach(pushTeam);

    events.forEach(evt=>{
      if(!evt?.team) return;
      pushTeam(evt.team);
      const teamStats = statsByTeam.get(evt.team);
      if(!teamStats) return;
      if(evt.type === "shot") teamStats.shots += 1;
      if(evt.type === "bigChance") teamStats.bigChances += 1;
      if(evt.type === "corner") teamStats.corners += 1;
      if(evt.type === "dangerCross") teamStats.dangerCross += 1;
      if(evt.type === "finalThird") teamStats.finalThird += 1;
      if(evt.type === "interception") teamStats.interceptions += 1;
      if(evt.type === "save") teamStats.savesForced += 1;
      if(evt.type === "control") teamStats.controlMentions += 1;
      if(evt.type === "loss") teamStats.lossMentions += 1;
      if(evt.type === "foul") teamStats.fouls += 1;
      if(evt.type === "card") teamStats.cards += 1;
      if(evt.type === "dangerCross" && /remata|disparo|tiro|cabezazo/i.test(String(evt.text || ""))) teamStats.shots += 0.5;
    });

    if(statsByTeam.size < 2) pushTeam(teamB || "Rival");
    const teamList = [...statsByTeam.keys()].slice(0, 2);
    teamList.forEach(name=>{ if(!statsByTeam.has(name)) statsByTeam.set(name, createEarlyTeamStats()); });
    const filteredEvents = events.filter(evt=>teamList.includes(evt.team));
    return { teams: teamList, statsByTeam, events: filteredEvents, windowRange };
  }

  function computeEarlyPhaseAnalyzer(text, { teamA="", teamB="", windowKey="0-10", seedProfiles={}, eventsOverride=null }={}){
    const parsed = Array.isArray(eventsOverride)
      ? buildEarlyStatsFromEvents(eventsOverride, { teamA, teamB, windowRange: resolveEarlyWindow(windowKey) })
      : parseEarlyNarrative(text, { teamA, teamB, windowKey });
    const { teams, statsByTeam, events, windowRange } = parsed;
    const [firstTeam, secondTeam] = teams;
    const a = statsByTeam.get(firstTeam) || createEarlyTeamStats();
    const b = statsByTeam.get(secondTeam) || createEarlyTeamStats();

    const total = (k)=>Number(a[k] || 0) + Number(b[k] || 0);
    const normLimit = (windowRange.end - windowRange.start) <= 10 ? 4 : 6;
    const norm = (value, max=normLimit)=>clamp((Number(value) || 0) / max, 0, 1);

    const rawIntensity =
      1.0*total("shots") +
      1.4*total("bigChances") +
      0.6*total("corners") +
      0.7*total("savesForced") +
      0.3*total("fouls");
    const intensity = clamp(rawIntensity / 6, 0, 1);

    const rawIDD = (s)=>
      0.60*s.bigChances +
      0.45*s.shots +
      0.25*s.corners +
      0.20*s.controlMentions +
      0.15*s.dangerCross -
      0.20*s.lossMentions -
      0.10*s.fouls;

    const iddDiff = rawIDD(a) - rawIDD(b);
    const iddA = clamp(iddDiff / 4, -1, 1);
    const iddB = -iddA;

    const threatOf = (s)=>clamp((1.7*s.bigChances + 1.0*s.shots + 0.4*s.finalThird + 0.3*s.savesForced) / 6, 0, 1);
    const threatA = threatOf(a);
    const threatB = threatOf(b);

    let initiative = "equilibrado";
    if(iddA > 0.12) initiative = firstTeam;
    else if(iddB > 0.12) initiative = secondTeam;

    const controlType = (()=>{
      const cornersTotal = total("corners");
      const shotsTotal = total("shots") + total("bigChances");
      const controlTotal = total("controlMentions");
      const foulsTotal = total("fouls");
      const lossTotal = total("lossMentions");
      const cornerLimit = (windowRange.end - windowRange.start) >= 20 ? 3 : 2;
      const maxThreat = Math.max(threatA, threatB);
      if(cornersTotal >= cornerLimit) return "setpiece_pressure";
      if(foulsTotal >= 4 && lossTotal >= 3 && shotsTotal <= 2) return "scrappy";
      if(controlTotal >= 3 && maxThreat < 0.45) return "territorial_probe";
      if(shotsTotal >= 4 && controlTotal <= 2) return "direct_punch";
      return "balanced";
    })();

    const shockRiskFor = (selfIdd, self, opp)=>clamp(
      0.35*Math.max(0, selfIdd) +
      0.25*norm(self.lossMentions, 4) +
      0.25*norm(opp.shots + opp.bigChances, 5) -
      0.15*norm(opp.interceptions, 5),
      0,
      1
    );
    const shockA = shockRiskFor(iddA, a, b);
    const shockB = shockRiskFor(iddB, b, a);

    const disciplineA = clamp((a.fouls + 2*a.cards) / 6, 0, 1);
    const disciplineB = clamp((b.fouls + 2*b.cards) / 6, 0, 1);
    const intensityBand = intensity < 0.35 ? "low_intensity" : (intensity < 0.7 ? "medium_intensity" : "high_intensity");
    const tags = [
      initiative===firstTeam ? "early_initiative_home" : "",
      initiative===secondTeam ? "early_initiative_away" : "",
      intensityBand,
      controlType === "setpiece_pressure" ? `setpiece_pressure_${threatA>=threatB?"home":"away"}` : "",
      controlType === "scrappy" ? "scrappy_opening" : "",
      shockA > 0.55 ? "shock_risk_home_high" : "",
      shockB > 0.55 ? "shock_risk_away_high" : ""
    ].filter(Boolean);

    const tempoWord = intensity < 0.35 ? "bajo" : (intensity < 0.7 ? "medio" : "alto");
    const dominantTeam = initiative===firstTeam ? firstTeam : (initiative===secondTeam ? secondTeam : null);
    const leaderShock = dominantTeam===firstTeam ? shockA : (dominantTeam===secondTeam ? shockB : Math.max(shockA, shockB));

    const textLines = [
      dominantTeam
        ? `Inicio con iniciativa de ${dominantTeam} y ritmo ${tempoWord}.`
        : `Inicio equilibrado con ritmo ${tempoWord}.`,
      Math.max(threatA, threatB) > 0.6
        ? "Amenaza real: llegadas claras y acciones dentro del área."
        : Math.max(threatA, threatB) >= 0.35
          ? "Amenaza moderada: aproximaciones sin ocasión clarísima."
          : "Poco peligro: más control que profundidad.",
      leaderShock > 0.55
        ? "Riesgo de shock: el rival puede castigar en transición."
        : "Bajo riesgo de transición inmediata."
    ];

    const computePsychFromProfile = (teamName)=>{
      const p = seedProfiles?.[teamName]?.earlyPsychProfile || {};
      return {
        confidence: clamp(Number(p.avgConfidence ?? 0.50), 0, 1),
        composure: clamp(Number(p.avgComposure ?? 0.55), 0, 1),
        frustration: clamp(Math.max(0.10, Number(p.sterileTendency ?? 0.10) * 0.45), 0, 1),
        belief: clamp(Number(p.avgConfidence ?? 0.50), 0, 1),
        tiltRisk: clamp(Math.max(0.20, Number(p.tiltSensitivity ?? 0.20) * 0.5), 0, 1)
      };
    };

    const psychFor = (teamName, self, opp, iddValue, threatValue, oppShockRisk)=>{
      const base = computePsychFromProfile(teamName);
      const dom = clamp((iddValue + 1) / 2, 0, 1);
      const sterilePressure = clamp(0.5*norm(self.controlMentions) + 0.5*norm(self.shots + self.corners) - 0.8*threatValue, 0, 1);
      const friction = clamp((self.fouls + 2*self.cards) / 6, 0, 1);
      const scares = clamp(norm(opp.bigChances + opp.shots + opp.savesForced), 0, 1);
      const shockSignalOpp = clamp(oppShockRisk, 0, 1);

      const confidence = clamp(
        base.confidence*0.35 +
        0.50 + 0.35*dom + 0.30*threatValue - 0.25*scares - 0.15*friction,
        0,
        1
      );
      const composure = clamp(
        base.composure*0.35 +
        0.55 - 0.35*friction - 0.20*intensity - 0.20*scares + 0.15*(1 - sterilePressure),
        0,
        1
      );
      const frustration = clamp(
        base.frustration*0.35 +
        0.10 + 0.55*sterilePressure + 0.25*norm(opp.savesForced) + 0.15*(dom > 0.6 ? 1 : 0),
        0,
        1
      );
      const belief = clamp(
        base.belief*0.35 +
        0.50 + 0.30*dom + 0.15*(1 - scares) - 0.25*shockSignalOpp,
        0,
        1
      );
      const tiltRisk = clamp(
        base.tiltRisk*0.35 +
        0.20 + 0.45*frustration + 0.35*(1 - composure) + 0.20*scares,
        0,
        1
      );
      return { confidence, composure, frustration, belief, tiltRisk, dom, sterilePressure };
    };

    const psychA = psychFor(firstTeam, a, b, iddA, threatA, shockB);
    const psychB = psychFor(secondTeam, b, a, iddB, threatB, shockA);

    const tagsPsychFor = (selfPsych, threatValue, oppShockRisk)=>{
      const tags = [];
      if(selfPsych.confidence > 0.65) tags.push("confident_start");
      if(selfPsych.composure < 0.40) tags.push("nervous_start");
      if(selfPsych.frustration > 0.60 && threatValue < 0.45) tags.push("sterile_frustration");
      if(selfPsych.tiltRisk > 0.60) tags.push("tilt_warning");
      if(oppShockRisk > 0.55 && selfPsych.dom > 0.55) tags.push("shock_fear");
      if(selfPsych.dom > 0.55 && selfPsych.composure > 0.60) tags.push("calm_control");
      return tags;
    };

    const psychTags = {
      [firstTeam]: tagsPsychFor(psychA, threatA, shockB),
      [secondTeam]: tagsPsychFor(psychB, threatB, shockA)
    };

    const psychTextFor = (teamName, pTags, selfPsych, threatValue, oppShockRisk)=>{
      const lines = [];
      if(pTags.includes("nervous_start")) lines.push("Inicio ansioso: falta temple y orden.");
      else if(pTags.includes("calm_control")) lines.push("Confianza subiendo, composure estable.");
      else if(pTags.includes("confident_start")) lines.push("Arranque con confianza y control emocional.");
      else lines.push("Inicio contenido, buscando estabilidad emocional.");

      if(pTags.includes("sterile_frustration")) lines.push("Dominio con frustración creciendo: presión sin premio claro.");
      else if(selfPsych.frustration > 0.60) lines.push("Frustración alta: cuidado con decisiones apresuradas.");
      else lines.push(threatValue >= 0.45 ? "Amenaza moderada/alta sin romper del todo el partido." : "Poco peligro directo: ritmo más de control que de daño.");

      if(pTags.includes("shock_fear")) lines.push("Rival huele shock: transición peligrosa si hay pérdida.");
      else if(pTags.includes("tilt_warning")) lines.push("Alerta de tilt: un golpe rival puede desordenar al equipo.");
      else lines.push(oppShockRisk > 0.55 ? "Riesgo de shock presente: vigilar transiciones defensivas." : "Riesgo de shock bajo en este tramo.");
      return lines.slice(0, 3);
    };

    const psychText = {
      [firstTeam]: psychTextFor(firstTeam, psychTags[firstTeam], psychA, threatA, shockB),
      [secondTeam]: psychTextFor(secondTeam, psychTags[secondTeam], psychB, threatB, shockA)
    };

    const eventWeight = { shot: 1, bigChance: 1.5, corner: 0.6, save: 0.7, control: 0.4, finalThird: 0.5, foul: 0.25, card: 0.35, dangerCross: 0.4 };
    const bucketCount = 5;
    const bucketSpan = (windowRange.end - windowRange.start) / bucketCount;
    const chartBuckets = Array.from({ length: bucketCount }, (_, idx)=>({
      start: windowRange.start + idx*bucketSpan,
      end: windowRange.start + (idx+1)*bucketSpan,
      total: 0,
      [firstTeam]: 0,
      [secondTeam]: 0
    }));
    events.forEach(evt=>{
      const idx = clamp(Math.floor((evt.minute - windowRange.start - 0.0001) / Math.max(1, bucketSpan)), 0, bucketCount-1);
      const bucket = chartBuckets[idx];
      const w = Number(eventWeight[evt.type] || 0.25);
      bucket.total += w;
      if(evt.team === firstTeam) bucket[firstTeam] += w;
      if(evt.team === secondTeam) bucket[secondTeam] += w;
    });
    const makeEMA = (series=[], alpha=0.4)=>{
      let prev = 0;
      return series.map((v, idx)=>{
        prev = idx===0 ? v : prev*(1-alpha) + v*alpha;
        return prev;
      });
    };
    const movementA = chartBuckets.map(b=>b[firstTeam]);
    const movementB = chartBuckets.map(b=>b[secondTeam]);
    const emaA = makeEMA(movementA, 0.45);
    const emaB = makeEMA(movementB, 0.45);

    const features = {
      idd: {
        [firstTeam]: iddA,
        [secondTeam]: iddB
      },
      intensity,
      initiative,
      threat: {
        [firstTeam]: threatA,
        [secondTeam]: threatB
      },
      controlType,
      shockRisk: {
        [firstTeam]: shockA,
        [secondTeam]: shockB
      },
      disciplineRisk: {
        [firstTeam]: disciplineA,
        [secondTeam]: disciplineB
      },
      psychSignals: {
        [firstTeam]: { dom: psychA.dom, sterilePressure: psychA.sterilePressure },
        [secondTeam]: { dom: psychB.dom, sterilePressure: psychB.sterilePressure }
      }
    };

    return {
      window: windowRange.label,
      teams: [firstTeam, secondTeam],
      features,
      tags,
      text: textLines,
      psych: {
        [firstTeam]: {
          confidence: psychA.confidence,
          composure: psychA.composure,
          frustration: psychA.frustration,
          belief: psychA.belief,
          tiltRisk: psychA.tiltRisk
        },
        [secondTeam]: {
          confidence: psychB.confidence,
          composure: psychB.composure,
          frustration: psychB.frustration,
          belief: psychB.belief,
          tiltRisk: psychB.tiltRisk
        }
      },
      psychTags,
      psychText,
      psychChart: {
        buckets: chartBuckets.map((b, idx)=>({
          idx,
          label: `${Math.round(b.start)}-${Math.round(b.end)}`,
          intensity: clamp(b.total / 3, 0, 1),
          [firstTeam]: b[firstTeam],
          [secondTeam]: b[secondTeam],
          ema: {
            [firstTeam]: emaA[idx],
            [secondTeam]: emaB[idx]
          }
        }))
      },
      signatureUpdate: {
        [firstTeam]: {
          early_idd: iddA,
          early_intensity: intensity,
          early_threat: threatA,
          early_shockRisk: shockA,
          openingType: controlType,
          early_psych: { confidence: psychA.confidence, composure: psychA.composure, frustration: psychA.frustration, tiltRisk: psychA.tiltRisk }
        },
        [secondTeam]: {
          early_idd: iddB,
          early_intensity: intensity,
          early_threat: threatB,
          early_shockRisk: shockB,
          openingType: controlType,
          early_psych: { confidence: psychB.confidence, composure: psychB.composure, frustration: psychB.frustration, tiltRisk: psychB.tiltRisk }
        }
      }
    };
  }

  function updateTeamEarlyProfile(teamProfile, teamName, update={}){
    const profile = structuredClone(teamProfile || {});
    const current = profile.earlyProfile || {
      n: 0,
      avgEarlyIDD: 0,
      avgEarlyIntensity: 0,
      avgEarlyThreat: 0,
      avgEarlyShockRisk: 0,
      openingTypes: {
        territorial_probe: 0,
        direct_punch: 0,
        setpiece_pressure: 0,
        scrappy: 0,
        balanced: 0
      }
    };
    const n = Number(current.n) || 0;
    const nextN = n + 1;
    const avg = (oldValue, newValue)=>((Number(oldValue) || 0)*n + (Number(newValue) || 0)) / Math.max(1, nextN);
    const openingTypes = { ...current.openingTypes };
    const seenTypes = ["territorial_probe", "direct_punch", "setpiece_pressure", "scrappy", "balanced"];
    seenTypes.forEach(type=>{
      const prevCount = (Number(openingTypes[type]) || 0) * n;
      const nextCount = prevCount + (update.openingType === type ? 1 : 0);
      openingTypes[type] = nextCount / Math.max(1, nextN);
    });

    profile.team = teamName || profile.team || "";
    profile.version = profile.version || "momentumSignature_v1";
    profile.updatedAt = new Date().toISOString();
    profile.earlyProfile = {
      n: nextN,
      avgEarlyIDD: avg(current.avgEarlyIDD, update.early_idd),
      avgEarlyIntensity: avg(current.avgEarlyIntensity, update.early_intensity),
      avgEarlyThreat: avg(current.avgEarlyThreat, update.early_threat),
      avgEarlyShockRisk: avg(current.avgEarlyShockRisk, update.early_shockRisk),
      openingTypes
    };

    const psychCurrent = profile.earlyPsychProfile || {
      n: 0,
      avgConfidence: 0.50,
      avgComposure: 0.55,
      avgFrustration: 0.10,
      avgTiltRisk: 0.20,
      tiltSensitivity: 0.20,
      sterileTendency: 0.10
    };
    const psychN = Number(psychCurrent.n) || 0;
    const psychNextN = psychN + 1;
    const a = psychN > 20 ? 0.08 : 0.15;
    const ema = (oldValue, newValue, fallback)=>{
      const oldV = Number.isFinite(Number(oldValue)) ? Number(oldValue) : fallback;
      const newV = Number.isFinite(Number(newValue)) ? Number(newValue) : oldV;
      return oldV*(1-a) + newV*a;
    };
    const psychIn = update.early_psych || {};
    profile.earlyPsychProfile = {
      n: psychNextN,
      avgConfidence: ema(psychCurrent.avgConfidence, psychIn.confidence, 0.50),
      avgComposure: ema(psychCurrent.avgComposure, psychIn.composure, 0.55),
      avgFrustration: ema(psychCurrent.avgFrustration, psychIn.frustration, 0.10),
      avgTiltRisk: ema(psychCurrent.avgTiltRisk, psychIn.tiltRisk, 0.20),
      tiltSensitivity: ema(psychCurrent.tiltSensitivity, psychIn.tiltRisk, 0.20),
      sterileTendency: ema(psychCurrent.sterileTendency, psychIn.frustration, 0.10)
    };
    return profile;
  }

  function safeParseJson(raw){
    if(raw && typeof raw === "object") return raw;
    const text = String(raw || "").trim();
    if(!text) return null;
    try{
      const parsed = JSON.parse(text);
      if(typeof parsed === "string"){
        try{
          return JSON.parse(parsed);
        }catch(_e2){
          return null;
        }
      }
      return parsed;
    }catch(_e){
      if((text.startsWith('"{') && text.endsWith('}"')) || (text.startsWith("'{") && text.endsWith("}'"))){
        try{
          return JSON.parse(text.slice(1, -1));
        }catch(_e3){
          return null;
        }
      }
      return null;
    }
  }

  function normalizeIncomingLpePayload(payload={}){
    if(payload?.kind !== "match_stats") return payload;

    const parseNum = (candidate)=>{
      const direct = Number(candidate);
      if(Number.isFinite(direct)) return direct;
      const raw = String(candidate ?? "").replace(/%/g, "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
      return raw ? Number(raw[0]) : 0;
    };

    const categoryMap = {
      "Remates a puerta": "shotsOn",
      "Remates totales": "shots",
      "Grandes ocasiones": "bigChances",
      "Córneres": "corners",
      "Posesión": "possession",
      "Faltas": "fouls",
      "Tarjetas amarillas": "yellows",
      "Ataques peligrosos": "dangerAttacks",
      "Ataques de peligro": "dangerAttacks",
      "Peligrosos ataques": "dangerAttacks"
    };

    const stats = { home: {}, away: {} };
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    sections.forEach(section=>{
      (section?.stats || []).forEach(stat=>{
        const key = categoryMap[String(stat?.category || "").trim()];
        if(!key) return;
        const homeNum = parseNum(stat?.home?.numeric ?? stat?.home?.main ?? stat?.home?.raw ?? stat?.home);
        const awayNum = parseNum(stat?.away?.numeric ?? stat?.away?.main ?? stat?.away?.raw ?? stat?.away);
        stats.home[key] = homeNum;
        stats.away[key] = awayNum;
      });
    });

    const matchup = String(payload?.team?.name || "");
    const teamMatch = matchup.match(/^(.+?)\s+vs\s+(.+?)(?:\s*\(|$)/i);
    const teams = teamMatch
      ? { home: teamMatch[1].trim(), away: teamMatch[2].trim() }
      : payload?.teams || { home: "Home", away: "Away" };

    const pageUrl = String(payload?.pageUrl || "");
    const midMatch = pageUrl.match(/[?&]mid=([^&]+)/i);
    const fallbackId = `${teams.home || "home"}_vs_${teams.away || "away"}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    return {
      matchId: payload?.matchId || (midMatch ? `mid_${midMatch[1]}` : fallbackId || `TMP-${Date.now()}`),
      teams,
      score: payload?.score || { home: 0, away: 0 },
      stats,
      window: payload?.window || payload?.minuteWindow || payload?.capturedAt || "live",
      source: payload?.source || "match_stats"
    };
  }

  function lpeNormDanger(value){
    return clamp((Number(value) || 0) / 22, 0, 1);
  }

  function lpeNormPossession(value){
    if(value===undefined || value===null || value==="") return 0.5;
    return clamp((Number(value) || 0) / 100, 0, 1);
  }

  function lpeReadStat(stats, teamKey, stat){
    return Number(stats?.[teamKey]?.[stat] || 0);
  }

  function lpeStateModifier(scoreDiff=0, minute=0){
    const gameWeight = clamp((Number(minute) || 0) / 90, 0, 1);
    return clamp(-(Number(scoreDiff) || 0) * 0.05 * (0.6 + gameWeight), -0.15, 0.15);
  }

  function computeLiveProjectionWindow(payload={}, context={}){
    const stats = payload.stats || {};
    const score = payload.score || {};
    const homeShotsOn = lpeReadStat(stats, "home", "shotsOn");
    const awayShotsOn = lpeReadStat(stats, "away", "shotsOn");
    const homeShots = lpeReadStat(stats, "home", "shots");
    const awayShots = lpeReadStat(stats, "away", "shots");
    const homeBig = lpeReadStat(stats, "home", "bigChances");
    const awayBig = lpeReadStat(stats, "away", "bigChances");
    const homeCorners = lpeReadStat(stats, "home", "corners");
    const awayCorners = lpeReadStat(stats, "away", "corners");
    const homeDanger = lpeReadStat(stats, "home", "dangerAttacks");
    const awayDanger = lpeReadStat(stats, "away", "dangerAttacks");
    const homePoss = lpeNormPossession(stats?.home?.possession);
    const awayPoss = lpeNormPossession(stats?.away?.possession);
    const homeFouls = lpeReadStat(stats, "home", "fouls");
    const awayFouls = lpeReadStat(stats, "away", "fouls");
    const homeYellows = lpeReadStat(stats, "home", "yellows");
    const awayYellows = lpeReadStat(stats, "away", "yellows");

    const iddRaw = ({ shotsOn, shots, big, corners, danger, poss, fouls, yellows })=>
      0.55*shotsOn +
      0.40*shots +
      0.35*big +
      0.20*corners +
      0.15*lpeNormDanger(danger) +
      0.10*poss -
      0.10*fouls -
      0.25*yellows;

    const homeIddRaw = iddRaw({ shotsOn: homeShotsOn, shots: homeShots, big: homeBig, corners: homeCorners, danger: homeDanger, poss: homePoss, fouls: homeFouls, yellows: homeYellows });
    const awayIddRaw = iddRaw({ shotsOn: awayShotsOn, shots: awayShots, big: awayBig, corners: awayCorners, danger: awayDanger, poss: awayPoss, fouls: awayFouls, yellows: awayYellows });
    const iddDiff = awayIddRaw - homeIddRaw;
    const iddAway = clamp(iddDiff / 4, -1, 1);
    const iddHome = -iddAway;

    const shotsTotal = homeShots + awayShots + homeShotsOn + awayShotsOn;
    const cornersTotal = homeCorners + awayCorners;
    const bigTotal = homeBig + awayBig;
    const foulsTotal = homeFouls + awayFouls;
    const intensity = clamp((shotsTotal + cornersTotal + bigTotal + foulsTotal*0.3) / 10, 0, 1);
    const threatHome = clamp((homeBig*1.6 + homeShotsOn*1.2 + homeShots*0.5 + homeCorners*0.25) / 6, 0, 1);
    const threatAway = clamp((awayBig*1.6 + awayShotsOn*1.2 + awayShots*0.5 + awayCorners*0.25) / 6, 0, 1);
    const dangerTotalNorm = lpeNormDanger(homeDanger + awayDanger);
    const pace = clamp((shotsTotal + foulsTotal + cornersTotal + dangerTotalNorm) / 14, 0, 1);

    const prevFast = Number(context?.fastEma?.idd?.away || 0);
    const prevSlow = Number(context?.ema?.idd?.away || 0);
    const prevFastThreat = Number(context?.fastEma?.threat?.edge || 0);
    const prevSlowThreat = Number(context?.ema?.threat?.edge || 0);
    const fastAlpha = 0.55;
    const slowAlpha = 0.18;

    const fastAway = prevFast*(1-fastAlpha) + iddAway*fastAlpha;
    const slowAway = prevSlow*(1-slowAlpha) + iddAway*slowAlpha;
    const threatEdge = threatAway - threatHome;
    const fastThreat = prevFastThreat*(1-fastAlpha) + threatEdge*fastAlpha;
    const slowThreat = prevSlowThreat*(1-slowAlpha) + threatEdge*slowAlpha;

    const regimeDeltaIdd = Math.abs(fastAway - slowAway);
    const regimeDeltaThreat = Math.abs(fastThreat - slowThreat);
    const regimeDelta = Math.max(regimeDeltaIdd, regimeDeltaThreat);

    const lastUncertaintyIdd = Number(context?.uncertainty?.idd || 0.18);
    const lastUncertaintyThreat = Number(context?.uncertainty?.threat || 0.22);
    const uncertaintyIdd = clamp(0.85*lastUncertaintyIdd + 0.15*Math.abs(iddAway - slowAway), 0.05, 0.6);
    const uncertaintyThreat = clamp(0.85*lastUncertaintyThreat + 0.15*Math.abs(threatEdge - slowThreat), 0.05, 0.6);
    const zIdd = (iddAway - slowAway) / (uncertaintyIdd + 0.05);

    const previousStreak = Number(context?.zStreak || 0);
    const zStreak = Math.abs(zIdd) > 1.6 ? previousStreak + 1 : 0;
    const minuteLabel = String(payload.window || payload.minuteWindow || payload.minute || "live");
    const windowEnd = Number(String(minuteLabel).split("-").slice(-1)[0]) || 0;
    const scoreDiff = (Number(score.away) || 0) - (Number(score.home) || 0);
    const iddNext = clamp(0.55*fastAway + 0.45*slowAway + lpeStateModifier(scoreDiff, windowEnd), -1, 1);
    const epi = clamp(
      0.45*intensity +
      0.35*pace +
      0.30*Math.max(threatHome, threatAway) +
      0.25*regimeDelta,
      0,
      1
    );

    const alerts = [];
    const dominantTeam = iddAway > 0 ? "away" : "home";
    if(Math.abs(zIdd) > 2.2){
      alerts.push({ type: "SHIFT", minuteWindow: minuteLabel, team: dominantTeam, why: `z=${zIdd.toFixed(2)}, regimeDelta=${regimeDelta.toFixed(2)}` });
    }
    if(regimeDelta > 0.22){
      alerts.push({ type: "TREND_BREAK", minuteWindow: minuteLabel, team: dominantTeam, why: `regimeDelta=${regimeDelta.toFixed(2)}` });
    }
    if(zStreak >= 2){
      alerts.push({ type: "SUSTAINED_CHANGE", minuteWindow: minuteLabel, team: dominantTeam, why: `abs(z)>1.6 por ${zStreak} ventanas` });
    }
    if(epi > 0.75){
      alerts.push({ type: "EPI_SPIKE", minuteWindow: minuteLabel, level: Number(epi.toFixed(2)) });
    }

    const epaPsych = context?.epaPsych || null;
    const frustrationA = Number(epaPsych?.home?.frustration ?? epaPsych?.away?.frustration ?? NaN);
    const frustrationB = Number(epaPsych?.away?.frustration ?? NaN);
    if(alerts.some(a=>a.type==="SHIFT") && Number.isFinite(frustrationA) && Number.isFinite(frustrationB)){
      const frustrationDelta = Math.abs(frustrationA - frustrationB);
      if(frustrationDelta < 0.08){
        alerts.push({ type: "TACTICAL_SHIFT", minuteWindow: minuteLabel, why: "Cambio táctico/ritmo no reflejado emocionalmente" });
      }
    }

    const state = {
      idd: { home: iddHome, away: iddAway },
      intensity,
      threat: { home: threatHome, away: threatAway },
      pace,
      projection: {
        iddNext,
        dominance: iddNext > 0 ? `Away +${Math.abs(iddNext).toFixed(2)}` : `Home +${Math.abs(iddNext).toFixed(2)}`,
        shockRisk: epi > 0.75 ? "alto" : epi > 0.55 ? "medio" : "bajo",
        eventTension: epi
      }
    };

    return {
      state,
      ema: {
        idd: { home: -slowAway, away: slowAway },
        threat: { home: -slowThreat, away: slowThreat, edge: slowThreat }
      },
      fastEma: {
        idd: { home: -fastAway, away: fastAway },
        threat: { home: -fastThreat, away: fastThreat, edge: fastThreat }
      },
      uncertainty: { idd: uncertaintyIdd, threat: uncertaintyThreat },
      regimeDelta,
      zScore: zIdd,
      zStreak,
      alerts,
      window: minuteLabel,
      score: { home: Number(score.home) || 0, away: Number(score.away) || 0 }
    };
  }

  function updateLiveProjectionState(prevState={}, payload={}, context={}){
    const previous = prevState || {};
    const k = Number(previous.k || 0) + 1;
    const update = computeLiveProjectionWindow(payload, {
      fastEma: previous.fastEma,
      ema: previous.ema,
      uncertainty: previous.uncertainty,
      zStreak: previous.zStreak,
      epaPsych: context.epaPsych
    });
    return {
      matchId: payload.matchId || previous.matchId || uid("lpe"),
      teams: payload.teams || previous.teams || { home: "Home", away: "Away" },
      k,
      state: update.state,
      ema: update.ema,
      fastEma: update.fastEma,
      uncertainty: update.uncertainty,
      regimeDelta: update.regimeDelta,
      zScore: update.zScore,
      zStreak: update.zStreak,
      projections: update.state.projection,
      score: update.score,
      lastWindow: update.window,
      history: [...(previous.history || []), {
        k,
        window: update.window,
        iddAway: update.state.idd.away,
        fastAway: update.fastEma.idd.away,
        slowAway: update.ema.idd.away,
        epi: update.state.projection.eventTension
      }].slice(-24),
      alerts: [...(previous.alerts || []), ...update.alerts].slice(-40),
      updatedAt: new Date().toISOString()
    };
  }

  function extractNarratedEvents(rawText, teams){
    const lines = String(rawText || "").split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const events = [];
    const counters = {
      home: { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, savesNarrated: 0, cards: 0, interceptions: 0 },
      away: { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, savesNarrated: 0, cards: 0, interceptions: 0 }
    };
    const teamNameMap = [
      { key: "home", name: String(teams?.home || "").toLowerCase() },
      { key: "away", name: String(teams?.away || "").toLowerCase() }
    ];
    let pendingMinute = null;

    lines.forEach(line=>{
      const minuteFound = line.match(/(\d{1,3}\s*\+\s*\d{1,2}|\d{1,3})\s*'/);
      if(minuteFound) pendingMinute = parseMinuteToken(minuteFound[1]);
      if(/^\d{1,3}\s*\+\s*\d{1,2}\s*'$/.test(line) || /^\d{1,3}\s*'$/.test(line)) return;

      let type = null;
      if(/¡?gol!?/i.test(line)) type = "goal";
      else if(/tarjeta amarilla|amonestad/i.test(line)) type = "yellow";
      else if(/sustituci[oó]n|\bcambio\.?/i.test(line)) type = "sub";
      else if(/c[oó]rner/i.test(line)) type = "corner";
      else if(/fuera de juego/i.test(line)) type = "offside";
      else if(/falta|infracci[oó]n/i.test(line)) type = "foul";
      else if(/parada|atajada/i.test(line)) type = "save";
      if(!type) return;

      const playerTeam = line.match(/([A-Za-zÀ-ÿ' .-]+)\s*\(([^)]+)\)/);
      const player = playerTeam ? playerTeam[1].trim() : undefined;
      const teamFromPlayer = playerTeam ? playerTeam[2].trim() : "";
      const lineLower = line.toLowerCase();
      const teamGuess = teamNameMap.find(t=>t.name && (lineLower.includes(t.name) || teamFromPlayer.toLowerCase().includes(t.name)));
      const team = teamGuess ? teams[teamGuess.key] : (teamFromPlayer || undefined);

      const event = { min: pendingMinute ?? null, type, team };
      if(player) event.player = player;
      events.push(event);

      const side = team===teams?.home ? "home" : team===teams?.away ? "away" : null;
      if(side){
        if(type==="corner") counters[side].corners += 1;
        if(type==="yellow") counters[side].cards += 1;
        if(type==="save") counters[side].savesNarrated += 1;
        if(/dispara|cabecea|centra peligroso|remata/i.test(line)) counters[side].attacksNarrated += 1;
        if(/ocasi[oó]n clar[ií]sima|casi marca|remata dentro del [aá]rea/i.test(line)) counters[side].bigChancesNarrated += 1;
        if(/interceptad|despejad/i.test(line)) counters[side].interceptions += 1;
      }
    });

    return { events, counters, lines };
  }

  function normalizeStat(value, scale=8){
    return clamp((Number(value) || 0) / scale, 0, 1);
  }

  function buildNarrativeDiagnostic({ match, teams, parsed }){
    const goalsHome = Number(match.homeGoals) || 0;
    const goalsAway = Number(match.awayGoals) || 0;
    const losingSide = goalsHome===goalsAway ? null : (goalsHome<goalsAway ? "home" : "away");
    const winnerSide = goalsHome===goalsAway ? null : (goalsHome>goalsAway ? "home" : "away");
    const breakMinute = parsed.events.find(e=>e.type==="goal")?.min ?? null;
    const losingC = losingSide ? parsed.counters[losingSide] : { corners: 0, attacksNarrated: 0, bigChancesNarrated: 0, cards: 0, interceptions: 0 };
    const winnerC = winnerSide ? parsed.counters[winnerSide] : { savesNarrated: 0 };
    const loserGoals = losingSide==="home" ? goalsHome : losingSide==="away" ? goalsAway : 0;

    const control_without_conversion = clamp(
      0.5*normalizeStat(losingC.attacksNarrated, 12) +
      0.3*normalizeStat(losingC.corners, 7) +
      0.4*normalizeStat(losingC.bigChancesNarrated, 5) -
      0.7*normalizeStat(loserGoals, 3),
      0,
      1
    );
    const transition_punished = breakMinute ? 0.4 : 0;
    const low_block_resistance = clamp(
      0.4*normalizeStat(losingC.corners, 8) +
      0.4*normalizeStat(losingC.interceptions, 8) +
      0.3*normalizeStat(winnerC.savesNarrated, 8),
      0,
      1
    );
    const late_push = parsed.events.filter(e=>Number(e.min)>=75 && losingSide && e.team===teams[losingSide] && ["corner", "foul", "goal"].includes(e.type)).length;
    const late_goal_by_winner = parsed.events.some(e=>e.type==="goal" && Number(e.min)>=90 && winnerSide && e.team===teams[winnerSide]);
    const late_risk_exposure = clamp(normalizeStat(late_push, 5) + (late_goal_by_winner ? 0.35 : 0), 0, 1);
    const earlyYellows = parsed.events.filter(e=>e.type==="yellow" && Number(e.min)>0 && Number(e.min)<35);
    const discipline_impact = clamp(normalizeStat(earlyYellows.length, 3) + normalizeStat(losingC.cards, 6) * 0.6, 0, 1);

    const labels = { control_without_conversion, transition_punished, low_block_resistance, discipline_impact, late_risk_exposure };
    const summary = [
      control_without_conversion>0.55 ? `${teams[losingSide] || "Un equipo"} generó volumen sin convertir.` : "Partido equilibrado sin gran brecha de conversión.",
      breakMinute ? `El minuto quiebre fue el ${breakMinute}', cambiando el guion.` : "Sin minuto de quiebre claro en el relato.",
      late_risk_exposure>0.55 ? "El cierre mostró exposición al riesgo en tramo final." : "Tramo final relativamente controlado."
    ];
    return { breakMinute, labels, summary };
  }

  function applyDiagnosticToProfiles(db, { match, diagnostic }){
    const home = db.teams.find(t=>t.id===match.homeId);
    const away = db.teams.find(t=>t.id===match.awayId);
    const homeP = getOrCreateDiagProfile(db, match.homeId, home?.name || "Local");
    const awayP = getOrCreateDiagProfile(db, match.awayId, away?.name || "Visitante");
    const alphaHome = homeP.matchesCount<5 ? 0.2 : 0.12;
    const alphaAway = awayP.matchesCount<5 ? 0.2 : 0.12;
    const labels = diagnostic.labels || {};
    const homeWon = (Number(match.homeGoals)||0) > (Number(match.awayGoals)||0);
    const awayWon = (Number(match.awayGoals)||0) > (Number(match.homeGoals)||0);

    const homeSignals = {
      territorial_strength: homeWon ? 0.62 : 0.55,
      finishing_quality: homeWon ? 0.65 : 1 - (labels.control_without_conversion || 0.5),
      transition_attack: homeWon ? 0.55 + (labels.transition_punished || 0.4)*0.35 : 0.48,
      transition_defense: clamp(0.7 - (labels.transition_punished || 0.4)*0.5, 0, 1),
      low_block_execution: homeWon ? 0.55 + (labels.low_block_resistance || 0.5)*0.3 : 0.5,
      chance_creation: clamp(0.52 + (labels.control_without_conversion || 0.5)*0.25, 0, 1),
      discipline_risk: labels.discipline_impact || 0.4,
      late_game_management: clamp(0.65 - (labels.late_risk_exposure || 0.4)*0.3 + (homeWon ? 0.1 : -0.05), 0, 1)
    };
    const awaySignals = {
      territorial_strength: awayWon ? 0.62 : 0.55,
      finishing_quality: awayWon ? 0.65 : 1 - (labels.control_without_conversion || 0.5),
      transition_attack: awayWon ? 0.55 + (labels.transition_punished || 0.4)*0.35 : 0.48,
      transition_defense: clamp(0.7 - (labels.transition_punished || 0.4)*0.5, 0, 1),
      low_block_execution: awayWon ? 0.55 + (labels.low_block_resistance || 0.5)*0.3 : 0.5,
      chance_creation: clamp(0.52 + (labels.control_without_conversion || 0.5)*0.25, 0, 1),
      discipline_risk: labels.discipline_impact || 0.4,
      late_game_management: clamp(0.65 - (labels.late_risk_exposure || 0.4)*0.3 + (awayWon ? 0.1 : -0.05), 0, 1)
    };

    Object.keys(homeP.traits).forEach(key=>{
      homeP.traits[key] = clamp(homeP.traits[key] * (1-alphaHome) + (homeSignals[key] ?? 0.5) * alphaHome, 0, 1);
      awayP.traits[key] = clamp(awayP.traits[key] * (1-alphaAway) + (awaySignals[key] ?? 0.5) * alphaAway, 0, 1);
    });
    homeP.matchesCount += 1;
    awayP.matchesCount += 1;
    homeP.lastUpdated = new Date().toISOString();
    awayP.lastUpdated = new Date().toISOString();
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

    ensureDiagProfileState(db);
    const homeProfile = db.diagProfiles?.[homeId];
    const awayProfile = db.diagProfiles?.[awayId];
    if(homeProfile && awayProfile){
      const ht = homeProfile.traits || {};
      const at = awayProfile.traits || {};
      const attackPowerHome = 0.45*(Number(ht.territorial_strength)||0.5) + 0.35*(Number(ht.chance_creation)||0.5) + 0.2*(Number(ht.finishing_quality)||0.5);
      const attackPowerAway = 0.45*(Number(at.territorial_strength)||0.5) + 0.35*(Number(at.chance_creation)||0.5) + 0.2*(Number(at.finishing_quality)||0.5);
      const defensePowerHome = 0.55*(Number(ht.transition_defense)||0.5) + 0.45*(Number(ht.low_block_execution)||0.5);
      const defensePowerAway = 0.55*(Number(at.transition_defense)||0.5) + 0.45*(Number(at.low_block_execution)||0.5);
      const matchupHome = clamp(0.85 + attackPowerHome*0.4 - defensePowerAway*0.25, 0.7, 1.3);
      const matchupAway = clamp(0.85 + attackPowerAway*0.4 - defensePowerHome*0.25, 0.7, 1.3);
      const transitionShockHome = clamp((Number(ht.transition_attack)||0.5) - (Number(at.transition_defense)||0.5), -0.35, 0.35);
      const transitionShockAway = clamp((Number(at.transition_attack)||0.5) - (Number(ht.transition_defense)||0.5), -0.35, 0.35);
      lHome *= matchupHome * (1 + transitionShockHome*0.2);
      lAway *= matchupAway * (1 + transitionShockAway*0.2);
    }

    const homeMomentumProfileRaw = homeTeam?.name ? localStorage.getItem(`team_profile_${homeTeam.name}`) : null;
    const awayMomentumProfileRaw = awayTeam?.name ? localStorage.getItem(`team_profile_${awayTeam.name}`) : null;
    let homeMomentum = null;
    let awayMomentum = null;
    try{ homeMomentum = homeMomentumProfileRaw ? JSON.parse(homeMomentumProfileRaw) : null; }catch(_e){ homeMomentum = null; }
    try{ awayMomentum = awayMomentumProfileRaw ? JSON.parse(awayMomentumProfileRaw) : null; }catch(_e){ awayMomentum = null; }
    if(homeMomentum?.simulation && awayMomentum?.simulation){
      const homeAttack = clamp(Number(homeMomentum.simulation.attack_power) || 0.5, 0, 1.5);
      const awayAttack = clamp(Number(awayMomentum.simulation.attack_power) || 0.5, 0, 1.5);
      const homeDefense = clamp(Number(homeMomentum.simulation.defense_power) || 0.5, 0, 1.2);
      const awayDefense = clamp(Number(awayMomentum.simulation.defense_power) || 0.5, 0, 1.2);
      const homeShock = clamp(Number(homeMomentum.momentumSignature?.shock_goals) || 0, 0, 1);
      const awayShock = clamp(Number(awayMomentum.momentumSignature?.shock_goals) || 0, 0, 1);
      lHome *= clamp(0.85 + homeAttack*(1-awayDefense), 0.78, 1.3) * (1 + homeShock*0.08);
      lAway *= clamp(0.85 + awayAttack*(1-homeDefense), 0.78, 1.3) * (1 + awayShock*0.08);
    }

    const homeIntel = computeTeamIntelligencePanel(db, homeId);
    const awayIntel = computeTeamIntelligencePanel(db, awayId);
    const attackVsDefenseHome = clamp((homeIntel.prediction.offenseRating - awayIntel.prediction.defenseRating) / 100, -0.35, 0.35);
    const attackVsDefenseAway = clamp((awayIntel.prediction.offenseRating - homeIntel.prediction.defenseRating) / 100, -0.35, 0.35);
    const psychBoostHome = clamp((homeIntel.prediction.psychIndex - awayIntel.prediction.psychIndex) / 260, -0.22, 0.22);
    const psychBoostAway = clamp((awayIntel.prediction.psychIndex - homeIntel.prediction.psychIndex) / 260, -0.22, 0.22);
    const momentumWeightHome = clamp(((homeIntel.metrics.momentum5 || 0.5) - (awayIntel.metrics.momentum5 || 0.5)) * 0.22, -0.16, 0.16);
    const momentumWeightAway = clamp(((awayIntel.metrics.momentum5 || 0.5) - (homeIntel.metrics.momentum5 || 0.5)) * 0.22, -0.16, 0.16);
    const homeBoost = clamp((Number(engineForTeam(db, homeId)?.haTraits?.homeBoost) || 0) * 0.08, -0.12, 0.16);
    const awayTravelPenalty = clamp((Number(engineForTeam(db, awayId)?.haTraits?.travelTilt) || 0) * 0.06, -0.12, 0.14);

    lHome *= clamp(1 + attackVsDefenseHome + psychBoostHome + momentumWeightHome + homeBoost - awayTravelPenalty, 0.7, 1.42);
    lAway *= clamp(1 + attackVsDefenseAway + psychBoostAway + momentumWeightAway, 0.7, 1.35);

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
          teamBias: { home: homeBias, away: awayBias },
          intelligenceBlend: {
            home: homeIntel.prediction,
            away: awayIntel.prediction,
            attackVsDefenseHome,
            attackVsDefenseAway,
            psychBoostHome,
            psychBoostAway,
            momentumWeightHome,
            momentumWeightAway
          }
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

    const tabs = ["home","liga","tracker","versus","momentum","bitacora"];
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
          <div style="font-weight:800;margin-bottom:8px;">Backup completo de Football Lab</div>
          <div class="fl-muted">Exporta e importa <b>todos</b> los datos guardados en footballDB para recuperar tu estado completo.</div>
          <textarea id="jsonBackup" class="fl-text" placeholder='{"settings":{},"leagues":[],"teams":[],"players":[],"tracker":[]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="fillBackup">Cargar backup actual</button>
            <button class="fl-btn" id="downloadBackup">Descargar .json</button>
            <button class="fl-btn" id="runBackupImport">Importar backup completo</button>
            <span id="backupStatus" class="fl-muted"></span>
          </div>
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
      const backupEl = document.getElementById("jsonBackup");
      const backupStatusEl = document.getElementById("backupStatus");
      const setBackupStatus = (msg)=>{ backupStatusEl.textContent = msg; };

      const fillBackupTextarea = ()=>{
        backupEl.value = JSON.stringify(loadDb(), null, 2);
        setBackupStatus("✅ Backup completo cargado en el cuadro.");
      };

      document.getElementById("fillBackup").onclick = ()=>{
        fillBackupTextarea();
      };

      document.getElementById("downloadBackup").onclick = ()=>{
        try{
          const snapshot = JSON.stringify(loadDb(), null, 2);
          backupEl.value = snapshot;
          const blob = new Blob([snapshot], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const now = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
          a.href = url;
          a.download = `footballlab-backup-${now}.json`;
          a.click();
          URL.revokeObjectURL(url);
          setBackupStatus("✅ Backup descargado.");
        }catch(err){
          setBackupStatus(`❌ ${String(err.message || err)}`);
        }
      };

      document.getElementById("runBackupImport").onclick = ()=>{
        try{
          const raw = backupEl.value.trim();
          if(!raw) throw new Error("Pega un JSON de backup completo.");
          const parsed = JSON.parse(raw);
          if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)){
            throw new Error("El backup debe ser un objeto JSON válido.");
          }
          saveDb(parsed);
          const normalized = loadDb();
          saveDb(normalized);
          backupEl.value = JSON.stringify(normalized, null, 2);
          setBackupStatus("✅ Backup importado. Football Lab quedó restaurado.");
        }catch(err){
          setBackupStatus(`❌ ${String(err.message || err)}`);
        }
      };

      fillBackupTextarea();

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
      const behavior = buildTeamBehaviorSeries(db, team.id);
      const engine = recomputeTeamGlobalEngine(db, team.id) || getOrCreateDiagProfile(db, team.id, team.name).engineV1;
      const intel = computeTeamIntelligencePanel(db, team.id);
      const gaugeAngle = Math.round(clamp(Number(intel.metrics.powerIndex) || 0, 0, 100) * 3.6);
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
            <button class="fl-btn" data-open-engine-modal="${m.id}">EPA/EMA/HAE</button>
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
          <div style="font-weight:900;font-size:18px;margin-bottom:8px;">🧠 Team Intelligence Panel v2</div>
          <div class="fl-row" style="align-items:center;gap:16px;flex-wrap:wrap;">
            <div style="width:180px;height:180px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#1f6feb ${gaugeAngle}deg,#2d333b ${gaugeAngle}deg);padding:10px;">
              <div style="width:100%;height:100%;border-radius:50%;background:#0f141b;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div class="fl-mini">TEAM POWER INDEX</div>
                <div style="font-size:38px;font-weight:900;line-height:1;">${Math.round(intel.metrics.powerIndex)}</div>
                <div class="fl-mini">/100</div>
              </div>
            </div>
            <div style="flex:1;min-width:300px;">
              <div class="fl-kpi" style="margin-bottom:8px;">
                <div><span class="fl-mini">Tendencia</span><b>${intel.metrics.trend}</b></div>
                <div><span class="fl-mini">Consistencia</span><b>${Math.round(intel.metrics.consistencyScore)}%</b></div>
                <div><span class="fl-mini">Momentum 5</span><b>${Math.round((intel.metrics.momentum5||0)*100)}%</b></div>
                <div><span class="fl-mini">ELO dinámico</span><b>${intel.prediction.eloDynamic}</b></div>
                <div><span class="fl-mini">Off/Def</span><b>${Math.round(intel.prediction.offenseRating)} / ${Math.round(intel.prediction.defenseRating)}</b></div>
              </div>
              <div style="height:140px;"><canvas id="teamPowerHistoryChart"></canvas></div>
            </div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">📈 Momentum dinámico (xG vs resultado real vs esperado)</div>
          <div style="height:220px;"><canvas id="teamMomentumTripleChart"></canvas></div>
        </div>
        <div class="fl-row" style="gap:10px;align-items:stretch;">
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">🧠 Estado psicológico</div>
            <div class="fl-kpi" style="margin-bottom:8px;">
              <div><span class="fl-mini">Agresividad</span><b>${Math.round(intel.psych.aggressiveness)}</b></div>
              <div><span class="fl-mini">Resiliencia</span><b>${Math.round(intel.psych.resilience)}</b></div>
              <div><span class="fl-mini">Volatilidad</span><b>${Math.round(intel.psych.volatility)}</b></div>
              <div><span class="fl-mini">Fatiga</span><b>${Math.round(intel.psych.fatigue)}</b></div>
            </div>
            <div style="height:230px;"><canvas id="teamPsychRadar"></canvas></div>
          </div>
          <div class="fl-card" style="flex:1;min-width:320px;">
            <div style="font-weight:800;margin-bottom:8px;">🧬 Tactical DNA Map</div>
            <div style="height:280px;"><canvas id="teamTacticalRadar"></canvas></div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">🔮 Motor de predicción integrado</div>
          <div class="fl-kpi">
            <div><span class="fl-mini">Rating ofensivo</span><b>${Math.round(intel.prediction.offenseRating)}</b></div>
            <div><span class="fl-mini">Rating defensivo</span><b>${Math.round(intel.prediction.defenseRating)}</b></div>
            <div><span class="fl-mini">Índice psicológico</span><b>${Math.round(intel.prediction.psychIndex)}</b></div>
            <div><span class="fl-mini">Índice consistencia</span><b>${Math.round(intel.prediction.consistencyIndex)}</b></div>
            <div><span class="fl-mini">Home Boost (engine)</span><b>${(Number(engine?.haTraits?.homeBoost)||0).toFixed(2)}</b></div>
            <div><span class="fl-mini">Travel Tilt</span><b>${(Number(engine?.haTraits?.travelTilt)||0).toFixed(2)}</b></div>
          </div>
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
      renderSimpleLineChart(
        document.getElementById("teamPowerHistoryChart"),
        intel.metrics.labels,
        [{ label: "Team Power Index", data: intel.metrics.powerSeries, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.2)", tension: 0.25 }]
      );
      renderSimpleLineChart(
        document.getElementById("teamMomentumTripleChart"),
        intel.momentum.labels,
        [
          { label: "xG diferencial", data: intel.momentum.xgDifferential, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.15)", tension: 0.2 },
          { label: "Resultado real", data: intel.momentum.realPerformance, borderColor: "#2ea043", backgroundColor: "rgba(46,160,67,.12)", tension: 0.2 },
          { label: "Rendimiento esperado", data: intel.momentum.expectedPerformance, borderColor: "#d29922", backgroundColor: "rgba(210,153,34,.14)", tension: 0.2 }
        ]
      );
      renderRadarChart(
        document.getElementById("teamPsychRadar"),
        ["Agresividad", "Resiliencia", "Volatilidad", "Fatiga mental"],
        [intel.psych.aggressiveness, intel.psych.resilience, intel.psych.volatility, intel.psych.fatigue],
        "#ff7b72"
      );
      renderRadarChart(
        document.getElementById("teamTacticalRadar"),
        ["Ataque directo", "Posesión", "Transiciones", "Presión", "Balón parado"],
        [intel.tactical.directAttack, intel.tactical.possession, intel.tactical.transitions, intel.tactical.press, intel.tactical.setPieces],
        "#58a6ff"
      );
      content.querySelectorAll("[data-open-stats-modal]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-open-stats-modal"));
        openStatsModal({ db, match, onSave: ()=>render("equipo", { teamId: team.id }) });
      });
      content.querySelectorAll("[data-open-engine-modal]").forEach(btn=>btn.onclick = ()=>{
        const match = db.tracker.find(m=>m.id===btn.getAttribute("data-open-engine-modal"));
        openTeamEngineModal({ db, match, team, onSave: ()=>render("equipo", { teamId: team.id }) });
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
      match.narrativeModule ||= { rawText: "", normalized: null, diagnostic: null };
      const home = db.teams.find(t=>t.id===match.homeId);
      const away = db.teams.find(t=>t.id===match.awayId);
      const league = db.leagues.find(l=>l.id===match.leagueId);
      const statsHtml = match.stats.length
        ? statsBarsHtml(match.stats)
        : `<div class="fl-muted">Sin estadísticas. Pega JSON para cargar.</div>`;
      const labels = match.narrativeModule?.diagnostic?.labels || null;
      const diagHtml = labels ? `
        <div class="fl-mini">Minuto quiebre: <b>${match.narrativeModule.diagnostic.breakMinute ?? "N/A"}</b></div>
        <div class="fl-grid" style="margin-top:8px;grid-template-columns:1fr;">
          ${Object.entries(labels).map(([k,v])=>`<div><div class="fl-mini">${k.replaceAll("_"," ")}: ${(Number(v)*100).toFixed(0)}%</div><div style="height:8px;background:#242b36;border-radius:999px;"><div style="width:${clamp(Number(v)||0,0,1)*100}%;height:8px;background:#1f6feb;border-radius:999px;"></div></div></div>`).join("")}
        </div>
        <ul style="margin:10px 0 0 16px;">${(match.narrativeModule.diagnostic.summary||[]).map(s=>`<li class="fl-mini">${s}</li>`).join("")}</ul>
      ` : `<div class="fl-muted">Sin diagnóstico todavía.</div>`;

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
          <div style="font-weight:800;margin-bottom:6px;">📋 Pegar relato</div>
          <textarea id="matchNarrative" class="fl-text" placeholder="Pega el relato línea por línea con minutos.">${match.narrativeModule.rawText || ""}</textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="convertNarrative">Convertir</button>
            <span id="narrativeStatus" class="fl-muted"></span>
          </div>
          <div id="normalizedEvents" class="fl-mini" style="margin-top:8px;"></div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">🕵️ Diagnóstico</div>
          ${diagHtml}
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">➕ Guardar al perfil</div>
          <div class="fl-row">
            <button class="fl-btn" id="applyDiag">Aplicar al ${home?.name || "Local"} y ${away?.name || "Visitante"}</button>
            <button class="fl-btn" id="saveStats">Guardar estadísticas</button>
            <button class="fl-btn" id="goBackMatch">Volver</button>
            <span id="statsStatus" class="fl-muted"></span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:6px;">Importar estadísticas JSON</div>
          <textarea id="statsImport" class="fl-text" placeholder='{"stats":[{"key":"Posesión","home":"67%","away":"33%"}]}'></textarea>
        </div>
      `;

      const renderEventsPreview = ()=>{
        const list = match.narrativeModule?.normalized?.events || [];
        document.getElementById("normalizedEvents").innerHTML = list.length
          ? `<b>Eventos extraídos (${list.length}):</b><br/>` + list.slice(0,30).map(e=>`${e.min ?? "?"}' • ${e.type} • ${e.team || "?"}${e.player ? ` • ${e.player}`:""}`).join("<br/>")
          : "Sin eventos convertidos aún.";
      };
      renderEventsPreview();

      document.getElementById("convertNarrative").onclick = ()=>{
        const raw = document.getElementById("matchNarrative").value;
        const parsed = extractNarratedEvents(raw, { home: home?.name || "Local", away: away?.name || "Visitante" });
        const diagnostic = buildNarrativeDiagnostic({ match, teams: { home: home?.name || "Local", away: away?.name || "Visitante" }, parsed });
        match.narrativeModule = {
          rawText: raw,
          normalized: {
            matchId: match.id,
            teams: { home: home?.name || "Local", away: away?.name || "Visitante" },
            events: parsed.events
          },
          diagnostic: { matchId: match.id, diagnostic }
        };
        saveDb(db);
        document.getElementById("narrativeStatus").textContent = `✅ ${parsed.events.length} eventos convertidos`;
        render("match", payload);
      };

      document.getElementById("applyDiag").onclick = ()=>{
        if(!match.narrativeModule?.diagnostic?.diagnostic){
          document.getElementById("statsStatus").textContent = "❌ Convierte un relato primero.";
          return;
        }
        applyDiagnosticToProfiles(db, { match, diagnostic: match.narrativeModule.diagnostic.diagnostic });
        saveDb(db);
        document.getElementById("statsStatus").textContent = "✅ Perfil acumulado actualizado (EMA).";
      };

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

    if(view==="momentum"){
      const teamOptions = db.teams.map(t=>`<option value="${t.name}">${t.name}</option>`).join("");
      content.innerHTML = `
        <div class="fl-card">
          <div style="font-weight:900;font-size:20px;">📊 Momentum Lab</div>
          <div class="fl-mini">Motor de velas, patrones y firma histórica por relato.</div>
        </div>
        <div class="fl-card fl-grid two">
          <div>
            <div class="fl-mini">Equipo A</div>
            <select id="momTeamA" class="fl-select" style="width:100%;margin-top:4px;">${teamOptions}</select>
          </div>
          <div>
            <div class="fl-mini">Equipo B</div>
            <select id="momTeamB" class="fl-select" style="width:100%;margin-top:4px;">${teamOptions}</select>
          </div>
        </div>
        <div class="fl-card">
          <textarea id="momNarrative" class="fl-text" placeholder="Pega el relato crudo aquí"></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="momConvert">Convertir</button>
            <button class="fl-btn" id="momGenerateDiag" disabled>Generar diagnóstico</button>
            <button class="fl-btn" id="momSaveProfile" disabled>Guardar al perfil</button>
            <span id="momStatus" class="fl-mini"></span>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Velas IDD (equipo A)</div>
          <svg id="momCandleSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">IDD acumulado</div>
          <svg id="momLineSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Patrones detectados</div>
          <div id="momPatterns" class="fl-mini">Sin análisis todavía.</div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Resumen de firma</div>
          <pre id="momSignature" class="fl-mini" style="white-space:pre-wrap"></pre>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Diagnóstico automático</div>
          <pre id="momDiagJson" class="fl-mini" style="white-space:pre-wrap;margin-bottom:8px;">Genera un diagnóstico para ver métricas y etiquetas.</pre>
          <div id="momDiagSections" class="fl-mini">
            <div><b>Resumen:</b> -</div>
            <div><b>Quiebre:</b> -</div>
            <div><b>Volatilidad:</b> -</div>
            <div><b>Cierre:</b> -</div>
            <div><b>Patrón:</b> -</div>
          </div>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">⚽ Early Phase Analyzer (EPA)</div>
          <div class="fl-grid two" style="margin-bottom:8px;">
            <div class="fl-mini">Modo acumulativo: cada nuevo texto se mezcla con lo ya cargado para ver la evolución completa del partido.</div>
            <div class="fl-mini" style="display:flex;align-items:flex-end;">Función secundaria: no reemplaza el análisis de momentum actual.</div>
          </div>
          <textarea id="epaNarrative" class="fl-text" placeholder="Pega más relato (minuto a minuto). Se acumula automáticamente."></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="epaAnalyze">Actualizar EPA</button>
            <button class="fl-btn" id="epaReset">Reiniciar EPA</button>
            <button class="fl-btn" id="epaSaveProfile" disabled>Guardar firma temprana al equipo</button>
            <span id="epaStatus" class="fl-mini"></span>
          </div>
          <div class="fl-card" style="margin-top:10px;">
            <div style="font-weight:700;margin-bottom:8px;">Movimiento psicológico EMA sobre velas de intensidad</div>
            <svg id="epaPsychSvg" viewBox="0 0 700 220" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
          </div>
          <div id="epaCards" class="fl-grid two" style="margin-top:10px;gap:10px;"></div>
          <pre id="epaJson" class="fl-mini" style="white-space:pre-wrap;margin-top:10px;">Sin análisis EPA.</pre>
          <ul id="epaText" class="fl-mini" style="margin:8px 0 0 18px;"></ul>
        </div>
        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">📈 Live Projection Engine (LPE)</div>
          <div class="fl-mini" style="margin-bottom:8px;">Acumulativo por <code>matchId</code>: acepta JSON LPE directo o <code>kind: "match_stats"</code> (Flashscore/Sofascore) y lo normaliza.</div>
          <textarea id="lpeInput" class="fl-text" placeholder='Pega JSON de ventana {"matchId":"...","teams":...,"stats":...,"score":...} o {"kind":"match_stats","sections":[...]}'></textarea>
          <div class="fl-row" style="margin-top:8px;">
            <button class="fl-btn" id="lpeUpdate">Actualizar LPE</button>
            <button class="fl-btn" id="lpeReset">Reiniciar partido</button>
            <span id="lpeStatus" class="fl-mini"></span>
          </div>
          <div id="lpeSummary" class="fl-mini" style="margin-top:8px;">Sin estado LPE.</div>
          <div class="fl-card" style="margin-top:10px;">
            <div style="font-weight:700;margin-bottom:8px;">Tendencia acumulativa + proyección (IDD/EPI)</div>
            <svg id="lpeProjectionSvg" viewBox="0 0 700 230" style="width:100%;background:#0d1117;border:1px solid #2d333b;border-radius:10px"></svg>
          </div>
          <div id="lpeAlerts" class="fl-mini" style="margin-top:8px;"></div>
          <pre id="lpeJson" class="fl-mini" style="white-space:pre-wrap;margin-top:10px;">{}</pre>
        </div>
      `;

      let lastPayload = null;
      let lastEPA = null;
      let lastLPE = null;
      const drawCandleChart = (candles=[])=>{
        const svg = document.getElementById("momCandleSvg");
        if(!svg) return;
        const width = 700;
        const height = 220;
        const zeroY = height/2;
        const scaleY = 85;
        const barW = 40;
        const gap = 20;
        const bodyW = 18;
        const axis = `<line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>`;
        const bars = candles.map((c, i)=>{
          const x = 25 + i*(barW+gap);
          const yOpen = zeroY - c.open*scaleY;
          const yClose = zeroY - c.close*scaleY;
          const yHigh = zeroY - c.high*scaleY;
          const yLow = zeroY - c.low*scaleY;
          const color = c.close >= c.open ? "#2ea043" : "#f85149";
          const bodyY = Math.min(yOpen, yClose);
          const bodyH = Math.max(2, Math.abs(yOpen-yClose));
          return `<g>
            <line x1="${x+barW/2}" y1="${yHigh}" x2="${x+barW/2}" y2="${yLow}" stroke="${color}" stroke-width="2"/>
            <rect x="${x + (barW-bodyW)/2}" y="${bodyY}" width="${bodyW}" height="${bodyH}" fill="${color}"/>
            <text x="${x+barW/2}" y="208" fill="#9ca3af" font-size="10" text-anchor="middle">${c.block===9?"90+":`${c.block*10}`}</text>
          </g>`;
        }).join("");
        svg.innerHTML = axis + bars;
      };

      const drawIddLine = (blocks=[], team)=>{
        const svg = document.getElementById("momLineSvg");
        if(!svg) return;
        const width = 700;
        const height = 220;
        const zeroY = height/2;
        const accum = cumulativeSum(blocks.map(b=>Number(b.idd?.[team]) || 0));
        const pts = accum.map((value, idx)=>{
          const x = 20 + idx * ((width - 40) / 9);
          const y = zeroY - value * 40;
          return `${x},${y}`;
        }).join(" ");
        svg.innerHTML = `
          <line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>
          <polyline points="${pts}" fill="none" stroke="#58a6ff" stroke-width="3"/>
        `;
      };

      const renderMomentumDiagnostic = (diagnostic)=>{
        if(!diagnostic) return;
        const diagJson = document.getElementById("momDiagJson");
        const diagSections = document.getElementById("momDiagSections");
        if(diagJson) diagJson.textContent = JSON.stringify({
          metrics: diagnostic.metrics,
          tags: diagnostic.tags,
          diagnosticText: diagnostic.diagnosticText
        }, null, 2);
        const summary = diagnostic.diagnosticText[0] || "-";
        const breakLine = diagnostic.diagnosticText.find(line=>line.startsWith("Quiebre principal:")) || "-";
        const volLine = diagnostic.diagnosticText.find(line=>line.startsWith("Volatilidad:")) || "-";
        const closeLine = diagnostic.diagnosticText.find(line=>line.startsWith("Final:")) || "-";
        const patternLine = diagnostic.diagnosticText.find(line=>line.startsWith("Patrón:")) || "Patrón: sin clasificación dominante.";
        if(diagSections){
          diagSections.innerHTML = `
            <div><b>Resumen:</b> ${summary}</div>
            <div><b>Quiebre:</b> ${breakLine}</div>
            <div><b>Volatilidad:</b> ${volLine}</div>
            <div><b>Cierre:</b> ${closeLine}</div>
            <div><b>Patrón:</b> ${patternLine}</div>
          `;
        }
      };

      const renderEPA = (epa)=>{
        const cards = document.getElementById("epaCards");
        const textList = document.getElementById("epaText");
        const jsonOut = document.getElementById("epaJson");
        const psychSvg = document.getElementById("epaPsychSvg");
        if(!epa || !cards || !textList || !jsonOut) return;
        const [teamA, teamB] = epa.teams;
        const iddA = Number(epa.features?.idd?.[teamA] || 0);
        const threatA = Number(epa.features?.threat?.[teamA] || 0);
        const threatB = Number(epa.features?.threat?.[teamB] || 0);
        const shockA = Number(epa.features?.shockRisk?.[teamA] || 0);
        const shockB = Number(epa.features?.shockRisk?.[teamB] || 0);
        const psychA = epa.psych?.[teamA] || {};
        const psychB = epa.psych?.[teamB] || {};
        cards.innerHTML = `
          <div><b>IDD early</b><div class="fl-mini">${teamA}: ${iddA.toFixed(2)} · ${teamB}: ${(-iddA).toFixed(2)}</div></div>
          <div><b>Intensidad</b><div class="fl-mini">${(Number(epa.features?.intensity||0)*100).toFixed(0)}%</div></div>
          <div><b>Threat</b><div class="fl-mini">${teamA}: ${(threatA*100).toFixed(0)}% · ${teamB}: ${(threatB*100).toFixed(0)}%</div></div>
          <div><b>Shock risk</b><div class="fl-mini">${teamA}: ${(shockA*100).toFixed(0)}% · ${teamB}: ${(shockB*100).toFixed(0)}%</div></div>
          <div><b>Psych (${teamA})</b><div class="fl-mini">Cnf ${(Number(psychA.confidence||0)*100).toFixed(0)} · Comp ${(Number(psychA.composure||0)*100).toFixed(0)} · Fr ${(Number(psychA.frustration||0)*100).toFixed(0)}</div></div>
          <div><b>Psych (${teamB})</b><div class="fl-mini">Cnf ${(Number(psychB.confidence||0)*100).toFixed(0)} · Comp ${(Number(psychB.composure||0)*100).toFixed(0)} · Fr ${(Number(psychB.frustration||0)*100).toFixed(0)}</div></div>
        `;
        const psychText = [
          ...(epa.text || []),
          `${teamA}: ${(epa.psychText?.[teamA] || []).join(" · ")}`,
          `${teamB}: ${(epa.psychText?.[teamB] || []).join(" · ")}`
        ];
        textList.innerHTML = psychText.map(line=>`<li>${line}</li>`).join("");
        if(psychSvg){
          const buckets = epa.psychChart?.buckets || [];
          const width = 700;
          const height = 220;
          const zeroY = 170;
          const maxMove = Math.max(1, ...buckets.map(b=>Math.max(Number(b.ema?.[teamA]||0), Number(b.ema?.[teamB]||0))));
          const xAt = (idx)=>20 + idx*((width-40)/Math.max(1, buckets.length-1));
          const yMove = (v)=>170 - (Number(v)||0)*(90/maxMove);
          const intensityBars = buckets.map((b, idx)=>{
            const x = xAt(idx) - 18;
            const h = (Number(b.intensity)||0)*80;
            const y = zeroY - h;
            return `<g><rect x="${x}" y="${y}" width="36" height="${h}" fill="rgba(88,166,255,.25)" stroke="rgba(88,166,255,.45)"/><text x="${xAt(idx)}" y="205" fill="#9ca3af" font-size="10" text-anchor="middle">${b.label}</text></g>`;
          }).join("");
          const poly = (team, color)=>buckets.map((b, idx)=>`${xAt(idx)},${yMove(b.ema?.[team]||0)}`).join(" ");
          psychSvg.innerHTML = `
            <line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="#39414d" stroke-width="1"/>
            ${intensityBars}
            <polyline points="${poly(teamA, "#2ea043")}" fill="none" stroke="#2ea043" stroke-width="3"/>
            <polyline points="${poly(teamB, "#f85149")}" fill="none" stroke="#f85149" stroke-width="3"/>
            <text x="24" y="16" fill="#2ea043" font-size="11">EMA ${teamA}</text>
            <text x="130" y="16" fill="#f85149" font-size="11">EMA ${teamB}</text>
          `;
        }
        jsonOut.textContent = JSON.stringify(epa, null, 2);
      };

      const buildEpaAccumKey = (teamA, teamB)=>{
        const parts = [String(teamA || "").trim(), String(teamB || "").trim()]
          .filter(Boolean)
          .map(normalizeTeamToken)
          .sort();
        return `match_epa_accum_${parts.join("__")}`;
      };

      const mergeEarlyEvents = (baseEvents=[], incomingEvents=[])=>{
        const map = new Map();
        [...(Array.isArray(baseEvents) ? baseEvents : []), ...(Array.isArray(incomingEvents) ? incomingEvents : [])].forEach(evt=>{
          if(!evt) return;
          const k = `${Number(evt.minute) || 0}|${String(evt.team || "").trim().toLowerCase()}|${String(evt.type || "").trim().toLowerCase()}|${String(evt.text || "").trim().toLowerCase()}`;
          if(!map.has(k)) map.set(k, evt);
        });
        return [...map.values()].sort((a,b)=> (Number(a.minute)||0) - (Number(b.minute)||0));
      };

      const resolveAccumWindowKey = (events=[])=>{
        const maxMinute = Math.max(10, ...events.map(evt=>Number(evt?.minute) || 0));
        return `0-${Math.ceil(maxMinute)}`;
      };

      const resolveEpaPsychForLpe = (epa, lpeTeams={})=>{
        if(!epa?.teams?.length || !epa?.psych) return null;
        const [epaHome, epaAway] = epa.teams;
        const psych = epa.psych || {};
        const norm = (v)=>normalizeTeamToken(v || "");
        const directHome = psych[lpeTeams?.home] || psych[Object.keys(psych).find(k=>norm(k)===norm(lpeTeams?.home))];
        const directAway = psych[lpeTeams?.away] || psych[Object.keys(psych).find(k=>norm(k)===norm(lpeTeams?.away))];
        return {
          home: directHome || psych[epaHome] || null,
          away: directAway || psych[epaAway] || null
        };
      };

      document.getElementById("epaAnalyze").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const status = document.getElementById("epaStatus");
        const narrativeEl = document.getElementById("epaNarrative");
        const raw = (narrativeEl?.value || document.getElementById("momNarrative").value || "").trim();
        if(!teamA || !teamB || teamA===teamB){
          status.textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        if(!raw){
          status.textContent = "⚠️ Pega texto para actualizar EPA.";
          return;
        }
        const seedProfiles = {
          [teamA]: JSON.parse(localStorage.getItem(`team_profile_${teamA}`) || "null") || {},
          [teamB]: JSON.parse(localStorage.getItem(`team_profile_${teamB}`) || "null") || {}
        };
        const accumKey = buildEpaAccumKey(teamA, teamB);
        const previousAccum = safeParseJson(localStorage.getItem(accumKey) || "null") || {};
        const incoming = parseEarlyNarrative(raw, { teamA, teamB, windowKey: "0-200" });
        const mergedEvents = mergeEarlyEvents(previousAccum.events, incoming.events || []);
        const windowKey = resolveAccumWindowKey(mergedEvents);
        const epa = computeEarlyPhaseAnalyzer("", { teamA, teamB, windowKey, seedProfiles, eventsOverride: mergedEvents });
        const snapshot = {
          teamA,
          teamB,
          windowKey,
          events: mergedEvents,
          updatedAt: new Date().toISOString()
        };
        localStorage.setItem(accumKey, JSON.stringify(snapshot));
        renderEPA(epa);
        lastEPA = epa;
        if(narrativeEl) narrativeEl.value = "";
        document.getElementById("epaSaveProfile").disabled = false;
        status.textContent = `✅ EPA acumulado ${epa.window} (${mergedEvents.length} eventos).`;
      };

      document.getElementById("epaReset").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const status = document.getElementById("epaStatus");
        if(!teamA || !teamB || teamA===teamB){
          status.textContent = "⚠️ Selecciona dos equipos para reiniciar EPA.";
          return;
        }
        localStorage.removeItem(buildEpaAccumKey(teamA, teamB));
        lastEPA = null;
        const cards = document.getElementById("epaCards");
        const textList = document.getElementById("epaText");
        const jsonOut = document.getElementById("epaJson");
        const psychSvg = document.getElementById("epaPsychSvg");
        if(cards) cards.innerHTML = "";
        if(textList) textList.innerHTML = "";
        if(jsonOut) jsonOut.textContent = "Sin análisis EPA.";
        if(psychSvg) psychSvg.innerHTML = "";
        document.getElementById("epaSaveProfile").disabled = true;
        status.textContent = "✅ EPA reiniciado para este partido.";
      };

      document.getElementById("epaSaveProfile").onclick = ()=>{
        if(!lastEPA?.signatureUpdate) return;
        const [teamA, teamB] = lastEPA.teams;
        [teamA, teamB].forEach(teamName=>{
          const current = JSON.parse(localStorage.getItem(`team_profile_${teamName}`) || "null");
          const updated = updateTeamEarlyProfile(current, teamName, lastEPA.signatureUpdate[teamName] || {});
          localStorage.setItem(`team_profile_${teamName}`, JSON.stringify(updated));
        });
        document.getElementById("epaStatus").textContent = "✅ Firma temprana guardada para ambos equipos.";
      };

      const drawLpeProjectionChart = (history=[])=>{
        const svg = document.getElementById("lpeProjectionSvg");
        if(!svg) return;
        const width = 700;
        const height = 230;
        const pad = { top: 18, right: 16, bottom: 26, left: 38 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const yFromNorm = (v)=> pad.top + (1 - clamp((Number(v) || 0), 0, 1)) * plotH;
        const yFromSigned = (v)=> pad.top + (1 - (clamp((Number(v) || 0), -1, 1) + 1)/2) * plotH;

        const real = Array.isArray(history) ? history : [];
        const realPoints = real.slice(-12);
        const projectionCount = 3;
        const projected = [];

        const linearProjection = (arr, key)=>{
          const series = arr.map((item, idx)=>({ x: idx + 1, y: Number(item?.[key]) || 0 }));
          if(!series.length) return Array.from({ length: projectionCount }, ()=>0);
          if(series.length===1) return Array.from({ length: projectionCount }, ()=>series[0].y);
          const meanX = series.reduce((acc, p)=>acc+p.x, 0) / series.length;
          const meanY = series.reduce((acc, p)=>acc+p.y, 0) / series.length;
          const num = series.reduce((acc, p)=>acc + (p.x - meanX)*(p.y - meanY), 0);
          const den = series.reduce((acc, p)=>acc + (p.x - meanX)*(p.x - meanX), 0) || 1;
          const slope = num/den;
          const intercept = meanY - slope*meanX;
          return Array.from({ length: projectionCount }, (_v, i)=> intercept + slope*(series.length + i + 1));
        };

        const iddProjected = linearProjection(realPoints, "iddAway").map(v=>clamp(v, -1, 1));
        const epiProjected = linearProjection(realPoints, "epi").map(v=>clamp(v, 0, 1));
        for(let i=0;i<projectionCount;i+=1){
          projected.push({
            idx: realPoints.length + i,
            iddAway: iddProjected[i],
            epi: epiProjected[i]
          });
        }

        const all = [...realPoints, ...projected];
        if(!all.length){
          svg.innerHTML = `<text x="24" y="42" fill="#8b949e" font-size="12">Carga al menos una ventana LPE para visualizar tendencia y proyección.</text>`;
          return;
        }

        const maxIndex = Math.max(all.length - 1, 1);
        const xPos = (idx)=> pad.left + (idx / maxIndex) * plotW;
        const linePath = (arr, key, yMapper)=> arr.map((p, idx)=>`${idx===0?"M":"L"}${xPos(idx)} ${yMapper(p[key])}`).join(" ");
        const realPathIdd = linePath(realPoints, "iddAway", yFromSigned);
        const projPathIdd = linePath([...realPoints.slice(-1), ...projected], "iddAway", yFromSigned);
        const realPathEpi = linePath(realPoints, "epi", yFromNorm);
        const projPathEpi = linePath([...realPoints.slice(-1), ...projected], "epi", yFromNorm);
        const splitX = xPos(Math.max(realPoints.length - 1, 0));

        svg.innerHTML = `
          <line x1="${pad.left}" y1="${yFromSigned(0)}" x2="${width-pad.right}" y2="${yFromSigned(0)}" stroke="#39414d" stroke-width="1"/>
          <line x1="${splitX}" y1="${pad.top}" x2="${splitX}" y2="${height-pad.bottom}" stroke="#30363d" stroke-width="1" stroke-dasharray="4 4"/>
          <text x="${splitX + 6}" y="${pad.top + 14}" fill="#8b949e" font-size="11">proyección</text>
          <path d="${realPathIdd}" fill="none" stroke="#58a6ff" stroke-width="2.5"/>
          <path d="${projPathIdd}" fill="none" stroke="#58a6ff" stroke-width="2" stroke-dasharray="6 5"/>
          <path d="${realPathEpi}" fill="none" stroke="#2ea043" stroke-width="2"/>
          <path d="${projPathEpi}" fill="none" stroke="#2ea043" stroke-width="1.8" stroke-dasharray="5 5"/>
          <text x="${pad.left}" y="${height-8}" fill="#58a6ff" font-size="11">IDD away (azul)</text>
          <text x="${pad.left + 140}" y="${height-8}" fill="#2ea043" font-size="11">EPI (verde)</text>
        `;
      };

      const renderLPE = (state)=>{
        const summary = document.getElementById("lpeSummary");
        const alertsEl = document.getElementById("lpeAlerts");
        const jsonEl = document.getElementById("lpeJson");
        if(!summary || !alertsEl || !jsonEl) return;
        if(!state){
          summary.textContent = "Sin estado LPE.";
          alertsEl.innerHTML = "";
          jsonEl.textContent = "{}";
          drawLpeProjectionChart([]);
          return;
        }
        const teams = state.teams || { home: "home", away: "away" };
        const p = state.projections || {};
        summary.innerHTML = `
          <div><b>${teams.home}</b> vs <b>${teams.away}</b> · ventana ${state.lastWindow || "live"} · iteración ${state.k}</div>
          <div>IDD next: <b>${Number(p.iddNext || 0).toFixed(2)}</b> · Dominio probable: <b>${p.dominance || "-"}</b></div>
          <div>Shock risk: <b>${p.shockRisk || "-"}</b> · EPI: <b>${(Number(p.eventTension || 0)*100).toFixed(0)}%</b></div>
        `;
        const recentAlerts = (state.alerts || []).slice(-6).reverse();
        alertsEl.innerHTML = recentAlerts.length
          ? recentAlerts.map(a=>`<span style="display:inline-block;padding:4px 8px;border:1px solid #2d333b;border-radius:999px;margin:0 6px 6px 0;">${a.type}${a.team?` · ${a.team}`:""}${a.level?` · ${Math.round(a.level*100)}%`:""}</span>`).join("")
          : "Sin alertas todavía.";
        drawLpeProjectionChart(state.history || []);
        jsonEl.textContent = JSON.stringify(state, null, 2);
      };

      document.getElementById("lpeUpdate").onclick = ()=>{
        const status = document.getElementById("lpeStatus");
        const raw = document.getElementById("lpeInput").value || "";
        const parsedRaw = safeParseJson(raw);
        const parsed = parsedRaw ? normalizeIncomingLpePayload(parsedRaw) : null;
        if(!parsed){
          status.textContent = "❌ JSON inválido.";
          return;
        }
        const matchId = parsed.matchId || `TMP-${Date.now()}`;
        const lpeKey = `match_lpe_${matchId}`;
        const previous = safeParseJson(localStorage.getItem(lpeKey) || "null") || {};
        const epaPsych = resolveEpaPsychForLpe(lastEPA, parsed.teams);
        const nextState = updateLiveProjectionState(previous, parsed, { epaPsych });
        localStorage.setItem(lpeKey, JSON.stringify(nextState));
        lastLPE = nextState;
        renderLPE(nextState);
        status.textContent = `✅ LPE actualizado (${nextState.k} ventanas)`;
      };

      document.getElementById("lpeReset").onclick = ()=>{
        const status = document.getElementById("lpeStatus");
        const raw = document.getElementById("lpeInput").value || "";
        const parsedRaw = safeParseJson(raw);
        const parsed = parsedRaw ? normalizeIncomingLpePayload(parsedRaw) : null;
        const matchId = parsed?.matchId;
        if(!matchId){
          status.textContent = "⚠️ Para reiniciar, pega un JSON con matchId.";
          return;
        }
        localStorage.removeItem(`match_lpe_${matchId}`);
        lastLPE = null;
        renderLPE(null);
        status.textContent = `✅ Estado LPE reiniciado para ${matchId}.`;
      };

      document.getElementById("momConvert").onclick = ()=>{
        const teamA = document.getElementById("momTeamA").value;
        const teamB = document.getElementById("momTeamB").value;
        const raw = document.getElementById("momNarrative").value;
        if(!teamA || !teamB || teamA===teamB){
          document.getElementById("momStatus").textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        const parsed = parseMatchNarrative(raw, [teamA, teamB]);
        const timeline = buildEventTimeline(parsed.events);
        const blocks = computeMomentumBlocks(timeline, [teamA, teamB]);
        const candles = generateCandles(blocks, teamA);
        const patterns = detectPatterns({ candles, blocks, team: teamA, opponent: teamB });
        const signature = computeMomentumSignature(teamA, blocks, timeline);
        const matchMomentumId = uid("mom");
        const bundle = { matchMomentumId, teams: [teamA, teamB], events: timeline, blocks, candles, patterns, signature, momentumDiagnostic: null, createdAt: new Date().toISOString() };
        localStorage.setItem(`match_events_${matchMomentumId}`, JSON.stringify(timeline));
        localStorage.setItem(`match_momentum_${matchMomentumId}`, JSON.stringify(bundle));
        drawCandleChart(candles);
        drawIddLine(blocks, teamA);
        document.getElementById("momPatterns").innerHTML = patterns.length
          ? patterns.map(p=>`• ${p.type} (bloque ${p.block===9?"90+":p.block})`).join("<br/>")
          : "Sin patrones detectados con las reglas actuales.";
        document.getElementById("momSignature").textContent = JSON.stringify(signature.momentumSignature, null, 2);
        document.getElementById("momStatus").textContent = `✅ ${timeline.length} eventos convertidos`;
        document.getElementById("momSaveProfile").disabled = false;
        document.getElementById("momGenerateDiag").disabled = false;
        document.getElementById("momDiagJson").textContent = "Genera un diagnóstico para ver métricas y etiquetas.";
        lastPayload = bundle;
      };

      document.getElementById("momGenerateDiag").onclick = ()=>{
        if(!lastPayload?.candles?.length){
          document.getElementById("momStatus").textContent = "❌ Convierte un relato primero.";
          return;
        }
        const diagnostic = computeMomentumDiagnostic(lastPayload.candles);
        lastPayload.momentumDiagnostic = diagnostic;
        if(lastPayload.matchMomentumId){
          localStorage.setItem(`match_momentum_${lastPayload.matchMomentumId}`, JSON.stringify(lastPayload));
        }
        renderMomentumDiagnostic(diagnostic);
        document.getElementById("momStatus").textContent = "✅ Diagnóstico generado y guardado.";
      };

      document.getElementById("momSaveProfile").onclick = ()=>{
        if(!lastPayload) return;
        const teamA = lastPayload.teams[0];
        const current = JSON.parse(localStorage.getItem(`team_profile_${teamA}`) || "null");
        const updated = updateTeamProfile(current, { team: teamA, momentumSignature: lastPayload.signature.momentumSignature });
        localStorage.setItem(`team_profile_${teamA}`, JSON.stringify(updated));
        document.getElementById("momStatus").textContent = `✅ Perfil ${teamA} actualizado (${updated.samples} muestras)`;
      };
      return;
    }

    if(view==="bitacora"){
      db.bitacora = ensureBitacoraState(db.bitacora);
      const st = db.bitacora;
      const today = new Date().toISOString().slice(0,10);
      const todayEntries = st.entries.filter(e=>(e.date||"").slice(0,10)===today);
      const todayProfit = todayEntries.reduce((s,e)=>s+(Number(e.profit)||0),0);
      const todayRisk = todayEntries.reduce((s,e)=>s+(Number(e.stake)||0),0);
      let lossStreak = 0;
      for(let i=todayEntries.length-1;i>=0;i--){
        if(todayEntries[i].result==="loss") lossStreak += 1;
        else break;
      }
      const dailyGoal = st.bank * st.dailyGoalPct;
      const dailyRiskCap = st.bank * st.dailyRiskPct;
      const stopByLoss = todayProfit <= -st.stopLoss;
      const stopByWin = todayProfit >= st.stopWin;
      const stopByRisk = todayRisk >= dailyRiskCap;
      const stopByCount = todayEntries.length >= st.maxBetsPerDay;
      const stopByStreak = lossStreak >= st.maxConsecutiveLosses;
      const quickRules = [
        { odds: 1.7, p: 0.6 },
        { odds: 2.0, p: 0.55 },
        { odds: 2.5, p: 0.45 }
      ];

      const lastRows = st.entries.slice(-20);
      const bankSeries = [
        Math.max(0, st.bank - lastRows.reduce((s,e)=>s+(Number(e.profit)||0),0)),
        ...lastRows.map(e=>Number(e.bankAfter) || st.bank)
      ];
      const histMin = Math.min(...bankSeries);
      const histMax = Math.max(...bankSeries);
      const histPath = sparklinePath(bankSeries, 640, 180, histMin-0.5, histMax+0.5);

      const avgP = lastRows.length ? lastRows.reduce((s,e)=>s+(Number(e.probability)||0.52),0)/lastRows.length : 0.55;
      const avgOdds = lastRows.length ? lastRows.reduce((s,e)=>s+(Number(e.odds)||2),0)/lastRows.length : 2;
      const avgStake = lastRows.length ? Math.max(st.minUnit, lastRows.reduce((s,e)=>s+(Number(e.stake)||st.minUnit),0)/lastRows.length) : st.minUnit;
      const projection = projectBankroll({ bank: st.bank, p: avgP, odds: avgOdds, stake: avgStake, steps: 12, paths: 1000 });
      const projAll = projection.flatMap(p=>[p.p10, p.p90, p.mean]);
      const pMin = Math.min(...projAll);
      const pMax = Math.max(...projAll);
      const meanPath = sparklinePath(projection.map(p=>p.mean), 640, 180, pMin-0.5, pMax+0.5);
      const lowPath = sparklinePath(projection.map(p=>p.p10), 640, 180, pMin-0.5, pMax+0.5);
      const highPath = sparklinePath(projection.map(p=>p.p90), 640, 180, pMin-0.5, pMax+0.5);

      const rows = st.entries.slice().reverse().slice(0,10).map(e=>`
        <tr>
          <td>${(e.date||"").slice(0,10)}</td>
          <td>S/${Number(e.stake||0).toFixed(2)}</td>
          <td>${Number(e.odds||0).toFixed(2)}</td>
          <td>${((Number(e.probability)||0)*100).toFixed(1)}%</td>
          <td>${e.result||"-"}</td>
          <td style="color:${Number(e.profit)>=0?"#3fb950":"#ff7b72"}">${Number(e.profit||0)>=0?"+":""}${Number(e.profit||0).toFixed(2)}</td>
          <td>S/${Number(e.bankAfter||0).toFixed(2)}</td>
        </tr>
      `).join("");

      content.innerHTML = `
        <div class="fl-card fl-grid two">
          <div>
            <div style="font-weight:800;margin-bottom:8px;">Bankroll actual</div>
            <div class="fl-row">
              <input id="bkBank" class="fl-input" type="number" min="1" step="0.5" value="${st.bank.toFixed(2)}" style="width:130px" />
              <input id="bkGoal" class="fl-input" type="number" min="1" max="20" step="1" value="${(st.dailyGoalPct*100).toFixed(0)}" title="Objetivo diario %" style="width:140px" />
              <input id="bkRisk" class="fl-input" type="number" min="5" max="40" step="1" value="${(st.dailyRiskPct*100).toFixed(0)}" title="Riesgo diario %" style="width:140px" />
              <input id="bkKelly" class="fl-input" type="number" min="5" max="100" step="5" value="${(st.kellyFraction*100).toFixed(0)}" title="Kelly fraccionado %" style="width:150px" />
              <button class="fl-btn" id="saveBankCfg">Guardar config</button>
            </div>
            <div class="fl-mini" style="margin-top:8px;">Objetivo del día: <b>S/${dailyGoal.toFixed(2)}</b> · Riesgo máx día: <b>S/${dailyRiskCap.toFixed(2)}</b> · Stop-loss S/${st.stopLoss.toFixed(2)} · Stop-win S/${st.stopWin.toFixed(2)}</div>
            <div class="fl-row" style="margin-top:8px;">
              <span class="fl-chip ${stopByLoss||stopByRisk||stopByStreak?"bad":"ok"}">Hoy ${todayEntries.length}/${st.maxBetsPerDay} apuestas</span>
              <span class="fl-chip ${todayProfit>=0?"ok":"bad"}">P&L día ${todayProfit>=0?"+":""}S/${todayProfit.toFixed(2)}</span>
              <span class="fl-chip ${stopByWin?"ok":(stopByLoss||stopByRisk||stopByStreak?"bad":"warn")}">${stopByWin?"Stop-win activo":(stopByLoss||stopByRisk||stopByStreak?"Parar por riesgo":"Puedes seguir")}</span>
            </div>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:8px;">Sugerir apuesta (EV + Kelly)</div>
            <div class="fl-row">
              <input id="bkOdds" class="fl-input" type="number" step="0.01" min="1.01" placeholder="Cuota" style="width:120px" />
              <input id="bkProb" class="fl-input" type="number" step="0.01" min="0.01" max="0.99" placeholder="Prob (0-1)" style="width:140px" />
              <button class="fl-btn" id="bkSuggest">Sugerir apuesta</button>
            </div>
            <div id="bkSuggestOut" class="fl-mini" style="margin-top:8px;">Ingresa cuota y probabilidad para calcular EV y stake redondo.</div>
            <div class="fl-mini" style="margin-top:8px;">Regla rápida: 1.70→p≥0.60 · 2.00→p≥0.55 · 2.50→p≥0.45 · máximo 2-3 apuestas/día.</div>
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Plan del día (2-3 tickets)</div>
          <div class="fl-mini">1) Busca mercado entre 1.80 y 2.20 con EV positivo. 2) Segunda apuesta solo si sigues dentro del riesgo diario. 3) Si pierdes ${st.maxConsecutiveLosses} seguidas, se termina el día.</div>
        </div>

        <div class="fl-card fl-grid two">
          <div>
            <div style="font-weight:800;margin-bottom:8px;">Registrar apuesta</div>
            <div class="fl-row">
              <input id="logStake" class="fl-input" type="number" step="0.5" min="${st.minUnit}" value="${st.minUnit}" placeholder="Stake" style="width:120px" />
              <input id="logOdds" class="fl-input" type="number" step="0.01" min="1.01" placeholder="Cuota" style="width:120px" />
              <input id="logProb" class="fl-input" type="number" step="0.01" min="0.01" max="0.99" placeholder="Prob" style="width:120px" />
              <select id="logResult" class="fl-select" style="width:120px"><option value="win">win</option><option value="loss">loss</option><option value="push">push</option></select>
              <button class="fl-btn" id="saveLog">Guardar</button>
            </div>
            <div id="logOut" class="fl-mini" style="margin-top:8px;"></div>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:8px;">Historial de bank</div>
            <svg viewBox="0 0 640 180" style="width:100%;height:180px;background:#0f141d;border:1px solid #2d333b;border-radius:10px;">
              <path d="${histPath}" fill="none" stroke="#58a6ff" stroke-width="2.5"/>
            </svg>
          </div>
        </div>

        <div class="fl-card">
          <div style="font-weight:800;margin-bottom:8px;">Proyección Monte Carlo (12 apuestas, 1000 caminos)</div>
          <div class="fl-mini">Base: p promedio ${(avgP*100).toFixed(1)}%, cuota ${avgOdds.toFixed(2)}, stake S/${avgStake.toFixed(2)}.</div>
          <svg viewBox="0 0 640 180" style="width:100%;height:180px;background:#0f141d;border:1px solid #2d333b;border-radius:10px;margin-top:8px;">
            <path d="${lowPath}" fill="none" stroke="#ff7b72" stroke-width="1.5" stroke-dasharray="4 3"/>
            <path d="${highPath}" fill="none" stroke="#3fb950" stroke-width="1.5" stroke-dasharray="4 3"/>
            <path d="${meanPath}" fill="none" stroke="#f2cc60" stroke-width="2.5"/>
          </svg>
          <div class="fl-mini" style="margin-top:6px;">Línea amarilla: media esperada · Verde: banda optimista (P90) · Roja: banda pesimista (P10).</div>
        </div>

        <div class="fl-card">
          <table class="fl-table">
            <thead><tr><th>Fecha</th><th>Stake</th><th>Cuota</th><th>p</th><th>Resultado</th><th>Profit</th><th>Bank</th></tr></thead>
            <tbody>${rows || "<tr><td colspan='7'>Sin registros</td></tr>"}</tbody>
          </table>
        </div>
      `;

      document.getElementById("saveBankCfg").onclick = ()=>{
        st.bank = Math.max(1, Number(document.getElementById("bkBank").value) || st.bank);
        st.dailyGoalPct = clamp((Number(document.getElementById("bkGoal").value) || (st.dailyGoalPct*100)) / 100, 0.01, 0.2);
        st.dailyRiskPct = clamp((Number(document.getElementById("bkRisk").value) || (st.dailyRiskPct*100)) / 100, 0.05, 0.4);
        st.kellyFraction = clamp((Number(document.getElementById("bkKelly").value) || (st.kellyFraction*100)) / 100, 0.05, 1);
        saveDb(db);
        render("bitacora");
      };

      document.getElementById("bkSuggest").onclick = ()=>{
        const odds = Number(document.getElementById("bkOdds").value);
        const probability = Number(document.getElementById("bkProb").value);
        const out = document.getElementById("bkSuggestOut");
        if(!(odds>1) || !(probability>0 && probability<1)){
          out.textContent = "❌ Completa cuota (>1) y probabilidad (0-1).";
          return;
        }
        const calc = calcBitacoraSuggestion({
          bank: st.bank,
          odds,
          probability,
          kellyFraction: st.kellyFraction,
          minUnit: st.minUnit,
          maxStakePct: st.maxStakePct
        });
        const qr = quickRules.reduce((acc, rule)=> Math.abs(rule.odds - odds) < Math.abs(acc.odds - odds) ? rule : acc, quickRules[0]);
        const ruleMsg = probability >= qr.p ? "✅ Pasa regla rápida" : `⚠️ Regla rápida pide p≥${qr.p.toFixed(2)}`;
        out.innerHTML = `EV por S/1: <b>${calc.ev.toFixed(3)}</b> · Kelly*: <b>${(calc.kellyStar*100).toFixed(1)}%</b> · Fracc: <b>${(calc.frac*100).toFixed(1)}%</b><br/>`
          + `${calc.noBet ? "❌ NO BET (EV ≤ 0)." : `✅ Stake sugerido: <b>S/${calc.suggestedStake.toFixed(2)}</b> (raw S/${calc.rawStake.toFixed(2)}).`}<br/>${ruleMsg}`;
      };

      document.getElementById("saveLog").onclick = ()=>{
        const stake = Math.max(st.minUnit, Number(document.getElementById("logStake").value) || st.minUnit);
        const odds = Math.max(1.01, Number(document.getElementById("logOdds").value) || 0);
        const probability = clamp(Number(document.getElementById("logProb").value) || 0.5, 0.01, 0.99);
        const result = document.getElementById("logResult").value;
        const out = document.getElementById("logOut");
        if(!(odds>1)){
          out.textContent = "❌ Cuota inválida.";
          return;
        }
        const calc = calcBitacoraSuggestion({
          bank: st.bank,
          odds,
          probability,
          kellyFraction: st.kellyFraction,
          minUnit: st.minUnit,
          maxStakePct: st.maxStakePct
        });
        const profit = result==="win" ? stake * (odds - 1) : (result==="loss" ? -stake : 0);
        st.bank = Math.max(0, st.bank + profit);
        const entry = {
          id: uid("bet"),
          date: new Date().toISOString(),
          stake,
          odds,
          probability,
          result,
          ev: calc.ev,
          profit,
          bankAfter: st.bank
        };
        st.entries.push(entry);
        saveDb(db);
        out.innerHTML = `✅ Apuesta guardada. Profit ${profit>=0?"+":""}S/${profit.toFixed(2)} · bank S/${st.bank.toFixed(2)}`;
        setTimeout(()=>render("bitacora"), 250);
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
              <button class="fl-btn" id="runVsV2">Simular v2 (momentum)</button>
              <button class="fl-btn" id="saveVsV2Profile">Guardar v2 en perfiles</button>
            </div>
            <div id="vsV2Out" style="margin-top:8px;" class="fl-mini">Simulación por bloques IDD pendiente.</div>
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
      let lastSimulationV2 = null;

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

      document.getElementById("runVsV2").onclick = ()=>{
        const homeId = document.getElementById("vsHome").value;
        const awayId = document.getElementById("vsAway").value;
        const out = document.getElementById("vsV2Out");
        if(!homeId || !awayId || homeId===awayId){
          out.textContent = "❌ Selecciona dos equipos distintos.";
          return;
        }
        const homeTeam = db.teams.find(t=>t.id===homeId);
        const awayTeam = db.teams.find(t=>t.id===awayId);
        const homeProfile = getOrCreateDiagProfile(db, homeId, homeTeam?.name || "Local");
        const awayProfile = getOrCreateDiagProfile(db, awayId, awayTeam?.name || "Visitante");
        const simCfg = db.versus.simV2 || defaultDb.versus.simV2;
        const plan = buildMatchPlan(homeProfile, awayProfile, {
          homeAdv: clamp((Number(document.getElementById("vsHA").value) || db.versus.homeAdvantage || 1.1) - 1, 0, 0.3),
          leagueGoalsAvg: simCfg.leagueGoalsAvg,
          baseGoalRatePerBlock: simCfg.baseGoalRatePerBlock,
          globalVolatility: simCfg.globalVolatility
        });
        const sim = simulateMatchV2(plan);
        lastSimulationV2 = { sim, homeId, awayId };
        const blocks = sim.blocks.map(b=>`${b.t0}-${b.t1}: ${b.iddHome.toFixed(2)} (${b.events.map(e=>e.type + (e.shock?"⚡":"")).join(",") || "-"})`).join(" · ");
        out.innerHTML = `
          <div><b>Score v2:</b> ${sim.score.home}-${sim.score.away}</div>
          <div><b>Quiebre:</b> ${sim.diagnostic.breakBlock}</div>
          <div><b>Patrones:</b> ${(sim.diagnostic.patterns.join(", ") || "sin etiqueta")}</div>
          <div>${sim.diagnostic.text.map(t=>`• ${t}`).join("<br/>")}</div>
          <div style="margin-top:6px;"><b>IDD velas local:</b> ${sim.candlesHome.map(c=>`${c.label}:${c.close.toFixed(2)}`).join(" | ")}</div>
          <div style="margin-top:6px;"><b>Bloques:</b> ${blocks}</div>
        `;
      };

      document.getElementById("saveVsV2Profile").onclick = ()=>{
        const out = document.getElementById("vsV2Out");
        if(!lastSimulationV2){
          out.textContent = "❌ Ejecuta Simular v2 primero.";
          return;
        }
        const { sim, homeId, awayId } = lastSimulationV2;
        const homeTeam = db.teams.find(t=>t.id===homeId);
        const awayTeam = db.teams.find(t=>t.id===awayId);
        const currentHome = getOrCreateDiagProfile(db, homeId, homeTeam?.name || "Local");
        const currentAway = getOrCreateDiagProfile(db, awayId, awayTeam?.name || "Visitante");
        db.diagProfiles[homeId] = applyMatchToTeamProfile(currentHome, sim.diagnostic, "for");
        db.diagProfiles[awayId] = applyMatchToTeamProfile(currentAway, sim.diagnostic, "against");
        saveDb(db);
        out.innerHTML += `<div style="margin-top:6px;color:#3fb950;">✅ Rasgos de ambos equipos actualizados (EMA).</div>`;
      };

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
    help: "window.__FOOTBALL_LAB__.open('liga'|'equipo'|'tracker'|'versus'|'bitacora')"
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

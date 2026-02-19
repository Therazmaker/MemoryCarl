// NeuroClaw v0.4 - local rules engine for MemoryCarl
// Runs fully offline. Sync is optional via existing flush.
(function(){
  const OPS = {
    "<":  (a,b)=>a<b,
    "<=": (a,b)=>a<=b,
    ">":  (a,b)=>a>b,
    ">=": (a,b)=>a>=b,
    "==": (a,b)=>a===b,
    "!=": (a,b)=>a!==b,
    "in": (a,b)=>Array.isArray(b) && b.includes(a),
    "notin": (a,b)=>Array.isArray(b) && !b.includes(a),
  };

  function safeNum(x, fallback=0){
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }
  function ymd(d){
    const dt = (d instanceof Date) ? d : new Date(d);
    if(!Number.isFinite(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const da = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }
  function daysAgo(n){
    const d = new Date();
    d.setDate(d.getDate()-n);
    return d;
  }

  async function loadNeuroClawRules(){
    const res = await fetch("./src/neuroclaw/neuroclaw_rules.json", { cache:"no-store" });
    if(!res.ok) throw new Error("NeuroClaw rules HTTP " + res.status);
    const j = await res.json();
    return Array.isArray(j) ? j : (j.rules || []);
  }

  // Compute signals from app data
  function computeSignals(input){
    const signals = {};
    const sleepLog = Array.isArray(input.sleepLog) ? input.sleepLog : [];
    const moodDaily = input.moodDaily && typeof input.moodDaily === "object" ? input.moodDaily : {};
    const shoppingHistory = Array.isArray(input.shoppingHistory) ? input.shoppingHistory : [];
    const house = input.house && typeof input.house === "object" ? input.house : {};
    const reminders = Array.isArray(input.reminders) ? input.reminders : [];

    // ---- Sleep: expect entries that have date + hours (or duration) ----
    const sleepLastNDays = (n)=>{
      const cut = ymd(daysAgo(n));
      const rows = sleepLog.filter(r=>{
        const d = ymd(r.date || r.dt || r.day || r.when);
        return d && d >= cut;
      });
      return rows;
    };
    const sleepAvg = (n)=>{
      const rows = sleepLastNDays(n);
      if(!rows.length) return null;
      const vals = rows.map(r=>safeNum(r.hours ?? r.h ?? r.duration ?? r.sleepHours, NaN)).filter(Number.isFinite);
      if(!vals.length) return null;
      return vals.reduce((a,b)=>a+b,0)/vals.length;
    };
    signals.sleep_avg_3d = sleepAvg(3);
    signals.sleep_avg_7d = sleepAvg(7);

    // ---- Mood: expect moodDaily[YYYY-MM-DD] = {stress:?, mood:?, value:?} ----
    const moodLastNDays = (n)=>{
      const cut = ymd(daysAgo(n));
      const keys = Object.keys(moodDaily).filter(k=>k >= cut).sort();
      return keys.map(k=>({ day:k, ...moodDaily[k] }));
    };
    const stressAvg = (n)=>{
      const rows = moodLastNDays(n);
      const vals = rows.map(r=>safeNum(r.stress ?? r.stressLevel ?? r.value ?? r.intensity, NaN)).filter(Number.isFinite);
      if(!vals.length) return null;
      return vals.reduce((a,b)=>a+b,0)/vals.length;
    };
    signals.stress_avg_3d = stressAvg(3);

    const moodTrend7d = ()=>{
      const rows = moodLastNDays(7);
      const vals = rows.map(r=>safeNum(r.moodScore ?? r.mood ?? r.value ?? r.intensity, NaN)).filter(Number.isFinite);
      if(vals.length < 3) return null;
      return vals[vals.length-1] - vals[0];
    };
    signals.mood_trend_7d = moodTrend7d();

    // ---- Shopping: sum amounts last 7 days & today ----
    const sumSpend = (sinceDateYMD)=>{
      let sum = 0;
      for(const it of shoppingHistory){
        const d = ymd(it.date || it.dt || it.day || it.when);
        if(!d) continue;
        if(d >= sinceDateYMD){
          sum += safeNum(it.amount ?? it.total ?? it.cost ?? it.price, 0);
        }
      }
      return sum;
    };
    const cut7 = ymd(daysAgo(7));
    const today = ymd(new Date());
    signals.spend_7d_total = sumSpend(cut7);
    signals.spend_today_total = sumSpend(today);

    // ---- Cleaning: detect overdue tasks (freqDays + lastDone) ----
    const tasks = Array.isArray(house.tasks) ? house.tasks : [];
    const due = [];
    const overdueHigh = [];
    for(const t of tasks){
      const freq = safeNum(t.freqDays ?? t.freq ?? t.frequencyDays, NaN);
      if(!Number.isFinite(freq)) continue;
      const last = ymd(t.lastDone || t.last || t.doneAt);
      if(!last) { due.push(t); if(t.priority==="high"||t.prio===3) overdueHigh.push(t); continue; }
      const lastDt = new Date(last);
      const diff = Math.floor((Date.now()-lastDt.getTime())/(1000*60*60*24));
      if(diff >= freq){
        due.push(t);
        if(t.priority==="high"||t.prio===3) overdueHigh.push(t);
      }
    }
    signals.cleaning_due_tasks = due.length;
    signals.cleaning_overdue_high = overdueHigh.length;

    // ---- Reminders: pending count ----
    signals.reminders_pending = reminders.filter(r=>!r.done && !r.completed).length;

    return signals;
  }

  function evalConditions(conditions, signals){
    for(const c of (conditions||[])){
      const a = signals[c.field];
      const op = OPS[c.operator];
      const b = c.value;
      if(!op) return false;
      if(a === null || typeof a === "undefined") return false;
      if(!op(a,b)) return false;
    }
    return true;
  }

  async function runNeuroClaw(input){
    const rules = await loadNeuroClawRules();
    const signals = computeSignals(input||{});
    const suggestions = [];
    for(const r of rules){
      if(evalConditions(r.conditions, signals)){
        suggestions.push({
          id: r.id,
          message: r.message,
          priority: r.priority || "medium",
          why: r.why || null,
          actions: r.actions || []
        });
      }
    }
    return { signals, suggestions, ts: Date.now() };
  }

  window.NeuroClaw = window.NeuroClaw || {};
  window.NeuroClaw.run = runNeuroClaw;
  window.NeuroClaw.computeSignals = computeSignals;
  window.NeuroClaw.loadRules = loadNeuroClawRules;
})();

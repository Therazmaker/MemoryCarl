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

    // ---- Sleep: supports v2 log entries: {date:'YYYY-MM-DD', totalMinutes:number} ----
    const lastNDaysKeys = (n)=>{
      const out = [];
      const d = new Date();
      d.setHours(0,0,0,0);
      for(let i=0;i<n;i++){
        const dd = new Date(d);
        dd.setDate(d.getDate()-i);
        out.push(dd.toISOString().slice(0,10));
      }
      return out; // includes today
    };
    const sleepAvg = (n)=>{
      const keys = new Set(lastNDaysKeys(n));
      // Sum minutes per day (in case multiple entries exist)
      const byDay = new Map();
      for(const r of sleepLog){
        const d = (r && typeof r.date === 'string') ? r.date : ymd(r.date || r.dt || r.day || r.when);
        if(!d || !keys.has(d)) continue;
        let mins = safeNum(r.totalMinutes, NaN);
        if(!Number.isFinite(mins)){
          // fallback fields
          const h = safeNum(r.hours ?? r.h ?? r.duration ?? r.sleepHours, NaN);
          mins = Number.isFinite(h) ? (h*60) : NaN;
        }
        if(!Number.isFinite(mins) || mins<=0) continue;
        byDay.set(d, (byDay.get(d)||0) + mins);
      }
      const totals = [...byDay.values()].filter(v=>v>0);
      if(!totals.length) return null;
      const avgMinutes = totals.reduce((a,b)=>a+b,0) / totals.length;
      const avgHours = avgMinutes / 60;
      return Math.round(avgHours*10)/10;
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

  // Generate lightweight questions based on signals
  function computeQuestions(signals, input){
    const qs = [];
    const sleepLog = Array.isArray(input?.sleepLog) ? input.sleepLog : [];
    const moodDaily = (input?.moodDaily && typeof input.moodDaily === "object") ? input.moodDaily : {};
    const reminders = Array.isArray(input?.reminders) ? input.reminders : [];

    if(!sleepLog.length){
      qs.push({
        id: "q_sleep_none",
        title: "Sueño sin datos",
        question: "Aún no has registrado sueño. ¿Qué te frenó?",
        reasonCodes: ["olvido","tiempo","estres","no_prioridad","otro"],
        related: { module:"sleep" }
      });
    }

    if(!Object.keys(moodDaily).length){
      qs.push({
        id: "q_mood_none",
        title: "Mood vacío",
        question: "¿Quieres que Mood sea rápido (1 toque) o detallado?",
        reasonCodes: ["rapido","detallado","luego","otro"],
        related: { module:"mood" }
      });
    }

    const pending = reminders.filter(r=>!r.done && !r.completed).length;
    if(pending>0){
      qs.push({
        id: "q_rem_pending",
        title: "Reminders pendientes",
        question: `Tienes ${pending} reminder(s) pendiente(s). ¿Qué te bloqueó?`,
        reasonCodes: ["olvido","tiempo","estres","no_prioridad","otro"],
        related: { module:"reminders", pending }
      });
    }

    if(Number.isFinite(signals?.sleep_avg_3d) && signals.sleep_avg_3d < 5.5){
      qs.push({
        id: "q_sleep_low",
        title: "Sueño bajo",
        question: "Tu promedio de sueño (3 días) está bajo. ¿Qué pasó?",
        reasonCodes: ["trabajo","estres","pantalla","salud","otro"],
        related: { module:"sleep", sleep_avg_3d: signals.sleep_avg_3d }
      });
    }

    return qs.slice(0, 3);
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
    const questions = computeQuestions(signals, input||{});
    return { signals, suggestions, questions, ts: Date.now() };
  }

  window.NeuroClaw = window.NeuroClaw || {};
  window.NeuroClaw.run = runNeuroClaw;
  window.NeuroClaw.computeSignals = computeSignals;
  window.NeuroClaw.loadRules = loadNeuroClawRules;
})();

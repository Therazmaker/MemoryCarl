// NeuroClaw v0.5 - local rules engine for MemoryCarl
// Runs fully offline. Sync is optional via existing flush.
// Exposes: window.NeuroClaw.run(input) -> Promise<{signals,suggestions,ts}>
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

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function daysBetween(a, b){
    const ms = (b.getTime() - a.getTime());
    return ms / (1000*60*60*24);
  }

  function toDate(x){
    if(!x) return null;
    if(x instanceof Date) return x;
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }

  // --- Rule loading (cached) ---
  let RULES_CACHE = null;
  let RULES_CACHE_TS = 0;

  async function loadNeuroClawRules({ force=false } = {}){
    // cache for 60s unless forced
    const now = Date.now();
    if(!force && RULES_CACHE && (now - RULES_CACHE_TS) < 60000){
      return RULES_CACHE;
    }
    const res = await fetch("./src/neuroclaw/neuroclaw_rules.json", { cache:"no-store" });
    if(!res.ok) throw new Error("NeuroClaw rules HTTP " + res.status);
    const j = await res.json();
    const rules = Array.isArray(j) ? j : (j.rules || []);
    RULES_CACHE = rules;
    RULES_CACHE_TS = now;
    return rules;
  }

  // --- Compute signals from app data ---
  function computeSignals(input){
    const now = input?.now instanceof Date ? input.now : new Date();
    const sleepLog = Array.isArray(input?.sleepLog) ? input.sleepLog : [];
    const moodDaily = input?.moodDaily && typeof input.moodDaily === "object" ? input.moodDaily : {};
    const reminders = Array.isArray(input?.reminders) ? input.reminders : [];
    const shoppingHistory = Array.isArray(input?.shoppingHistory) ? input.shoppingHistory : [];
    const house = input?.house && typeof input.house === "object" ? input.house : {};

    // ---- Sleep ----
    // Expect entries with {date, hours} or {ts, hours}
    const sleepEntries = sleepLog
      .map(e=>{
        const d = toDate(e.date || e.ts || e.day || e.d);
        // Support: {totalMinutes}, {minutes}, or explicit hours
        const mins = safeNum(e.totalMinutes ?? e.total_minutes ?? e.minutes ?? e.mins, NaN);
        const hoursRaw = safeNum(e.hours ?? e.h ?? e.value ?? e.sleepHours, NaN);
        const hours = Number.isFinite(mins) ? (mins/60) : hoursRaw;
        return (d && Number.isFinite(hours)) ? { d, hours } : null;
      })
      .filter(Boolean)
      .sort((a,b)=>a.d-b.d);

    function avgLastDays(arr, days){
      const cutoff = new Date(now.getTime() - days*24*60*60*1000);
      const xs = arr.filter(x=>x.d >= cutoff).map(x=>x.hours);
      if(!xs.length) return null;
      const s = xs.reduce((a,b)=>a+b,0);
      return s / xs.length;
    }

    const sleep_avg_3d = avgLastDays(sleepEntries, 3);
    const sleep_avg_7d = avgLastDays(sleepEntries, 7);

    // ---- Mood ----
    // Expect moodDaily keyed by YYYY-MM-DD with {mood, stress, energy, val} etc
    const MOOD_SCORE = {
      incredible: 9, good: 7, meh: 5, bad: 3, horrible: 1,
      // legacy ids
      happy: 9, pleased: 7, confused: 5, sad: 3, wtf: 1, angry: 2, irritated: 2
    };

    const moodRows = Object.entries(moodDaily).map(([k,v])=>{
      const d = toDate(k) || toDate(v?.date || v?.ts);
      const spriteId = (v && typeof v==="object") ? String(v.spriteId||"") : "";
      const valFromSprite = spriteId ? MOOD_SCORE[spriteId] : null;
      const val = Number.isFinite(valFromSprite) ? valFromSprite : safeNum(v?.value ?? v?.val ?? v?.intensity, NaN);
      const stress = safeNum(v?.stress ?? v?.s ?? v?.stressLevel, NaN); // optional (future)
      return (d) ? { d, stress: Number.isFinite(stress)?stress:null, val: Number.isFinite(val)?val:null } : null;
    }).filter(Boolean).sort((a,b)=>a.d-b.d);

    function avgFieldLastDays(rows, field, days){
      const cutoff = new Date(now.getTime() - days*24*60*60*1000);
      const xs = rows.filter(r=>r.d >= cutoff).map(r=>r[field]).filter(n=>Number.isFinite(n));
      if(!xs.length) return null;
      return xs.reduce((a,b)=>a+b,0) / xs.length;
    }

    const stress_avg_3d = avgFieldLastDays(moodRows, "stress", 3);

    // mood trend: compare avg of last 3d vs previous 3d (simple)
    function trendField(rows, field){
      const last3 = avgFieldLastDays(rows, field, 3);
      const cutoff6 = new Date(now.getTime() - 6*24*60*60*1000);
      const prevRows = rows.filter(r=>r.d >= cutoff6 && r.d < new Date(now.getTime() - 3*24*60*60*1000));
      const prev = prevRows.map(r=>r[field]).filter(n=>Number.isFinite(n));
      const prevAvg = prev.length ? prev.reduce((a,b)=>a+b,0)/prev.length : null;
      if(last3==null || prevAvg==null) return null;
      return last3 - prevAvg;
    }

    const mood_trend_7d = trendField(moodRows, "val");

    // ---- Shopping ----
    // Expect entries with {date, total} or {ts, amount} etc
    const shopRows = shoppingHistory.map(e=>{
      const d = toDate(e.date || e.ts || e.day);
      // Prefer totals.total (your structure). Fallback to summing items.
      let amount = safeNum(e?.totals?.total, NaN);
      if(!Number.isFinite(amount)){
        amount = safeNum(e.total ?? e.amount ?? e.value ?? e.spend, NaN);
      }
      if(!Number.isFinite(amount)){
        const items = Array.isArray(e.items) ? e.items : [];
        amount = items.reduce((sum,it)=> sum + (safeNum(it.price,0) * safeNum(it.qty,1)), 0);
      }
      return (d && Number.isFinite(amount)) ? { d, amount } : null;
    }).filter(Boolean).sort((a,b)=>a.d-b.d);

    function sumLastDays(rows, days){
      const cutoff = new Date(now.getTime() - days*24*60*60*1000);
      const xs = rows.filter(r=>r.d >= cutoff).map(r=>r.amount);
      if(!xs.length) return 0;
      return xs.reduce((a,b)=>a+b,0);
    }
    const spend_7d_total = sumLastDays(shopRows, 7);
    const spend_1d_total = sumLastDays(shopRows, 1);
    const shopping_entries_7d = shopRows.filter(r=>r.d >= new Date(now.getTime() - 7*24*60*60*1000)).length;

    // ---- House/Cleaning ----
    const sessionHist = Array.isArray(house.sessionHistory) ? house.sessionHistory : [];
    const cleanRows = sessionHist.map(s=>{
      const d = toDate(s.date || s.ts || s.startTs);
      const mins = safeNum(s.minutes ?? s.mins ?? s.durationMin ?? s.duration, NaN);
      return (d && Number.isFinite(mins)) ? { d, mins } : null;
    }).filter(Boolean);
    const cleaning_minutes_7d = cleanRows.filter(r=>r.d >= new Date(now.getTime() - 7*24*60*60*1000)).reduce((a,b)=>a+b.mins,0);

    // due tasks heuristic: if tasks have freqDays and lastDone
    const tasks = Array.isArray(house.tasks) ? house.tasks : [];
    let cleaning_due_tasks = 0;
    let cleaning_overdue_high = 0;
    for(const t of tasks){
      const freq = safeNum(t.freqDays ?? t.freq ?? t.everyDays, NaN);
      const last = toDate(t.lastDone || t.lastTs || t.doneAt);
      if(!Number.isFinite(freq) || !last) continue;
      const dueInDays = freq - daysBetween(last, now);
      if(dueInDays <= 0){
        cleaning_due_tasks++;
        const pr = String(t.priority || t.p || "low").toLowerCase();
        if(pr==="high" || pr==="urgent") cleaning_overdue_high++;
      }
    }

    // ---- Reminders ----
    const pending_reminders = reminders.filter(r=>!r.done && !r.completed).length;

    // Stability score (simple): sleep + stress balance
    const sleepComponent = sleep_avg_7d==null ? 50 : clamp((sleep_avg_7d/8)*100, 0, 100);
    const stressComponent = stress_avg_3d==null ? 50 : clamp(100 - (stress_avg_3d/10)*100, 0, 100);
    const stability_score = Math.round((sleepComponent*0.55 + stressComponent*0.45));

    return {
      sleep_avg_3d,
      sleep_avg_7d,
      stress_avg_3d,
      mood_trend_7d,
      spend_7d_total,
      spend_1d_total,
      shopping_entries_7d,
      cleaning_minutes_7d,
      cleaning_due_tasks,
      cleaning_overdue_high,
      pending_reminders,
      stability_score,
    };
  }

  function evalConditions(conds, signals){
    if(!Array.isArray(conds) || !conds.length) return false;
    for(const c of conds){
      const field = c.field;
      const op = c.operator;
      const val = c.value;
      const fn = OPS[op];
      if(!fn) return false;
      const a = signals[field];
      // if signal is null/undefined, condition fails
      if(a===null || typeof a==="undefined") return false;
      if(!fn(a, val)) return false;
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

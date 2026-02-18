// NeuroClaw v0.1 - local rules engine for MemoryCarl
// Runs fully offline. Sync is optional via existing Sheets flush.

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

export async function loadNeuroClawRules(){
  try{
    const res = await fetch("./src/neuroclaw/neuroclaw_rules.json", { cache:"no-store" });
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data = await res.json();
    return (data && data.rules && Array.isArray(data.rules)) ? data.rules : [];
  }catch(e){
    console.warn("NeuroClaw: failed to load rules:", e);
    return [];
  }
}

function isoDate(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}

function lastNDates(n, now=new Date()){
  const out=[];
  const base=new Date(now);
  base.setHours(0,0,0,0);
  for(let i=0;i<n;i++){
    const d=new Date(base);
    d.setDate(base.getDate()-i);
    out.push(isoDate(d));
  }
  return out;
}

export function moodScoreFromSpriteId(id){
  const k = String(id||"").toLowerCase();
  // Default set used in MemoryCarl
  if(k==="happy") return 2;
  if(k==="pleased") return 1;
  if(k==="sad") return -2;
  if(k==="angry") return -2;
  if(k==="irritated") return -1;
  if(k==="confused") return 0;
  if(k==="wtf") return -1;
  return 0; // unknown/custom -> neutral (user can extend later)
}

export function computeSignals({ sleepLog=[], moodDaily={}, reminders=[] } = {}, now=new Date()){
  // Sleep signals
  const sleepMap = new Map();
  for(const raw of (sleepLog||[])){
    const date = String(raw?.date||"").slice(0,10);
    const mins = Number(raw?.totalMinutes ?? raw?.total_minutes ?? 0);
    if(!date || !Number.isFinite(mins) || mins<=0) continue;
    sleepMap.set(date, (sleepMap.get(date)||0) + mins);
  }

  const dates3 = lastNDates(3, now);
  const dates7 = lastNDates(7, now);

  const sumMins = (dates)=>dates.reduce((a,d)=>a+(sleepMap.get(d)||0),0);
  const countRecorded = (dates)=>dates.reduce((a,d)=>a+((sleepMap.get(d)||0)>0 ? 1:0),0);

  const mins3 = sumMins(dates3);
  const mins7 = sumMins(dates7);
  const rec3 = Math.max(1, countRecorded(dates3)); // avoid div0, treat missing as 1 bucket
  const rec7 = Math.max(1, countRecorded(dates7));

  const sleep_avg_3d_hours = +(mins3/60/rec3).toFixed(2);
  const sleep_avg_7d_hours = +(mins7/60/rec7).toFixed(2);

  const target = 7; // hours
  const sleep_debt_3d_hours = +Math.max(0, (target*3) - (mins3/60)).toFixed(2);

  // Mood signals
  const moodMap = (moodDaily && typeof moodDaily==="object") ? moodDaily : {};
  const moodScores = dates7.map(d=>{
    const sid = moodMap[d]?.spriteId;
    return (sid ? moodScoreFromSpriteId(sid) : null);
  }).filter(v=>v!==null);

  const mood_score_7d_avg = moodScores.length ? +(moodScores.reduce((a,b)=>a+b,0)/moodScores.length).toFixed(2) : null;

  // negative streak (consecutive days from today backwards)
  let mood_neg_streak = 0;
  for(const d of dates7){
    const sid = moodMap[d]?.spriteId;
    if(!sid) break;
    const s = moodScoreFromSpriteId(sid);
    if(s < 0) mood_neg_streak++;
    else break;
  }

  const reminders_open = (reminders||[]).filter(r=>r && !r.done).length;

  return {
    ts: new Date(now).toISOString(),
    sleep_avg_3d_hours,
    sleep_avg_7d_hours,
    sleep_debt_3d_hours,
    mood_score_7d_avg,
    mood_neg_streak,
    reminders_open,
  };
}

function evalRule(rule, signals){
  const conds = Array.isArray(rule?.conditions) ? rule.conditions : [];
  for(const c of conds){
    const key = String(c?.key||"");
    const op = String(c?.op||"==");
    const val = c?.value;
    const a = signals[key];
    const fn = OPS[op];
    if(!fn){
      console.warn("NeuroClaw: unknown op", op, "in rule", rule?.id);
      return false;
    }
    // null/undefined should fail comparisons except !=
    if(a===null || a===undefined){
      if(op==="!=") continue;
      return false;
    }
    if(!fn(a, val)) return false;
  }
  return true;
}

function priorityScore(p){
  const k = String(p||"low").toLowerCase();
  if(k==="high") return 3;
  if(k==="medium") return 2;
  return 1;
}

export async function runNeuroClaw({ sleepLog=[], moodDaily={}, reminders=[] } = {}, now=new Date()){
  const rules = await loadNeuroClawRules();
  const signals = computeSignals({ sleepLog, moodDaily, reminders }, now);
  const suggestions = [];

  for(const r of rules){
    if(!r || !r.id) continue;
    if(evalRule(r, signals)){
      suggestions.push({
        id: String(r.id),
        title: String(r.title || "Sugerencia"),
        priority: String(r.priority || "low"),
        message: String(r.message || ""),
        why: Array.isArray(r.why) ? r.why.slice(0,4) : [],
        action: r.action || null,
      });
    }
  }

  suggestions.sort((a,b)=> priorityScore(b.priority)-priorityScore(a.priority));
  return { signals, suggestions };
}

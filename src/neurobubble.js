(function(){

  // NeuroBubble v5: smoother movement + personality (blink/breathe) + safe drag

  const memoryKey = "mc_bubble_memory_v5";


// --- Mood Engine (persistent internal state) ---
const stateKey = "mc_bubble_state_v1";

function defaultState(){
  return {
    energy: 0.72,     // 0..1
    concern: 0.22,    // 0..1
    focus: 0.55,      // 0..1
    attachment: 0.30, // 0..1 (trust/familiarity)
    lastUpdate: Date.now(),
    lastSeenDay: (new Date()).toISOString().slice(0,10),
    streakAnswered: 0,
    streakIgnored: 0
  };
}

function clamp01(n){ return Math.max(0, Math.min(1, n)); }

function loadState(){
  try{
    const raw = localStorage.getItem(stateKey);
    if(raw){
      const s = JSON.parse(raw);
      return Object.assign(defaultState(), s);
    }
  }catch(e){}
  return defaultState();
}

function saveState(s){
  try{ localStorage.setItem(stateKey, JSON.stringify(s)); }catch(e){}
}

function decayStateDaily(s){
  // Gentle drift back to baseline once per day
  const today = (new Date()).toISOString().slice(0,10);
  if(s.lastSeenDay === today) return s;

  const base = { energy:0.68, concern:0.25, focus:0.55, attachment: s.attachment }; // attachment stays
  const pull = 0.12; // how much we pull toward baseline per day
  s.energy  = clamp01(s.energy  + (base.energy  - s.energy )*pull);
  s.concern = clamp01(s.concern + (base.concern - s.concern)*pull);
  s.focus   = clamp01(s.focus   + (base.focus   - s.focus  )*pull);

  // streaks decay
  s.streakAnswered = Math.max(0, (s.streakAnswered||0) - 1);
  s.streakIgnored  = Math.max(0, (s.streakIgnored||0) - 1);

  s.lastSeenDay = today;
  s.lastUpdate = Date.now();
  saveState(s);
  return s;
}

function applyMoodToUI(s){
  // CSS vars for animation intensity
  bubble.style.setProperty("--mood-energy", s.energy.toFixed(3));
  bubble.style.setProperty("--mood-concern", s.concern.toFixed(3));
  bubble.style.setProperty("--mood-focus", s.focus.toFixed(3));
  bubble.style.setProperty("--mood-attach", s.attachment.toFixed(3));
  // Derived animation controls
  bubble.style.setProperty("--breatheDur", (2.2 + (1 - s.energy)*2.8).toFixed(2) + "s");
  bubble.style.setProperty("--pulseA", (0.10 + s.concern*0.35).toFixed(3));
  bubble.style.setProperty("--eyeCalm", (0.20 + (1 - s.concern)*0.60).toFixed(3));

  bubble.classList.toggle("mood-low", s.energy < 0.42);
  bubble.classList.toggle("mood-high", s.energy > 0.78);
  bubble.classList.toggle("mood-concerned", s.concern > 0.55);
  bubble.classList.toggle("mood-focused", s.focus > 0.66);

  // tone nudges (subtle)
  if(s.concern > 0.65 && !bubble.classList.contains("thinking")){
    bubble.classList.add("soft-pulse");
  }else{
    bubble.classList.remove("soft-pulse");
  }
}

function updateStateFromSignals(s, signals, suggestions){
  signals = signals || {};
  const fired = (suggestions || []).map(x=>x.id);

  // ENERGY: tied to sleep + general strain
  const sleep = signals.sleep_avg_3d_hours ?? signals.sleep_avg_7d_hours ?? null;
  if(typeof sleep === "number"){
    // map 4h..8h -> 0..1
    const e = clamp01((sleep - 4) / 4);
    s.energy = clamp01(s.energy*0.6 + e*0.4);
  }else if(fired.includes("sleep_low_3d")){
    s.energy = clamp01(s.energy - 0.10);
  }

  // CONCERN: tied to spend/debt flags
  const spend24 = signals.spend_24h_total ?? signals.spent_24h_total ?? null;
  if(typeof spend24 === "number"){
    // if spend is noticeable, gently increase concern; tiny spends don't matter
    const c = clamp01((spend24 - 5) / 50); // 5..55 -> 0..1
    s.concern = clamp01(s.concern*0.75 + c*0.25);
  }
  if(fired.some(id=>/debt|budget|spend|overspend|broke/i.test(id))){
    s.concern = clamp01(s.concern + 0.06);
  }

  // FOCUS: tied to routines/cleaning completion if present
  const clean7 = signals.cleaning_7d_min ?? signals.clean_7d_min ?? null;
  if(typeof clean7 === "number"){
    const f = clamp01(clean7 / 120); // 0..120 min -> 0..1
    s.focus = clamp01(s.focus*0.7 + f*0.3);
  }

  // attachment grows slowly just by being used
  s.attachment = clamp01(s.attachment + 0.005);

  s.lastUpdate = Date.now();
  saveState(s);
  applyMoodToUI(s);
  return s;
}

function updateStateFromAnswer(s, tags, text){
  tags = tags || [];
  const t = (text||"").toLowerCase();

  const did = /(si|hecho|logré|ya|ok|listo)/i.test(t);
  const nope = /(no pude|no logré|me costó|no hice|mañana|luego)/i.test(t);

  if(did){
    s.focus = clamp01(s.focus + 0.06);
    s.energy = clamp01(s.energy + 0.03);
    s.streakAnswered = (s.streakAnswered||0) + 1;
    s.streakIgnored = 0;
  }
  if(nope){
    s.focus = clamp01(s.focus - 0.05);
    s.concern = clamp01(s.concern + 0.04);
    s.streakIgnored = (s.streakIgnored||0) + 1;
    s.streakAnswered = Math.max(0, (s.streakAnswered||0) - 1);
  }

  if(tags.includes("calma")){
    s.concern = clamp01(s.concern - 0.05);
    s.energy = clamp01(s.energy + 0.02);
  }
  if(tags.includes("estrés") || tags.includes("deuda") || tags.includes("gasto")){
    s.concern = clamp01(s.concern + 0.03);
  }

  // attachment grows when you talk to it
  s.attachment = clamp01(s.attachment + 0.02);

  s.lastUpdate = Date.now();
  saveState(s);
  applyMoodToUI(s);
  return s;
}


  function defaultMemory(){
    return {
      likes: 0,
      dislikes: 0,
      answers: [],
      stats: {},
      prefs: {},
      lastQuestionAt: 0,
      lastQuestionId: null
    };
  }

  function loadMemory(){
    try{
      const raw = localStorage.getItem(memoryKey);
      const mem = raw ? JSON.parse(raw) : defaultMemory();
      return Object.assign(defaultMemory(), mem || {});
    }catch(e){
      return defaultMemory();
    }
  }

  function saveMemory(mem){
    try{ localStorage.setItem(memoryKey, JSON.stringify(mem)); }catch(e){}
  }

  function getSignals(){
    const s = window.__MC_STATE__ || {};
    const sleep3 = s.sleep_avg_3d_hours ?? s.sleep_avg_7d_hours ?? 0;
    const spend1 = s.spend_1d_total ?? s.spend_24h_total ?? s.spend_24h ?? 0;
    const mood7 = s.mood_trend_7d ?? 0;
    const clean7 = s.cleaning_minutes_7d ?? s.cleaning_7d_min ?? s.cleaning_7d ?? 0;

    const moonPhaseName = s.moon_phase_name ?? s.moon_phase ?? "";
    const moonSign = s.moon_sign ?? "";

    // Return both: legacy shorthand + explicit signal keys (so NeuroClaw can read them too)
    return {
      // legacy shorthand
      sleep: sleep3,
      spend: spend1,
      mood: mood7,
      cleaning: clean7,

      // explicit names
      sleep_avg_3d_hours: sleep3,
      spend_1d_total: spend1,
      mood_trend_7d: mood7,
      cleaning_minutes_7d: clean7,

      // cosmic lite
      moon_phase_name: moonPhaseName,
      moon_sign: moonSign,
      moon_phase_frac: s.moon_phase_frac ?? null,
      natal_loaded: !!s.natal_loaded,
      natal_name: s.natal_name ?? "",
    };
  }

  function localReply(sig){
    // Simple local "brain" until cloud is available
    // Cosmic hint (when available)
    if(sig.moon_phase_name && sig.moon_sign){
      const phase = String(sig.moon_phase_name);
      const sign = String(sig.moon_sign);
      // Only surface this sometimes: if user has interacted recently, or if it's a strong phase.
      if(phase === "Luna llena"){
        return {mood:"concerned", text:`${phase} con Luna en ${sign}. Sensibilidad alta: no te pelees con tus emociones.`, micro:"Micro: escribe 1 cosa que sientes (sin juzgar)."};
      }
      if(phase === "Luna nueva"){
        return {mood:"calm", text:`${phase} con Luna en ${sign}. Buen día para intención pequeña y clara.`, micro:"Micro: define 1 intención de hoy (1 línea)."};
      }
    }

    if(sig.sleep && sig.sleep < 5.5){
      return {mood:"concerned", text:"Sueño bajo. ¿Energía o disciplina hoy?", micro:"Micro: 3 respiraciones lentas."};
    }
    if(sig.spend && sig.spend > 50){
      return {mood:"alert", text:"Gasto alto reciente. ¿Plan o impulso?", micro:"Micro: revisa 1 línea del presupuesto."};
    }
    if(sig.cleaning && sig.cleaning < 10){
      return {mood:"calm", text:"La casa está tranquila. ¿Un mini-reset de 5 min?", micro:"Micro: recoge solo 5 objetos."};
    }
    if(sig.moon_phase_name && sig.moon_sign){
      return {mood:"calm", text:`${sig.moon_phase_name} • Luna en ${sig.moon_sign}. Usa esto como clima emocional, no como sentencia.`, micro:"Micro: elige 1 palabra guía para hoy."};
    }
    return {mood:"calm", text:"Todo estable. ¿Claridad, calma o impulso?", micro:"Micro: escribe 1 intención corta."};
  }

  async function cloudReply(signals){
    if(!window.NeuroClaw || !window.NeuroClaw.run) return null;
    try{
      bubble.classList.add("thinking");
      const r = await window.NeuroClaw.run({signals});
      bubble.classList.remove("thinking");
      return r;
    }catch(e){
      bubble.classList.remove("thinking");
      return null;
    }
  }

  function merge(local, cloud){
    if(!cloud) return local;
    return {
      // keep local mood (cloud may not send one)
      mood: local.mood,
      text: cloud.text || cloud.insight || local.text,
      micro: cloud.micro || local.micro
    };
  }

  // --- DOM ---
  const bubble = document.createElement("div");
  bubble.id = "neuroBubble";
  bubble.innerHTML = `
    <div class="nb-inner">
      <div class="eyes">
        <div class="eye"><div class="pupil"></div></div>
        <div class="eye"><div class="pupil"></div></div>
      </div>
      <div class="mouth"></div>
    </div>
  `;
  document.body.appendChild(bubble);

  const sayBox = document.createElement("div");
  sayBox.id = "neuroSay";
  sayBox.innerHTML = `<div class="txt"></div><div class="sub"></div><div class="controls">  <input class="inp" type="text" placeholder="Respóndeme aquí…" />  <button class="send" type="button">Enviar</button></div><div class="chips"></div>`;
  document.body.appendChild(sayBox);


  // --- Brain state (offline learning) ---
  const mem = loadMemory();
// Persistent internal state (mood)
const st = decayStateDaily(loadState());
applyMoodToUI(st);

  let latestNeuro = null; // {signals, suggestions, ts}
  const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h between questions (tunable)

  const QUESTIONS = [
    { id:"q_focus_today", tags:["foco"], prompt:"¿Qué necesitas hoy: claridad, calma o impulso?", chips:["claridad","calma","impulso"] },
    { id:"q_spend_trigger", tags:["gasto","deuda"], prompt:"Si hoy gastaste de más, ¿qué lo disparó: antojo, estrés o olvido?", chips:["antojo","estrés","olvido","no apliqué"] },
    { id:"q_sleep_feel", tags:["sueño"], prompt:"¿Cómo te sientes con tu energía ahora mismo: baja, ok o alta?", chips:["baja","ok","alta"] },
    { id:"q_next_step", tags:["plan"], prompt:"Dime 1 cosa pequeña que sí podrías hacer en 3 minutos ahora.", chips:["ordenar 1 cosa","anotar 1 gasto","agua + respirar"] },
    { id:"q_budget_pain", tags:["deuda"], prompt:"¿Qué parte del presupuesto te está doliendo más hoy?", chips:["deudas","comida","servicios","otro"] },
    { id:"q_mood", tags:["ánimo"], prompt:"Del 1 al 5, ¿cuánta calma sientes ahora?", chips:["1","2","3","4","5"] },
  ];

  function bumpStat(key, delta=1){
    mem.stats[key] = (mem.stats[key]||0) + delta;
  }

  function tagFromText(t){
    const s = (t||"").toLowerCase();
    const tags = new Set();
    if(/deud|pago|tarjeta|cuota/.test(s)) tags.add("deuda");
    if(/gast|compr|antoj|delivery/.test(s)) tags.add("gasto");
    if(/sueñ|dorm|cans/.test(s)) tags.add("sueño");
    if(/estr[eé]s|ansied|nerv/.test(s)) tags.add("estrés");
    if(/calm|tranq|respir/.test(s)) tags.add("calma");
    if(/foco|concentr|produc/.test(s)) tags.add("foco");
    return [...tags];
  }

  function chooseQuestion(){
    const now = Date.now();
    // Dynamic cooldown: respects your attention (less spam), but reacts faster when concern is high and trust is built
    const dynCooldown = Math.max(35*60*1000, Math.min(4*60*60*1000,
      COOLDOWN_MS * (1 + (st.streakIgnored||0)*0.35) * (1.15 - st.attachment*0.35) * (1.10 - st.concern*0.30)
    ));
    if(now - (mem.lastQuestionAt||0) < dynCooldown) return null;

    // Priority by neuro signals/suggestions
    const s = latestNeuro?.signals || {};
    const fired = (latestNeuro?.suggestions || []).map(x=>x.id);

    // heuristics (simple + robust)
    let wantedTags = [];
    if(fired.includes("sleep_low_3d") || (s.sleep_avg_3d_hours!=null && s.sleep_avg_3d_hours < 5.6)) wantedTags.push("sueño");
    if((s.spend_24h_total!=null && s.spend_24h_total > 0) || fired.some(id=>/spend|budget|debt/.test(id))) wantedTags.push("gasto","deuda");
    if(fired.some(id=>/mood|stress/.test(id))) wantedTags.push("estrés","ánimo");
    if(wantedTags.length===0) wantedTags = ["foco"];

    // Score each question
    let best=null, bestScore=-1;
    for(const q of QUESTIONS){
      let score = 0;
      for(const t of wantedTags){ if((q.tags||[]).includes(t)) score += 3; }
      if(mem.lastQuestionId && q.id === mem.lastQuestionId) score -= 10;
      // Use learned stats: if user often answers a tag, prefer it
      for(const t of q.tags||[]){ score += Math.min(2, (mem.stats[t]||0)/5); }
      score += Math.random()*0.3; // tiny variety
      if(score>bestScore){ bestScore=score; best=q; }
    }
    return best;
  }

  function microActionFor(tags){
    // very short actions (3-6 min)
    if(tags.includes("sueño")) return "Micro-acción (3 min): agua + 6 respiraciones lentas. Luego decide 1 cosa mínima.";
    if(tags.includes("deuda")) return "Micro-acción (4 min): abre presupuesto y anota SOLO 1 cifra clave (deuda o gasto de hoy).";
    if(tags.includes("gasto")) return "Micro-acción (3 min): escribe 1 regla para hoy: “solo 1 compra, y con lista”.";
    if(tags.includes("estrés") || tags.includes("ánimo")) return "Micro-acción (3 min): hombros abajo, 6 respiraciones, y nombra 1 cosa que sí está bajo control.";
    return "Micro-acción (3 min): elige 1 mini-tarea y termínala. Solo una.";
  }

  function submitAnswer(){
    if(!sayBox.classList.contains("ask")) return;
    const qid = sayBox.dataset.qid || "unknown";
    const inp = sayBox.querySelector(".inp");
    const text = (inp.value||"").trim();
    if(!text) return;

    const tags = tagFromText(text);
    tags.forEach(t=>bumpStat(t,1));

    mem.answers.push({
      ts: Date.now(),
      qid,
      text,
      tags,
      context: { signals: latestNeuro?.signals || null, suggestions: latestNeuro?.suggestions || null }
    });
    // cap memory size
    if(mem.answers.length > 120) mem.answers = mem.answers.slice(mem.answers.length-120);

    mem.lastQuestionAt = Date.now();
    mem.lastQuestionId = qid;
    saveMemory(mem);
    updateStateFromAnswer(st, tags, text);

    bubble.classList.remove("thinking");
    sayBox.classList.remove("ask");
    say("Guardado. 🫧", microActionFor(tags));
  }

  // Send button + enter key
  sayBox.addEventListener("click", (e)=>{
    const btn = e.target?.closest?.("button.send");
    if(btn){ submitAnswer(); }
  });
  sayBox.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); submitAnswer(); }
  });

  // Neuro state bridge
  window.addEventListener("neuro:state", (ev)=>{
    latestNeuro = ev.detail || null;
    // Update internal state from signals
    updateStateFromSignals(st, latestNeuro?.signals || null, latestNeuro?.suggestions || null);
    // When new state arrives, decide whether to ask
    const q = chooseQuestion();
    if(q){
      ask(q);
    }else{
      // small reactive comment sometimes
      const fired = (latestNeuro?.suggestions || []).map(x=>x.id);
      if(fired.includes("sleep_low_3d")){
        say("Te noto con sueño bajo 💤", "¿Quieres que hoy hagamos todo en modo mini? 3 minutos cada cosa.");
      }
    }
  });

  // Public helpers (for debugging / manual triggers)
  window.NeuroBubble = window.NeuroBubble || {};
  window.NeuroBubble.say = say;
  window.NeuroBubble.ask = ask;
  window.NeuroBubble.submit = submitAnswer;
  window.NeuroBubble.ingest = (detail)=>{ latestNeuro = detail; updateStateFromSignals(st, latestNeuro?.signals||null, latestNeuro?.suggestions||null); const q=chooseQuestion(); if(q) ask(q); };
  window.NeuroBubble.getState = ()=>Object.assign({}, st);
  window.NeuroBubble.setMood = (partial)=>{ Object.assign(st, partial||{}); st.energy=clamp01(st.energy); st.concern=clamp01(st.concern); st.focus=clamp01(st.focus); st.attachment=clamp01(st.attachment); saveState(st); applyMoodToUI(st); };

  // --- Movement state ---
  let x = 200, y = 200;
  let vx = 0.38, vy = 0.28;

  let dragging = false;
  let dragPointerId = null;
  let dragOffX = 0, dragOffY = 0;
  let movedDuringDrag = false;
  let lastInteractTs = Date.now();

  function clamp(){
    const maxX = Math.max(10, window.innerWidth - 70);
    const maxY = Math.max(10, window.innerHeight - 70);
    x = Math.max(10, Math.min(maxX, x));
    y = Math.max(10, Math.min(maxY, y));
  }

  function setPos(){
    bubble.style.setProperty("--bx", x + "px");
    bubble.style.setProperty("--by", y + "px");
  }

  function updateSayPos(){
    if(!sayBox.classList.contains('show')) return;
    const bubbleRect = bubble.getBoundingClientRect();
    let sx = bubbleRect.right + 10;
    let sy = bubbleRect.top - 10;
    let side = 'right';
    const maxW = 280;
    if(sx + maxW > window.innerWidth){
      sx = bubbleRect.left - (maxW + 10);
      side = 'left';
    }
    if(sx < 10){ sx = 10; }
    if(sy < 10){ sy = bubbleRect.bottom + 10; }
    if(sy + 140 > window.innerHeight){ sy = Math.max(10, window.innerHeight - 150); }
    sayBox.style.left = sx + 'px';
    sayBox.style.top = sy + 'px';
    sayBox.dataset.side = side;
  }

  function drift(){
    // gentle wandering, but not chaotic
    vx += (Math.random() - 0.5) * 0.015;
    vy += (Math.random() - 0.5) * 0.015;

    // light friction
    vx *= 0.992;
    vy *= 0.992;

    // cap speed
    const cap = 0.75;
    vx = Math.max(-cap, Math.min(cap, vx));
    vy = Math.max(-cap, Math.min(cap, vy));
  }

  function animate(){
    const idle = (Date.now() - lastInteractTs) > 12000;
    bubble.classList.toggle("idle", idle);

    if(!dragging){
      drift();
      x += vx;
      y += vy;
      clamp();
      setPos();
    }

    updateSayPos();
    requestAnimationFrame(animate);
  }

  function say(text, sub=""){
    lastInteractTs = Date.now();
    sayBox.classList.add("show");
    sayBox.querySelector(".txt").textContent = text;
    sayBox.querySelector(".sub").textContent = sub || "";
    // default: not awaiting answer
    sayBox.classList.remove("ask");
    sayBox.dataset.qid = "";
    updateSayPos();

    bubble.classList.add("talk");
    setTimeout(()=>bubble.classList.remove("talk"), 900);

    clearTimeout(sayBox._t);
    sayBox._t = setTimeout(()=> sayBox.classList.remove("show"), 5200);
  }

  function ask(q){
    // q: {id, prompt, chips?, sub?}
    lastInteractTs = Date.now();
    sayBox.classList.add("show","ask");
    sayBox.dataset.qid = q.id;
    sayBox.querySelector(".txt").textContent = q.prompt;
    sayBox.querySelector(".sub").textContent = q.sub || "Responde y lo guardaré para aprender 🙂";
    const inp = sayBox.querySelector(".inp");
    inp.value = "";
    inp.focus?.();

    // chips
    const chips = sayBox.querySelector(".chips");
    chips.innerHTML = "";
    (q.chips || []).slice(0,4).forEach(label=>{
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = label;
      b.addEventListener("click", ()=>{
        inp.value = label;
        submitAnswer();
      });
      chips.appendChild(b);
    });

    updateSayPos();
    bubble.classList.add("thinking");
    clearTimeout(sayBox._t);
    // keep open longer while asking
    sayBox._t = setTimeout(()=> {
      // If the question times out, count it as "ignored" (lightly)
      const stillAsking = sayBox.classList.contains("ask") && (sayBox.dataset.qid === q.id);
      sayBox.classList.remove("show","ask");
      if(stillAsking){
        st.streakIgnored = (st.streakIgnored||0) + 1;
        st.streakAnswered = Math.max(0, (st.streakAnswered||0) - 1);
        st.attachment = clamp01(st.attachment - 0.01);
        saveState(st); applyMoodToUI(st);
      }
    }, 20000);
  }

  // Eyes follow pointer (small)
  document.addEventListener("pointermove", e=>{
    bubble.querySelectorAll(".pupil").forEach(p=>{
      const rect = p.parentElement.getBoundingClientRect();
      const dx = e.clientX - rect.left - 6;
      const dy = e.clientY - rect.top - 6;
      p.style.transform = `translate(${dx*0.05}px, ${dy*0.05}px)`;
    });
  }, {passive:true});

  // Random blinks
  function scheduleBlink(){
    const wait = 1800 + Math.random()*4200; // 1.8s - 6s
    setTimeout(()=>{
      bubble.classList.add("blink");
      setTimeout(()=> bubble.classList.remove("blink"), 120);
      scheduleBlink();
    }, wait);
  }
  scheduleBlink();

  // Drag (pointer capture)
  bubble.addEventListener("pointerdown", (e)=>{
    lastInteractTs = Date.now();
    dragging = true;
    movedDuringDrag = false;
    dragPointerId = e.pointerId;
    bubble.classList.add("dragged");

    // offset so we "hold" the bubble where we touched it
    const rect = bubble.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;

    try{ bubble.setPointerCapture(dragPointerId); }catch(_){}
  });

  bubble.addEventListener("pointermove", (e)=>{
    if(!dragging || e.pointerId !== dragPointerId) return;
    const nx = e.clientX - dragOffX;
    const ny = e.clientY - dragOffY;
    if(Math.abs(nx - x) > 2 || Math.abs(ny - y) > 2) movedDuringDrag = true;
    x = nx; y = ny;
    clamp();
    setPos();
  });

  function endDrag(){
    dragging = false;
    dragPointerId = null;
    bubble.classList.remove("dragged");
  }

  bubble.addEventListener("pointerup", (e)=>{
    if(e.pointerId === dragPointerId){
      endDrag();
    }
  });

  bubble.addEventListener("pointercancel", (e)=>{
    if(e.pointerId === dragPointerId){
      endDrag();
    }
  });

  // Click to talk (ignore if it was a drag)
  bubble.addEventListener("click", async ()=>{
    lastInteractTs = Date.now();
    if(movedDuringDrag) return;

    // clear previous mood classes
    bubble.classList.remove("alert","concerned","calm");

    const signals = getSignals();
    const local = localReply(signals);
    const cloud = await cloudReply(signals);
    const final = merge(local, cloud);

    bubble.classList.add(final.mood);
    say(final.text, final.micro);
  });

  // Start
  setPos();
  animate();

})();
(function(){

  // NeuroBubble v5: smoother movement + personality (blink/breathe) + safe drag

  const memoryKey = "mc_bubble_memory_v5";

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
    localStorage.setItem(memoryKey, JSON.stringify(mem));
  }

  function getSignals(){
    const s = window.__MC_STATE__ || {};
    return {
      sleep: s.sleep_avg_3d_hours ?? 0,
      spend: s.spend_24h ?? 0,
      mood: s.mood_trend_7d ?? 0,
      cleaning: s.cleaning_7d ?? 0
    };
  }

  function localReply(sig){
    // Simple local "brain" until cloud is available
    if(sig.sleep && sig.sleep < 5.5){
      return {mood:"concerned", text:"Sueño bajo. ¿Energía o disciplina hoy?", micro:"Micro: 3 respiraciones lentas."};
    }
    if(sig.spend && sig.spend > 50){
      return {mood:"alert", text:"Gasto alto reciente. ¿Plan o impulso?", micro:"Micro: revisa 1 línea del presupuesto."};
    }
    if(sig.cleaning && sig.cleaning < 10){
      return {mood:"calm", text:"La casa está tranquila. ¿Un mini-reset de 5 min?", micro:"Micro: recoge solo 5 objetos."};
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
    if(now - (mem.lastQuestionAt||0) < COOLDOWN_MS) return null;

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
  window.NeuroBubble.ingest = (detail)=>{ latestNeuro = detail; const q=chooseQuestion(); if(q) ask(q); };

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
    sayBox._t = setTimeout(()=> sayBox.classList.remove("show","ask"), 20000);
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

(function(){

  // NeuroBubble v5: smoother movement + personality (blink/breathe) + safe drag

  const memoryKey = "mc_bubble_memory_v4";

  function loadMemory(){
    try{
      return JSON.parse(localStorage.getItem(memoryKey)) || {likes:0, dislikes:0};
    }catch(e){
      return {likes:0, dislikes:0};
    }
  }

  function saveMemory(mem){
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
  sayBox.innerHTML = `<div class="txt"></div><div class="sub"></div>`;
  document.body.appendChild(sayBox);

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

    requestAnimationFrame(animate);
  }

  function say(text, sub=""){
    sayBox.classList.add("show");
    sayBox.querySelector(".txt").textContent = text;
    sayBox.querySelector(".sub").textContent = sub;

    const bubbleRect = bubble.getBoundingClientRect();

    let sx = bubbleRect.right + 10;
    let sy = bubbleRect.top - 10;

    if(sx + 280 > window.innerWidth){
      sx = bubbleRect.left - 290;
    }
    if(sy < 10){
      sy = bubbleRect.bottom + 10;
    }

    sayBox.style.left = sx + "px";
    sayBox.style.top = sy + "px";

    bubble.classList.add("talk");
    setTimeout(()=>bubble.classList.remove("talk"), 900);

    clearTimeout(sayBox._t);
    sayBox._t = setTimeout(()=> sayBox.classList.remove("show"), 5200);
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

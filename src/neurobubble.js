
(function(){

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
    if(sig.sleep && sig.sleep < 5.5){
      return {mood:"concerned", text:"Sueño bajo. ¿Energía o disciplina hoy?", micro:"Respira 3 veces profundo."};
    }
    if(sig.spend && sig.spend > 50){
      return {mood:"alert", text:"Gasto alto reciente. ¿Plan o impulso?", micro:"Revisa 1 línea del presupuesto."};
    }
    return {mood:"calm", text:"Todo estable. ¿Claridad, calma o impulso?", micro:"Define una intención corta."};
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
      mood: local.mood,
      text: cloud.text || cloud.insight || local.text,
      micro: cloud.micro || local.micro
    };
  }

  const bubble = document.createElement("div");
  bubble.id = "neuroBubble";
  bubble.innerHTML = `
    <div class="eyes">
      <div class="eye"><div class="pupil"></div></div>
      <div class="eye"><div class="pupil"></div></div>
    </div>
    <div class="mouth"></div>
  `;

  document.body.appendChild(bubble);

  const sayBox = document.createElement("div");
  sayBox.id = "neuroSay";
  sayBox.innerHTML = `<div class="txt"></div><div class="sub"></div>`;
  document.body.appendChild(sayBox);

  let x = 200, y = 200, vx = 0.4, vy = 0.3;
  let dragging = false;

  function clamp(){
    x = Math.max(10, Math.min(window.innerWidth - 70, x));
    y = Math.max(10, Math.min(window.innerHeight - 70, y));
  }

  function drift(){
    vx += (Math.random()-0.5)*0.02;
    vy += (Math.random()-0.5)*0.02;
    vx *= 0.99;
    vy *= 0.99;
  }

  function animate(){
    if(!dragging){
      drift();
      x += vx;
      y += vy;
      clamp();
      bubble.style.transform = `translate(${x}px, ${y}px)`;
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
    sayBox._t = setTimeout(()=>{
      sayBox.classList.remove("show");
    }, 5000);
  }

  document.addEventListener("pointermove", e=>{
    bubble.querySelectorAll(".pupil").forEach(p=>{
      const rect = p.parentElement.getBoundingClientRect();
      const dx = e.clientX - rect.left - 6;
      const dy = e.clientY - rect.top - 6;
      p.style.transform = `translate(${dx*0.05}px, ${dy*0.05}px)`;
    });
  });

  bubble.addEventListener("pointerdown", ()=>{
    dragging = true;
  });

  window.addEventListener("pointermove", e=>{
    if(dragging){
      x = e.clientX - 28;
      y = e.clientY - 28;
    }
  });

  window.addEventListener("pointerup", ()=>{
    dragging = false;
  });

  bubble.addEventListener("click", async ()=>{
    const signals = getSignals();
    const local = localReply(signals);
    const cloud = await cloudReply(signals);
    const final = merge(local, cloud);
    bubble.classList.add(final.mood);
    say(final.text, final.micro);
  });

  animate();

})();

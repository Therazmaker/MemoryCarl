
window.addEventListener("load", () => {

  const memoryKey = "mc_bubble_memory_v1";

  function loadMemory(){
    return JSON.parse(localStorage.getItem(memoryKey) || "{}");
  }

  function saveMemory(mem){
    localStorage.setItem(memoryKey, JSON.stringify(mem));
  }

  function learn(type){
    const mem = loadMemory();
    mem[type] = (mem[type] || 0) + 1;
    saveMemory(mem);
  }

  function getSignals(){
    const state = window.__MC_STATE__ || {};
    return {
      sleep: state.sleep_avg_3d_hours ?? 0,
      spend: state.spend_24h ?? 0,
      mood: state.mood_trend_7d ?? 0,
      cleaning: state.cleaning_7d ?? 0
    };
  }

  function localReply(s){
    if(s.sleep && s.sleep < 5.5){
      return { mood:"concerned", text:"Dormiste poco. ¿Energía o disciplina hoy?", micro:"Respira 3 veces lento." };
    }
    if(s.spend && s.spend > 50){
      return { mood:"alert", text:"El gasto subió. ¿Plan o impulso?", micro:"Revisa 1 línea del presupuesto." };
    }
    return { mood:"calm", text:"Todo estable. ¿Buscamos claridad, calma o impulso?", micro:"Define una intención corta." };
  }

  async function cloudReply(signals){
    if(!window.NeuroClaw || !window.NeuroClaw.run) return null;
    try{
      return await window.NeuroClaw.run({signals});
    }catch(e){
      console.warn("Cloud error", e);
      return null;
    }
  }

  function merge(local, cloud){
    if(!cloud) return local;
    return {
      mood: local.mood,
      text: cloud.text || local.text,
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

  const panel = document.createElement("div");
  panel.id = "neuroPanel";
  panel.innerHTML = `
    <div class="nb-text"></div>
    <div class="nb-micro"></div>
    <input class="nb-input" placeholder="Respóndeme..." />
    <div class="nb-actions">
      <button class="like">👍</button>
      <button class="dislike">👎</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

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
      panel.style.transform = `translate(${x}px, ${y-120}px)`;
    }
    requestAnimationFrame(animate);
  }

  bubble.addEventListener("pointerdown", ()=>{
    dragging = true;
    bubble.classList.add("dragged");
  });

  window.addEventListener("pointermove", e=>{
    if(dragging){
      x = e.clientX - 28;
      y = e.clientY - 28;
    }
  });

  window.addEventListener("pointerup", ()=>{
    dragging = false;
    bubble.classList.remove("dragged");
  });

  bubble.addEventListener("click", ()=>{
    panel.classList.toggle("open");
  });

  panel.querySelector(".like").onclick = ()=> learn("likes");
  panel.querySelector(".dislike").onclick = ()=> learn("dislikes");

  panel.querySelector(".nb-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      const mem = loadMemory();
      mem.lastReply = e.target.value;
      saveMemory(mem);
      e.target.value = "";
    }
  });

  function applyMood(m){
    bubble.classList.remove("calm","alert","concerned");
    bubble.classList.add(m);
  }

  async function boot(){
    const signals = getSignals();
    const local = localReply(signals);
    const cloud = await cloudReply(signals);
    const final = merge(local, cloud);

    applyMood(final.mood);
    panel.querySelector(".nb-text").textContent = final.text;
    panel.querySelector(".nb-micro").textContent = "Micro: " + final.micro;
  }

  animate();
  boot();

});

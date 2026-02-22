
(function(){

  const memoryKey = "mc_bubble_memory_v3";

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

  function learn(type){
    const mem = loadMemory();
    if(type === "like") mem.likes++;
    if(type === "dislike") mem.dislikes++;
    saveMemory(mem);
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
  let idleTimer;

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
      panel.style.transform = `translate(${x}px, ${y-130}px)`;
    }
    requestAnimationFrame(animate);
  }

  document.addEventListener("pointermove", e=>{
    resetIdle();
    bubble.querySelectorAll(".pupil").forEach(p=>{
      const rect = p.parentElement.getBoundingClientRect();
      const dx = e.clientX - rect.left - 6;
      const dy = e.clientY - rect.top - 6;
      p.style.transform = `translate(${dx*0.05}px, ${dy*0.05}px)`;
    });
  });

  function resetIdle(){
    bubble.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(()=>bubble.classList.add("idle"), 6000);
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

  panel.querySelector(".like").onclick = ()=> learn("like");
  panel.querySelector(".dislike").onclick = ()=> learn("dislike");

  panel.querySelector(".nb-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
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

})();

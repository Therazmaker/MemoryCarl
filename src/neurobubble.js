
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
// =====================
// Personality + chatter
// =====================

const sayBox = document.createElement("div");
sayBox.id = "neuroSay";
sayBox.innerHTML = `<div class="txt"></div><div class="sub"></div>`;
document.body.appendChild(sayBox);

let lastUserActionAt = Date.now();
let talkCooldown = 0;

// suaviza pupilas (evita “movimiento feo”)
let pupilTx = 0, pupilTy = 0;
document.addEventListener("pointermove", (e)=>{
  lastUserActionAt = Date.now();

  const pupils = bubble.querySelectorAll(".pupil");
  pupils.forEach(p=>{
    const rect = p.parentElement.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width/2);
    const dy = e.clientY - (rect.top + rect.height/2);
    const targetX = Math.max(-4, Math.min(4, dx * 0.06));
    const targetY = Math.max(-4, Math.min(4, dy * 0.06));

    // easing: se acerca suave
    pupilTx = pupilTx + (targetX - pupilTx) * 0.25;
    pupilTy = pupilTy + (targetY - pupilTy) * 0.25;

    p.style.transform = `translate(${pupilTx}px, ${pupilTy}px)`;
  });
}, {passive:true});

// parpadeo automático
setInterval(()=>{
  bubble.classList.add("blink");
  setTimeout(()=>bubble.classList.remove("blink"), 120);
}, 4200 + Math.floor(Math.random()*2000));

// helper para hablar
function say(text, sub=""){
  // coloca el globo cerca de la burbuja
  sayBox.classList.add("show");
  sayBox.querySelector(".txt").textContent = text;
  sayBox.querySelector(".sub").textContent = sub;

  // posición: arriba a la izquierda de la burbuja (con clamp)
  const sx = Math.max(10, Math.min(window.innerWidth - 330, x + 70));
  const sy = Math.max(10, Math.min(window.innerHeight - 140, y - 10));
  sayBox.style.transform = `translate(${sx}px, ${sy}px)`;

  // boca hablando
  bubble.classList.add("talk");
  setTimeout(()=>bubble.classList.remove("talk"), 900);

  // auto-hide
  clearTimeout(sayBox._t);
  sayBox._t = setTimeout(()=>sayBox.classList.remove("show"), 5200);
}

// estado facial rápido
function face(mode){
  bubble.classList.remove("smile","annoyed");
  if(mode) bubble.classList.add(mode);
}

// frases por personalidad
function pickTone(){
  const mem = (()=>{
    try{ return JSON.parse(localStorage.getItem("mc_bubble_memory_v3")||"{}"); }catch(e){ return {}; }
  })();
  const likes = mem.likes||0, dislikes = mem.dislikes||0;
  const last = (mem.lastReply||"").toLowerCase();

  // mini “aprendizaje” simple
  if(/calma|tranquil|estres|ansied|agot/.test(last)) return "calm";
  if(/impulso|vamos|dale|accion|disciplina/.test(last)) return "push";
  if(/claridad|orden|prioriz|confus|no se/.test(last)) return "clarity";

  // si muchos dislikes, baja intensidad
  if(dislikes > likes + 2) return "calm";
  return "neutral";
}

function chatterLine(context="idle"){
  const tone = pickTone();

  const bank = {
    idle: {
      neutral: [
        "Sigo flotando… vigilando tu reino.",
        "¿Me das una misión pequeñita?",
        "Puedo oler una idea buena por aquí."
      ],
      calm: [
        "Vamos suave. Un paso. Sin prisa.",
        "Si hoy es pesado, lo hacemos liviano."
      ],
      push: [
        "Ok. Dame 5 minutos y te los convierto en progreso.",
        "Listo. ¿Qué micro-victoria hacemos ya?"
      ],
      clarity: [
        "Dime 1 cosa: ¿qué es lo más importante hoy?",
        "Si tu mente es un cuarto, ¿qué tiramos primero?"
      ],
    },
    drag: {
      neutral: ["¡Ey! Me estás arrastrando por el multiverso 😵", "Ok ok, cooperando…"],
      calm: ["Suavecito… estoy aquí."],
      push: ["Arrástrame a la acción, jefe 😤"],
      clarity: ["¿Me mueves porque dudas o porque decides?"]
    },
    open: {
      neutral: ["Estoy aquí. Dime qué necesitas.", "Modo escucha activado."],
      calm: ["Respira. Te sigo."],
      push: ["Vamos. Dame una meta concreta."],
      clarity: ["Dame contexto: ¿qué quieres resolver?"]
    },
    thinking: {
      neutral: ["Estoy pensando…", "Dame un segundo, estoy armando la idea."],
      calm: ["Procesando sin apuro…"],
      push: ["Calculando el golpe perfecto…"],
      clarity: ["Buscando la pieza que falta…"]
    }
  };

  const arr = (bank[context] && bank[context][tone]) || bank.idle.neutral;
  return arr[Math.floor(Math.random()*arr.length)];
}

// hablar cada cierto tiempo si estás idle
setInterval(()=>{
  const now = Date.now();
  const idleMs = now - lastUserActionAt;
  if(idleMs < 12000) return;            // si estás activo, no molesta
  if(Date.now() < talkCooldown) return; // cooldown

  face("smile");
  say(chatterLine("idle"), "Tip: toca la burbuja para abrir panel.");
  talkCooldown = Date.now() + 18000; // 18s
}, 5000);

// hooks a eventos existentes
bubble.addEventListener("click", ()=>{
  lastUserActionAt = Date.now();
  face("smile");
  say(chatterLine("open"), "Puedes escribir y presionar Enter.");
});

bubble.addEventListener("pointerdown", ()=>{
  lastUserActionAt = Date.now();
  face("annoyed");
  say(chatterLine("drag"));
});

// si tienes “thinking” cuando llamas a nube, refuerza el texto
const _origAdd = bubble.classList.add.bind(bubble.classList);
bubble.classList.add = function(...args){
  _origAdd(...args);
  if(args.includes("thinking")){
    lastUserActionAt = Date.now();
    say(chatterLine("thinking"));
  }
};
})();

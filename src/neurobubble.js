
(function(){
  const memoryKey = "mc_neurobubble_memory_v1";
  let memory = JSON.parse(localStorage.getItem(memoryKey) || "{}");
  memory.likes = memory.likes || 0;
  memory.dislikes = memory.dislikes || 0;

  const bubble = document.createElement('div');
  bubble.id = "neuroBubble";
  bubble.innerHTML = `
    <div class="eyes">
      <div class="eye left"><div class="pupil"></div></div>
      <div class="eye right"><div class="pupil"></div></div>
    </div>
    <div class="mouth"></div>
  `;

  const panel = document.createElement("div");
  panel.id = "neuroPanel";
  panel.innerHTML = `
    <div class="neuroText">Hola Carlos 👁️</div>
    <input class="neuroInput" placeholder="Respóndeme..." />
    <div class="neuroActions">
      <button class="like">👍</button>
      <button class="dislike">👎</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  let x = window.innerWidth * 0.5;
  let y = window.innerHeight * 0.5;
  let vx = 0.4;
  let vy = 0.3;
  let dragging = false;

  function organicDrift(){
    vx += (Math.random()-0.5)*0.02;
    vy += (Math.random()-0.5)*0.02;
    vx *= 0.99;
    vy *= 0.99;
  }

  function animate(){
    if(!dragging){
      organicDrift();
      x += vx;
      y += vy;

      if(x < 20 || x > window.innerWidth - 100) vx *= -1;
      if(y < 20 || y > window.innerHeight - 100) vy *= -1;

      bubble.style.transform = `translate(${x}px, ${y}px)`;
      panel.style.transform = `translate(${x}px, ${y-140}px)`;
    }
    requestAnimationFrame(animate);
  }

  // Eyes follow cursor
  document.addEventListener("pointermove", e=>{
    document.querySelectorAll(".pupil").forEach(p=>{
      const rect = p.parentElement.getBoundingClientRect();
      const dx = e.clientX - rect.left - 9;
      const dy = e.clientY - rect.top - 9;
      p.style.transform = `translate(${dx*0.05}px, ${dy*0.05}px)`;
    });
  });

  bubble.addEventListener("pointerdown", e=>{
    dragging = true;
    bubble.classList.add("dragged");
  });

  window.addEventListener("pointermove", e=>{
    if(dragging){
      x = e.clientX - 50;
      y = e.clientY - 50;
    }
  });

  window.addEventListener("pointerup", e=>{
    dragging = false;
    bubble.classList.remove("dragged");
  });

  bubble.addEventListener("click", ()=>{
    panel.classList.toggle("open");
  });

  panel.querySelector(".like").onclick = ()=>{
    memory.likes++;
    localStorage.setItem(memoryKey, JSON.stringify(memory));
  };

  panel.querySelector(".dislike").onclick = ()=>{
    memory.dislikes++;
    localStorage.setItem(memoryKey, JSON.stringify(memory));
  };

  panel.querySelector(".neuroInput").addEventListener("keydown", e=>{
    if(e.key==="Enter"){
      const val = e.target.value;
      panel.querySelector(".neuroText").textContent = "Estoy aprendiendo de ti...";
      memory.lastReply = val;
      localStorage.setItem(memoryKey, JSON.stringify(memory));
      e.target.value="";
    }
  });

  animate();
})();

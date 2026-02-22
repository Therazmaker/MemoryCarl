
(function(){

  const appRoot = document.getElementById("app");

  function getAppBounds(){
    if(!appRoot) return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
    return appRoot.getBoundingClientRect();
  }

  let bounds = getAppBounds();

  let x = 0;
  let y = 0;
  let vx = 0.4;
  let vy = 0.3;
  let dragging = false;

  // Create bubble
  const bubble = document.createElement('div');
  bubble.id = "neuroBubble";
  bubble.innerHTML = `
    <div class="eyes">
      <div class="eye left"><div class="pupil"></div></div>
      <div class="eye right"><div class="pupil"></div></div>
    </div>
    <div class="mouth"></div>
  `;

  document.body.appendChild(bubble);

  // Smart spawn near greeting
  window.addEventListener("load", () => {
    bounds = getAppBounds();
    const greeting = document.querySelector("h1");
    if(greeting){
      const g = greeting.getBoundingClientRect();
      x = g.right - 40;
      y = g.top + 60;
    } else {
      x = bounds.left + bounds.width / 2;
      y = bounds.top + 120;
    }
  });

  window.addEventListener("resize", () => {
    bounds = getAppBounds();
  });

  function clampPosition(){
    bounds = getAppBounds();

    x = Math.max(bounds.left + 20,
        Math.min(bounds.left + bounds.width - 100, x));

    y = Math.max(bounds.top + 20,
        Math.min(bounds.top + bounds.height - 100, y));
  }

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
      clampPosition();
      bubble.style.transform = `translate(${x}px, ${y}px)`;
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

  // Drag behavior
  bubble.addEventListener("pointerdown", ()=>{
    dragging = true;
    bubble.classList.add("dragged");
  });

  window.addEventListener("pointermove", e=>{
    if(dragging){
      x = e.clientX - 50;
      y = e.clientY - 50;
    }
  });

  window.addEventListener("pointerup", ()=>{
    dragging = false;
    bubble.classList.remove("dragged");
  });

  animate();

})();

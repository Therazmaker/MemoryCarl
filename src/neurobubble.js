
(function(){
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

  let x = window.innerWidth * 0.6;
  let y = window.innerHeight * 0.6;
  let vx = 0.3;
  let vy = 0.2;
  let dragging = false;

  function animate(){
    if(!dragging){
      x += vx;
      y += vy;

      if(x < 20 || x > window.innerWidth - 80) vx *= -1;
      if(y < 20 || y > window.innerHeight - 80) vy *= -1;

      bubble.style.transform = `translate(${x}px, ${y}px)`;
    }
    requestAnimationFrame(animate);
  }

  bubble.addEventListener("pointerdown", e=>{
    dragging = true;
    bubble.classList.add("dragged");
  });

  window.addEventListener("pointermove", e=>{
    if(dragging){
      x = e.clientX - 40;
      y = e.clientY - 40;
      bubble.style.transform = `translate(${x}px, ${y}px)`;
    }
  });

  window.addEventListener("pointerup", e=>{
    dragging = false;
    bubble.classList.remove("dragged");
  });

  animate();
})();

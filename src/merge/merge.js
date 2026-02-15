
(function(){
  // Requires Matter.js loaded globally

  let engine, render, runner;
  let currentType = 0;
  let score = 0;
  let gameOverState = false;
  let hudEl = null;
  let width = 0, height = 0;

  const TYPES = [
    { radius: 22, color: "#6EE7B7", points: 1 },
    { radius: 28, color: "#60A5FA", points: 2 },
    { radius: 34, color: "#F472B6", points: 4 },
    { radius: 42, color: "#F59E0B", points: 8 },
    { radius: 52, color: "#A78BFA", points: 16 },
    { radius: 64, color: "#FB7185", points: 32 }
  ];

  const LIMIT_Y = 120; // game over line
  const START_Y = 90;

  function ensureHud(container){
    if(hudEl) return;
    hudEl = document.createElement("div");
    hudEl.className = "mcMergeHud";
    hudEl.innerHTML = `
      <div class="mcMergeTop">
        <div class="mcMergeTitle">Merge Lab</div>
        <div class="mcMergeScore"><span>Score</span><b id="mcMergeScoreVal">0</b></div>
        <button class="mcMergeClose" id="mcMergeCloseBtn" aria-label="Close">✕</button>
      </div>
      <div class="mcMergeHint">Toca para soltar una pieza 👇</div>
    `;
    container.appendChild(hudEl);

    const btn = hudEl.querySelector("#mcMergeCloseBtn");
    if(btn){
      btn.addEventListener("click", ()=>{
        // If host app exposed a closer, call it. Else hide container.
        if(typeof window.closeMergeGameFull === "function") window.closeMergeGameFull();
        else container.style.display = "none";
      });
    }
  }

  function setScore(v){
    score = v;
    const el = hudEl?.querySelector("#mcMergeScoreVal");
    if(el) el.textContent = String(score);
  }

  function initMergeGame(containerId){
    if(!window.Matter){
      console.error("Matter.js not found. Check index.html script order.");
      return;
    }

    const { Engine, Render, Runner, Bodies, Composite, Events } = Matter;

    const container = document.getElementById(containerId);
    if(!container){
      console.error("merge container not found:", containerId);
      return;
    }

    // Reset container
    container.innerHTML = "";
    container.style.background = "#0B0F19";

    ensureHud(container);
    setScore(0);
    gameOverState = false;

    // Read size after it's visible
    width = container.clientWidth || window.innerWidth;
    height = container.clientHeight || window.innerHeight;

    engine = Engine.create();
    engine.gravity.y = 1;

    render = Render.create({
      element: container,
      engine: engine,
      options: {
        width,
        height,
        wireframes: false,
        background: "#0B0F19",
        pixelRatio: Math.min(2, window.devicePixelRatio || 1)
      }
    });

    // Arena
    const ground = Bodies.rectangle(width/2, height+30, width, 60, { isStatic: true, render:{fillStyle:"#111827"} });
    const leftWall = Bodies.rectangle(-30, height/2, 60, height, { isStatic: true, render:{fillStyle:"#111827"} });
    const rightWall = Bodies.rectangle(width+30, height/2, 60, height, { isStatic: true, render:{fillStyle:"#111827"} });

    // Visual limit line (sensor)
    const limitLine = Bodies.rectangle(width/2, LIMIT_Y, width, 4, {
      isStatic: true,
      isSensor: true,
      label: "limitLine",
      render: { fillStyle: "rgba(239,68,68,0.35)" }
    });

    Composite.add(engine.world, [ground, leftWall, rightWall, limitLine]);

    runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    // Controls: click/tap on canvas
    const onDrop = (evt)=>{
      if(gameOverState) return;

      // Prefer pointer coords relative to canvas
      const rect = render.canvas.getBoundingClientRect();
      const clientX = (evt.touches && evt.touches[0]) ? evt.touches[0].clientX : evt.clientX;
      const x = Math.max(30, Math.min(width-30, clientX - rect.left));

      spawnItem(x);
    };

    render.canvas.addEventListener("click", onDrop);
    render.canvas.addEventListener("touchstart", (e)=>{ e.preventDefault(); onDrop(e); }, { passive:false });

    Events.on(engine, "collisionStart", function(event){
      for(const pair of event.pairs){
        const a = pair.bodyA;
        const b = pair.bodyB;

        if(a.label === "mergeItem" && b.label === "mergeItem" && a.typeIndex === b.typeIndex){
          // avoid double merge same tick
          if(a._merging || b._merging) continue;
          a._merging = b._merging = true;
          mergeBodies(a, b);
        }
      }
    });

    Events.on(engine, "afterUpdate", checkGameOver);

    // Spawn a first piece automatically so it's not "all black"
    setTimeout(()=>{
      if(!gameOverState) spawnItem(width/2);
    }, 250);
  }

  function spawnItem(x){
    const { Bodies, Composite } = Matter;

    const type = TYPES[currentType];
    const body = Bodies.circle(x, START_Y, type.radius, {
      restitution: 0.2,
      friction: 0.3,
      frictionAir: 0.002,
      render: { fillStyle: type.color },
      label: "mergeItem"
    });
    body.typeIndex = currentType;

    Composite.add(engine.world, body);

    // Next: bias to small pieces like the reference games
    currentType = Math.random() < 0.7 ? 0 : 1;
  }

  function mergeBodies(a, b){
    if(gameOverState) return;

    const { Composite, Bodies } = Matter;

    const idx = a.typeIndex || 0;
    if(idx >= TYPES.length-1){
      // At max type: just remove merge flags so they can collide normally
      a._merging = b._merging = false;
      return;
    }

    const newIndex = idx + 1;
    const newType = TYPES[newIndex];

    const newBody = Bodies.circle(
      (a.position.x + b.position.x)/2,
      (a.position.y + b.position.y)/2,
      newType.radius,
      {
        restitution: 0.2,
        friction: 0.3,
        frictionAir: 0.002,
        render: { fillStyle: newType.color },
        label: "mergeItem"
      }
    );
    newBody.typeIndex = newIndex;

    Composite.remove(engine.world, a);
    Composite.remove(engine.world, b);
    Composite.add(engine.world, newBody);

    setScore(score + newType.points);
  }

  function checkGameOver(){
    if(gameOverState) return;

    const bodies = Matter.Composite.allBodies(engine.world);
    for(const body of bodies){
      if(body.label === "mergeItem"){
        // Only when it's actually piled near the top (not just falling through)
        if(body.position.y < LIMIT_Y && body.speed < 0.5){
          triggerGameOver();
          break;
        }
      }
    }
  }

  function triggerGameOver(){
    if(gameOverState) return;
    gameOverState = true;

    // simple overlay message
    const overlay = document.createElement("div");
    overlay.className = "mcMergeOver";
    overlay.innerHTML = `
      <div class="mcMergeOverCard">
        <div class="mcMergeOverTitle">Game Over</div>
        <div class="mcMergeOverSub">Se apiló demasiado arriba.</div>
        <div class="mcMergeOverBtns">
          <button class="btn" id="mcMergeAgain">Jugar otra</button>
          <button class="btn primary" id="mcMergeClose">Cerrar</button>
        </div>
      </div>
    `;
    render.element.appendChild(overlay);

    overlay.querySelector("#mcMergeAgain")?.addEventListener("click", ()=>{
      overlay.remove();
      // reset by re-init with same container
      const container = render.element.parentElement || render.element;
      const id = container.id || "mergeContainer";
      // stop old loops
      try{
        Matter.Render.stop(render);
        Matter.Runner.stop(runner);
      }catch{}
      initMergeGame(id);
    });

    overlay.querySelector("#mcMergeClose")?.addEventListener("click", ()=>{
      if(typeof window.closeMergeGameFull === "function") window.closeMergeGameFull();
      else render.element.parentElement.style.display = "none";
    });
  }

  window.initMergeGame = initMergeGame;

})();

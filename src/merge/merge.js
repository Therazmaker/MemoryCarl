
(function(){
  // Requires Matter.js loaded globally

  let engine, render, runner;
  let currentType = 0;
  let score = 0;
  let gameOverState = false;
  let hudEl = null;
  let width = 0, height = 0;
  let startedAt = 0;

  // Configurable (loaded from merge_config.json)
  let CFG = null;
  let ITEMS = null;
  let SPAWN_POOL = 4;
  let BG_URL = null;
  let IMG_CACHE = new Map();

  const DEFAULT_ITEMS = [
    { id:"d0", radius: 22, color:"#6EE7B7", points:1 },
    { id:"d1", radius: 28, color:"#60A5FA", points:2 },
    { id:"d2", radius: 34, color:"#F472B6", points:4 },
    { id:"d3", radius: 42, color:"#F59E0B", points:8 },
    { id:"d4", radius: 52, color:"#A78BFA", points:16 },
    { id:"d5", radius: 64, color:"#FB7185", points:32 }
  ];

  const LIMIT_Y = 120;     // y (px) from top: danger line
  const START_Y = 90;      // spawn y
  const GRACE_MS = 1300;   // ignore gameover checks right after start/spawn
  const STILL_V = 0.18;    // considered "still" (velocity threshold)

  async function loadConfig(){
    // Local override (from Settings UI)
    try{
      const raw = localStorage.getItem('mc_merge_cfg_override');
      if(raw){
        const parsed = JSON.parse(raw);
        CFG = parsed;
        SPAWN_POOL = Math.max(1, Math.min((CFG.spawnPool ?? 4), (CFG.items?.length ?? 6)));
        BG_URL = CFG.background || null;
        ITEMS = (CFG.items && CFG.items.length) ? CFG.items : DEFAULT_ITEMS;
        return CFG;
      }
    }catch(e){ console.warn('Invalid mc_merge_cfg_override, ignoring.', e); }

    if(CFG) return CFG;
    try{
      const res = await fetch("./src/merge/merge_config.json", { cache: "no-store" });
      if(!res.ok) throw new Error("HTTP " + res.status);
      CFG = await res.json();
      SPAWN_POOL = Math.max(1, Math.min((CFG.spawnPool ?? 4), (CFG.items?.length ?? 6)));
      BG_URL = CFG.background || null;
      ITEMS = (CFG.items && CFG.items.length) ? CFG.items : DEFAULT_ITEMS;
      return CFG;
    }catch(err){
      console.warn("Merge config not loaded, using defaults.", err);
      SPAWN_POOL = 4;
      BG_URL = null;
      ITEMS = DEFAULT_ITEMS;
      CFG = { spawnPool: SPAWN_POOL, background: null, items: ITEMS };
      return CFG;
    }
  }

  function preloadImage(url){
    return new Promise((resolve, reject)=>{
      if(!url) return resolve(null);
      if(IMG_CACHE.has(url)) return resolve(IMG_CACHE.get(url));
      const img = new Image();
      img.onload = ()=>{ IMG_CACHE.set(url, img); resolve(img); };
      img.onerror = (e)=>{ console.warn("Failed to load sprite", url); resolve(null); };
      img.src = url;
    });
  }

  async function preloadSprites(){
    if(!ITEMS) return;
    const urls = ITEMS.map(it => it.sprite).filter(Boolean);
    await Promise.all(urls.map(preloadImage));
    if(BG_URL) await preloadImage(BG_URL);

    // Debug: confirm what actually loaded.
    try{
      const loaded = Array.from(IMG_CACHE.entries()).map(([k,img])=>({
        k,
        w: img?.naturalWidth || img?.width || 0,
        h: img?.naturalHeight || img?.height || 0
      }));
      console.log('[MergeLab] sprites preloaded', loaded);
    }catch(e){}
  }

  function ensureHud(container){
    if(hudEl) return;
    hudEl = document.createElement("div");
    hudEl.className = "mcMergeHud";
    hudEl.innerHTML = `
      <div class="mcMergeTop">
        <div class="mcMergeTitle">Merge Lab <span id="mcMergeVer" class="mcMergeVer"></span></div>
        <div class="mcMergeScore"><span>Score</span><b id="mcMergeScoreVal">0</b></div>
        <button class="mcMergeClose" id="mcMergeCloseBtn" aria-label="Close">✕</button>
      </div>
      <div class="mcMergeHint">Toca para soltar una pieza 👇</div>
    `;
    container.appendChild(hudEl);

    const btn = hudEl.querySelector("#mcMergeCloseBtn");
    if(btn){
      btn.addEventListener("click", ()=>{
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

  function setBackground(container){
    if(BG_URL){
      container.style.backgroundImage = `url(${BG_URL})`;
      container.style.backgroundSize = "cover";
      container.style.backgroundPosition = "center";
      container.style.backgroundRepeat = "no-repeat";
    }else{
      container.style.backgroundImage = "none";
      container.style.background = "#0B0F19";
    }
  }

  async function initMergeGame(containerId){
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

    // Load config and assets first
    await loadConfig();
    await preloadSprites();

    // Reset container
    container.innerHTML = "";
    setBackground(container);

    ensureHud(container);
    try{
      const vEl = container.querySelector('#mcMergeVer');
      if(vEl) vEl.textContent = (CFG && CFG.version) ? CFG.version : '';
    }catch(e){}
    setScore(0);
    gameOverState = false;
    startedAt = Date.now();

    // Read size after it's visible
    width = container.clientWidth || window.innerWidth;
    height = container.clientHeight || window.innerHeight;
    // Defensive: if the container was just displayed, some browsers can report 0x0 momentarily.
    if(width < 50) width = window.innerWidth;
    if(height < 50) height = window.innerHeight;
    // Ensure the container itself has size.
    try{ container.style.width = "100vw"; container.style.height = "100vh"; }catch(e){}

    engine = Engine.create();
    engine.gravity.y = 1;

    render = Render.create({
      element: container,
      engine: engine,
      options: {
        width,
        height,
        wireframes: false,
        background: "rgba(0,0,0,0)", // let background image show
        pixelRatio: Math.min(2, window.devicePixelRatio || 1)
      }
    });

    // Force a consistent viewport. This prevents edge cases where bounds end up off-screen.
    try{ Matter.Render.lookAt(render, { min: { x: 0, y: 0 }, max: { x: width, y: height } }); }catch(e){}

    // Make sure canvas is on top of background
    try{
      render.canvas.style.position = 'absolute';
      render.canvas.style.inset = '0';
      render.canvas.style.zIndex = '1';
      render.canvas.style.width = '100%';
      render.canvas.style.height = '100%';
      render.canvas.style.touchAction = 'none';
    }catch(e){}

    // Arena
    const ground = Bodies.rectangle(width/2, height+30, width, 60, { isStatic: true, render:{fillStyle:"rgba(17,24,39,0.85)"} });
    const leftWall = Bodies.rectangle(-30, height/2, 60, height, { isStatic: true, render:{fillStyle:"rgba(17,24,39,0.85)"} });
    const rightWall = Bodies.rectangle(width+30, height/2, 60, height, { isStatic: true, render:{fillStyle:"rgba(17,24,39,0.85)"} });

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

    // Sprite activation hook: keep circles visible until the renderer has a loaded Image for the texture.
    Matter.Events.on(engine, "afterUpdate", () => {
      try{
        const texMap = (render && render.textures) ? render.textures : {};
        const bodies = Matter.Composite.allBodies(engine.world);
        for(const b of bodies){
          if(b._spritePending && !b.render.sprite){
            const t = b._spritePending.texture;
            const img = texMap ? texMap[t] : null;
            if(img && (img.complete || (img.naturalWidth||img.width))){
              b.render.sprite = { texture: t, xScale: b._spritePending.xScale, yScale: b._spritePending.yScale };
              // Leave fillStyle + stroke so it's never fully invisible.
              console.log("[MergeLab] sprite activated", t);
            }
          }
        }
      }catch(e){}
    });


    // Expose a tiny debug handle so we can inspect the world from DevTools.
    // (Safe: no secrets, just runtime objects.)
    try{
      window.__mcMerge = {
        engine,
        render,
        runner,
        spawnItem,
        getBodies: () => Matter.Composite.allBodies(engine.world),
        getItems: () => (ITEMS || DEFAULT_ITEMS)
      };
      console.log('[MergeLab] init ok', { width, height, spawnPool: SPAWN_POOL, items: (ITEMS||[]).length });
    }catch(e){}

    // Controls: click/tap on canvas
    const onDrop = (evt)=>{
      if(gameOverState) return;

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
          if(a._merging || b._merging) continue;
          a._merging = b._merging = true;
          mergeBodies(a, b);
        }
      }
    });

    Events.on(engine, "afterUpdate", checkGameOver);

    // Spawn a first piece automatically
    setTimeout(()=>{
      if(!gameOverState) spawnItem(width/2);
    }, 250);
  }

  function itemByIndex(i){
    if(!ITEMS) ITEMS = DEFAULT_ITEMS;
    return ITEMS[Math.max(0, Math.min(i, ITEMS.length-1))];
  }

  function applySpriteRender(body, item){
    // Keep a visible fallback fill. We only enable the sprite once we confirm
    // Matter's renderer has an actual loaded Image for the texture.
    if(item.color) body.render.fillStyle = item.color;
    body.render.strokeStyle = "rgba(255,255,255,0.35)";
    body.render.lineWidth = 1;

    if(item.sprite){
      // Store pending sprite info; a post-step hook will activate it once loaded.
      const target = (item.radius * 2);
      const img = IMG_CACHE.get(item.sprite);
      const iw = (img && (img.naturalWidth || img.width)) || 512;
      const ih = (img && (img.naturalHeight || img.height)) || 512;
      const sx = target / iw;
      const sy = target / ih;
      body._spritePending = { texture: item.sprite, xScale: sx, yScale: sy };
      // IMPORTANT: do NOT set body.render.sprite yet, so the fallback circle stays visible.
      try{
        console.log('[MergeLab] sprite pending', { texture: item.sprite, iw, ih, sx, sy });
      }catch(e){}
    }
  }

  function spawnItem(x){
    const { Bodies, Composite } = Matter;

    const item = itemByIndex(currentType);
    const body = Bodies.circle(x, START_Y, item.radius, {
      restitution: 0.2,
      friction: 0.3,
      frictionAir: 0.002,
      render: { fillStyle: item.color || "#6EE7B7" },
      label: "mergeItem"
    });
    body.typeIndex = currentType;
    body._spawnedAt = Date.now();

    applySpriteRender(body, item);

    Composite.add(engine.world, body);

    try{
      console.log('[MergeLab] spawn', { x, y: START_Y, r: item.radius, typeIndex: body.typeIndex, hasSprite: !!item.sprite });
    }catch(e){}

    // Next: random only from first SPAWN_POOL items
    currentType = Math.floor(Math.random() * SPAWN_POOL);
  }

  function mergeBodies(a, b){
    if(gameOverState) return;

    const { Composite, Bodies } = Matter;
    const idx = a.typeIndex || 0;

    if(idx >= (ITEMS.length-1)){
      a._merging = b._merging = false;
      return;
    }

    const newIndex = idx + 1;
    const item = itemByIndex(newIndex);

    const newBody = Bodies.circle(
      (a.position.x + b.position.x)/2,
      (a.position.y + b.position.y)/2,
      item.radius,
      {
        restitution: 0.2,
        friction: 0.3,
        frictionAir: 0.002,
        render: { fillStyle: item.color || "#A78BFA" },
        label: "mergeItem"
      }
    );
    newBody.typeIndex = newIndex;
    newBody._spawnedAt = Date.now();

    applySpriteRender(newBody, item);

    Composite.remove(engine.world, a);
    Composite.remove(engine.world, b);
    Composite.add(engine.world, newBody);

    setScore(score + (item.points || 1));
  }

  function isStill(body){
    const vx = Math.abs(body.velocity?.x || 0);
    const vy = Math.abs(body.velocity?.y || 0);
    return vx < STILL_V && vy < STILL_V;
  }

  function checkGameOver(){
    if(gameOverState) return;

    const now = Date.now();
    if(now - startedAt < GRACE_MS) return;

    const bodies = Matter.Composite.allBodies(engine.world);
    for(const body of bodies){
      if(body.label === "mergeItem"){
        if(body._spawnedAt && (now - body._spawnedAt < GRACE_MS)) continue;

        const topY = body.position.y - (body.circleRadius || 0);
        if(topY < LIMIT_Y && isStill(body)){
          triggerGameOver();
          break;
        }
      }
    }
  }

  function triggerGameOver(){
    if(gameOverState) return;
    gameOverState = true;

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
      try{
        Matter.Render.stop(render);
        Matter.Runner.stop(runner);
      }catch{}
      const container = render.element.parentElement || render.element;
      const id = container.id || "mergeContainer";
      initMergeGame(id);
    });

    overlay.querySelector("#mcMergeClose")?.addEventListener("click", ()=>{
      if(typeof window.closeMergeGameFull === "function") window.closeMergeGameFull();
      else render.element.parentElement.style.display = "none";
    });
  }

  window.initMergeGame = initMergeGame;

})();

// Merge Lab (drop + merge) for MemoryCarl
// Uses Matter.js loaded globally (window.Matter)

let _overlay = null;
let _engine = null;
let _render = null;
let _runner = null;
let _eventsBound = false;

const CHAIN = [
  { name: "cookie",   r: 18 },
  { name: "macaron",  r: 24 },
  { name: "bunny",    r: 32 },
  { name: "cupcake",  r: 42 },
  { name: "jelly",    r: 54 },
  { name: "burger",   r: 70 }
];

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function makeBody(x, y, idx){
  const Matter = window.Matter;
  const { Bodies } = Matter;

  const meta = CHAIN[idx] || CHAIN[CHAIN.length-1];
  const r = meta.r;

  const body = Bodies.circle(x, y, r, {
    restitution: 0.15,
    friction: 0.12,
    frictionAir: 0.002,
    density: 0.0018,
    label: `merge:${idx}`,
    render: {
      // We won't set colors here (Matter picks defaults). CSS overlay handles vibe.
    }
  });

  body.mergeIndex = idx;
  body.mergeRadius = r;
  body._isMerging = false;
  return body;
}

function setText(id, txt){
  const el = _overlay && _overlay.querySelector(id);
  if(el) el.textContent = txt;
}

function getHS(){
  try{ return Number(localStorage.getItem("merge_hs")||0) || 0; }catch{ return 0; }
}
function setHS(v){
  try{ localStorage.setItem("merge_hs", String(v)); }catch{}
}

function resize(){
  if(!_overlay || !_render) return;
  const stage = _overlay.querySelector(".mergeStage");
  if(!stage) return;

  const rect = stage.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(420, Math.floor(rect.height));

  _render.canvas.width = w;
  _render.canvas.height = h;
  _render.options.width = w;
  _render.options.height = h;

  // Rebuild walls for new size (simple approach)
  const Matter = window.Matter;
  const { World, Bodies } = Matter;

  // Remove existing statics tagged as wall
  const all = _engine.world.bodies.slice();
  all.forEach(b=>{
    if(b.isStatic && b.label && b.label.startsWith("wall:")){
      World.remove(_engine.world, b);
    }
  });

  const t = 40; // thickness
  const floor = Bodies.rectangle(w/2, h + t/2, w + t*2, t, { isStatic:true, label:"wall:floor" });
  const left  = Bodies.rectangle(-t/2, h/2, t, h + t*2, { isStatic:true, label:"wall:left" });
  const right = Bodies.rectangle(w + t/2, h/2, t, h + t*2, { isStatic:true, label:"wall:right" });

  World.add(_engine.world, [floor, left, right]);

  // danger line position (visual is CSS, but we keep a number)
  _engine.world._dangerY = 110;
}

export function openMergeGame(){
  if(_overlay) return;

  const Matter = window.Matter;
  if(!Matter){
    alert("Matter.js no está cargado. Revisa index.html (CDN).");
    return;
  }

  const { Engine, Render, Runner, World, Events, Mouse, MouseConstraint } = Matter;

  _overlay = document.createElement("div");
  _overlay.className = "mergeOverlay";
  _overlay.innerHTML = `
    <div class="mergeTop">
      <button class="iconBtn mergeClose" id="mergeClose" aria-label="Cerrar">✕</button>
      <div class="mergeTitle">
        <div class="mergeKicker">MERGE LAB</div>
        <div class="mergeSub">Suelta, choca, fusiona 😈🍬</div>
      </div>
      <div class="mergeStats">
        <div class="mergeStat"><div class="k">Score</div><div class="v" id="mergeScore">0</div></div>
        <div class="mergeStat"><div class="k">HS</div><div class="v" id="mergeHS">0</div></div>
      </div>
    </div>

    <div class="mergeStageWrap">
      <div class="mergeStage">
        <div class="mergeDanger" aria-hidden="true"></div>
      </div>
    </div>

    <div class="mergeBottom">
      <div class="mergeNext">
        <div class="k">Next</div>
        <div class="v" id="mergeNext">cookie</div>
      </div>
      <div class="mergeChain" id="mergeChain" aria-label="Cadena de evolución"></div>
      <button class="btn mergeRestart" id="mergeRestart">Reiniciar</button>
    </div>

    <div class="mergeGameOver" id="mergeGameOver" hidden>
      <div class="card mergeOverCard">
        <div class="mergeOverTitle">Game Over</div>
        <div class="small" id="mergeOverText">Se apiló demasiado arriba.</div>
        <div class="mergeOverBtns">
          <button class="btn" id="mergeOverRestart">Jugar otra</button>
          <button class="btn ghost" id="mergeOverClose">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  // render chain preview
  const chainEl = _overlay.querySelector("#mergeChain");
  if(chainEl){
    chainEl.innerHTML = CHAIN.map((x,i)=>`<div class="mergeChip" data-i="${i}">${i+1}. ${x.name}</div>`).join("");
  }

  // engine
  _engine = Engine.create();
  _engine.gravity.y = 1.0;

  // render
  const stage = _overlay.querySelector(".mergeStage");
  _render = Render.create({
    element: stage,
    engine: _engine,
    options: {
      wireframes: false,
      background: "transparent",
      pixelRatio: window.devicePixelRatio || 1
    }
  });

  // make canvas pointer friendly
  _render.canvas.classList.add("mergeCanvas");
  _render.canvas.setAttribute("aria-label", "Merge game canvas");

  // runner
  _runner = Runner.create();
  Render.run(_render);
  Runner.run(_runner, _engine);

  // Mouse constraint (for gentle nudges, optional)
  const mouse = Mouse.create(_render.canvas);
  const mc = MouseConstraint.create(_engine, {
    mouse,
    constraint: {
      stiffness: 0.08,
      render: { visible: false }
    }
  });
  World.add(_engine.world, mc);
  _render.mouse = mouse;

  // state
  let score = 0;
  let nextIdx = 0;
  let dropX = null;
  let canDrop = true;
  let isOver = false;

  const hs0 = getHS();
  setText("#mergeHS", String(hs0));
  setText("#mergeNext", CHAIN[nextIdx].name);

  const scoreAdd = (idx)=>{
    // more for bigger merges
    const add = Math.round(10 * Math.pow(1.6, idx));
    score += add;
    setText("#mergeScore", String(score));
    if(score > getHS()){
      setHS(score);
      setText("#mergeHS", String(score));
    }
  };

  const showOver = (txt)=>{
    isOver = true;
    canDrop = false;
    const over = _overlay.querySelector("#mergeGameOver");
    const t = _overlay.querySelector("#mergeOverText");
    if(t) t.textContent = txt || "Game Over.";
    if(over) over.hidden = false;
  };

  const hideOver = ()=>{
    const over = _overlay.querySelector("#mergeGameOver");
    if(over) over.hidden = true;
    isOver = false;
    canDrop = true;
  };

  const resetWorld = ()=>{
    const Matter = window.Matter;
    const { World } = Matter;
    // remove all non-static bodies
    const bodies = _engine.world.bodies.slice();
    bodies.forEach(b=>{
      if(!b.isStatic && b !== mc.body){
        World.remove(_engine.world, b);
      }
    });
    score = 0;
    nextIdx = 0;
    setText("#mergeScore", "0");
    setText("#mergeNext", CHAIN[nextIdx].name);
    hideOver();
  };

  // init sizing + walls
  resize();

  // spawn logic
  const spawn = (x)=>{
    if(!canDrop || isOver) return;
    canDrop = false;

    const Matter = window.Matter;
    const { World } = Matter;

    const w = _render.options.width || _render.canvas.width;
    const px = clamp(x ?? (w/2), 30, w-30);
    const body = makeBody(px, 60, nextIdx);
    World.add(_engine.world, body);

    // choose next
    // slight randomness with bias to small items
    const roll = Math.random();
    if(roll < 0.68) nextIdx = 0;
    else if(roll < 0.88) nextIdx = 1;
    else nextIdx = 2;

    setText("#mergeNext", CHAIN[nextIdx].name);

    // cooldown
    setTimeout(()=>{ canDrop = true; }, 280);
  };

  // collisions => merge
  Events.on(_engine, "collisionStart", (evt)=>{
    if(isOver) return;
    const pairs = evt.pairs || [];
    const Matter = window.Matter;
    const { World } = Matter;

    for(const p of pairs){
      const a = p.bodyA;
      const b = p.bodyB;

      if(!a || !b) continue;
      if(a.isStatic || b.isStatic) continue;

      const ia = a.mergeIndex;
      const ib = b.mergeIndex;
      if(ia === undefined || ib === undefined) continue;
      if(ia !== ib) continue;

      // already merging?
      if(a._isMerging || b._isMerging) continue;

      a._isMerging = true;
      b._isMerging = true;

      const nx = (a.position.x + b.position.x) / 2;
      const ny = (a.position.y + b.position.y) / 2;

      const ni = Math.min(ia + 1, CHAIN.length - 1);

      // merge next tick (avoid modifying world during collision iteration)
      setTimeout(()=>{
        try{
          World.remove(_engine.world, a);
          World.remove(_engine.world, b);

          const merged = makeBody(nx, ny, ni);
          // tiny pop
          merged.velocity.y = -1.2;
          World.add(_engine.world, merged);

          scoreAdd(ni);
        }catch(e){
          // ignore
        }
      }, 0);
    }
  });

  // game over check on every tick
  Events.on(_engine, "afterUpdate", ()=>{
    if(isOver) return;
    const dangerY = _engine.world._dangerY || 110;

    for(const b of _engine.world.bodies){
      if(b.isStatic) continue;
      if(b.mergeRadius){
        const top = b.position.y - b.mergeRadius;
        const calm = (Math.abs(b.velocity.y) < 0.25) && (Math.abs(b.velocity.x) < 0.25) && (Math.abs(b.angularVelocity) < 0.08);
        if(top < dangerY && calm){
          showOver("Se pasó la línea roja. Intenta apilar más abajo 🔥");
          break;
        }
      }
    }
  });

  // pointer handling
  const onMove = (e)=>{
    const rect = _render.canvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
    dropX = clientX - rect.left;
    // show faint guide via CSS variable
    _overlay.style.setProperty("--merge-drop-x", `${dropX}px`);
  };

  const onDown = (e)=>{
    // ignore clicks on UI
    if(e.target && (e.target.closest(".mergeTop") || e.target.closest(".mergeBottom") || e.target.closest(".mergeGameOver"))) return;
    if(e.cancelable) e.preventDefault();
    spawn(dropX);
  };

  _render.canvas.addEventListener("mousemove", onMove);
  _render.canvas.addEventListener("touchmove", onMove, { passive:false });
  _render.canvas.addEventListener("mousedown", onDown);
  _render.canvas.addEventListener("touchstart", onDown, { passive:false });

  const closeBtn = _overlay.querySelector("#mergeClose");
  if(closeBtn) closeBtn.addEventListener("click", ()=>closeMergeGame());

  const restartBtn = _overlay.querySelector("#mergeRestart");
  if(restartBtn) restartBtn.addEventListener("click", ()=>resetWorld());

  const overRestart = _overlay.querySelector("#mergeOverRestart");
  if(overRestart) overRestart.addEventListener("click", ()=>resetWorld());

  const overClose = _overlay.querySelector("#mergeOverClose");
  if(overClose) overClose.addEventListener("click", ()=>closeMergeGame());

  // ESC to close
  const onKey = (e)=>{
    if(e.key === "Escape") closeMergeGame();
  };
  window.addEventListener("keydown", onKey);

  // resize
  const onResize = ()=>resize();
  window.addEventListener("resize", onResize);

  // store cleanup handlers
  _overlay._mergeCleanup = ()=>{
    try{ window.removeEventListener("keydown", onKey); }catch{}
    try{ window.removeEventListener("resize", onResize); }catch{}
    try{ _render.canvas.removeEventListener("mousemove", onMove); }catch{}
    try{ _render.canvas.removeEventListener("touchmove", onMove); }catch{}
    try{ _render.canvas.removeEventListener("mousedown", onDown); }catch{}
    try{ _render.canvas.removeEventListener("touchstart", onDown); }catch{}
  };
}

export function closeMergeGame(){
  if(!_overlay) return;

  // cleanup listeners
  try{ _overlay._mergeCleanup && _overlay._mergeCleanup(); }catch{}

  // stop matter
  try{
    const Matter = window.Matter;
    if(_runner) Matter.Runner.stop(_runner);
    if(_render){
      Matter.Render.stop(_render);
      // remove canvas
      if(_render.canvas && _render.canvas.parentNode) _render.canvas.parentNode.removeChild(_render.canvas);
    }
    if(_engine){
      Matter.World.clear(_engine.world, false);
      Matter.Engine.clear(_engine);
    }
  }catch(e){
    // ignore
  }

  // remove overlay
  try{
    if(_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
  }catch{}

  _overlay = null;
  _engine = null;
  _render = null;
  _runner = null;
}

export function createInitialState(level){
  const hero = {
    x: level?.spawn?.hero?.x ?? 0,
    y: level?.spawn?.hero?.y ?? 0,
    icon: level?.spawn?.hero?.icon || "🧑‍🚀",
  };

  const pois = new Map();
  (level?.pois || []).forEach(p=>{
    if(!p?.id) return;
    pois.set(String(p.id), {
      id: String(p.id),
      x: Number(p.x||0),
      y: Number(p.y||0),
      icon: String(p.icon||"❖"),
      data: (p.data===undefined? null : String(p.data)),
    });
  });

  return {
    levelId: String(level?.id||""),
    hero,
    vars: {},
    flags: {
      scanned: {},
      delivered: {}
    },
    pois,
    log: [],
    status: "idle" // idle | running | error | win
  };
}

export function cloneState(s){
  // Small state: safe to structuredClone when available.
  try{ return structuredClone(s); }catch(e){
    const copy = JSON.parse(JSON.stringify({
      levelId: s.levelId,
      hero: s.hero,
      vars: s.vars,
      flags: s.flags,
      log: s.log,
      status: s.status
    }));
    // Rebuild pois map
    copy.pois = new Map();
    for(const [k,v] of s.pois.entries()) copy.pois.set(k, { ...v });
    return copy;
  }
}

export function serializeProgress({levelId, state, code}){
  return {
    v: 1,
    savedAt: new Date().toISOString(),
    levelId,
    state: {
      hero: state.hero,
      vars: state.vars,
      flags: state.flags
    },
    code: String(code||"")
  };
}

export function hydrateProgress(level, progress){
  const s = createInitialState(level);
  if(progress?.state?.hero){
    s.hero.x = Number(progress.state.hero.x ?? s.hero.x);
    s.hero.y = Number(progress.state.hero.y ?? s.hero.y);
  }
  if(progress?.state?.vars && typeof progress.state.vars === "object"){
    s.vars = { ...progress.state.vars };
  }
  if(progress?.state?.flags && typeof progress.state.flags === "object"){
    s.flags = {
      scanned: { ...(progress.state.flags.scanned||{}) },
      delivered: { ...(progress.state.flags.delivered||{}) }
    };
  }
  return s;
}

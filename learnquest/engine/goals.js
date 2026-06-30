export function evaluateGoals(level, state){
  const goals = Array.isArray(level?.goals) ? level.goals : [];
  const progress = [];
  let okCount = 0;

  for(const g of goals){
    const t = String(g?.type||"");
    let ok = false;

    if(t === "scanned"){
      const poi = String(g.poi||"");
      ok = !!state.flags?.scanned?.[poi];
      progress.push({ type:t, label:`Escanear ${poi}`, ok });
    }

    if(t === "delivered"){
      const poi = String(g.poi||"");
      const v = String(g.var||"");
      const rec = state.flags?.delivered?.[poi];
      ok = !!rec && (!v || rec.var === v);
      progress.push({ type:t, label:`Entregar ${v||"(algo)"} en ${poi}`, ok });
    }

    if(t === "contains"){
      const v = String(g.var||"");
      const txt = String(g.text||"");
      const val = state.vars?.[v];
      ok = (typeof val === "string") && val.includes(txt);
      progress.push({ type:t, label:`${v} contiene "${txt}"`, ok });
    }

    if(t === "reached"){
      const x = Number(g.x); const y = Number(g.y);
      ok = state.hero.x === x && state.hero.y === y;
      progress.push({ type:t, label:`Llegar a (${x},${y})`, ok });
    }

    if(ok) okCount++;
  }

  const win = goals.length > 0 ? (okCount === goals.length) : false;
  return { win, progress, okCount, total: goals.length };
}

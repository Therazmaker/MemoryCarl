function toFiniteNumber(value, fallback=0){
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeMomentum(events=[], options={}){
  const homeTeam = String(options?.homeTeam || "home").toLowerCase();
  const awayTeam = String(options?.awayTeam || "away").toLowerCase();
  return (Array.isArray(events) ? events : []).reduce((momentum, event)=>{
    const weight = toFiniteNumber(event?.weight, 0);
    const team = String(event?.team || "").toLowerCase();
    if(!weight) return momentum;
    if(team === homeTeam || team === "home") return momentum + weight;
    if(team === awayTeam || team === "away") return momentum - weight;
    return momentum;
  }, 0);
}

export function pressureIndex(events=[], team="", options={}){
  const fromMinute = toFiniteNumber(options?.fromMinute, 80);
  const target = String(team || "").toLowerCase();
  return (Array.isArray(events) ? events : [])
    .filter((event)=>toFiniteNumber(event?.minute, -1) >= fromMinute)
    .reduce((pressure, event)=>{
      if(String(event?.team || "").toLowerCase() !== target) return pressure;
      const type = String(event?.narrativeType || event?.type || "").toLowerCase();
      if(type === "shot") return pressure + 3;
      if(type === "big_chance") return pressure + 6;
      if(type === "corner") return pressure + 2;
      return pressure;
    }, 0);
}

export function detectResponse(events=[]){
  const rows = Array.isArray(events) ? events : [];
  for(let i=0;i<rows.length;i++){
    const type = String(rows[i]?.narrativeType || rows[i]?.type || "").toLowerCase();
    if(type !== "goal") continue;
    const scorerTeam = rows[i]?.team;
    const next = rows.slice(i + 1, i + 4);
    const emotionalReply = next.some((event)=>{
      const eventType = String(event?.narrativeType || event?.type || "").toLowerCase();
      return eventType === "big_chance" && event?.team && event.team !== scorerTeam;
    });
    if(emotionalReply) return true;
  }
  return false;
}

export function dangerScore(events=[], team=""){
  const target = String(team || "").toLowerCase();
  return (Array.isArray(events) ? events : []).reduce((score, event)=>{
    if(String(event?.team || "").toLowerCase() !== target) return score;
    const type = String(event?.narrativeType || event?.type || "").toLowerCase();
    if(type === "big_chance") return score + 8;
    if(type === "shot") return score + 4;
    if(type === "corner") return score + 2;
    return score;
  }, 0);
}

export function buildNarrativeBrainInput(events=[], options={}){
  const homeTeam = String(options?.homeTeam || "home");
  const awayTeam = String(options?.awayTeam || "away");
  return {
    momentum: computeMomentum(events, { homeTeam, awayTeam }),
    homePressure: pressureIndex(events, homeTeam, options),
    awayPressure: pressureIndex(events, awayTeam, options),
    homeDanger: dangerScore(events, homeTeam),
    awayDanger: dangerScore(events, awayTeam),
    emotionalResponse: detectResponse(events)
  };
}

/*
  Swiss Astro (Cloud Run backend)
  -------------------------------------------------
  This module does NOT ship ephemeris files to the browser.
  Instead, it calls your Swiss Astro backend endpoint:
      POST {NEURO_URL}/astro/daily
      Header: x-mc-key: {SWISS_KEY}

  Response expected (example):
    {
      "ok": true,
      "engine": "swiss_ephemeris",
      "now_utc": "2026-02-22T04:12:00Z",
      "planets": { "Sun": {"lon":123.4,"retro":false}, ... }
    }

  Client-side responsibilities:
  - Load natal chart JSON from localStorage
  - Compute houses (using natal cusps) and aspects (major) vs natal points
  - Produce 'transit_*' signals + a narrative hint for Bubble
*/

// Full-pro Swiss engine lives in NeuroClaw backend.

const LS_NATAL = "memorycarl_v2_natal_chart_json";
const KEY_URL = "memorycarl_v2_swiss_astro_url";
const KEY_KEY = "memorycarl_v2_swiss_astro_key";

function norm360(x){ x = x % 360; if(x < 0) x += 360; return x; }
function deltaDeg(a,b){
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

function getSwissAstroUrl(){ return (localStorage.getItem(KEY_URL) || "").trim().replace(/\/+$/,""); }
function getSwissAstroKey(){ return (localStorage.getItem(KEY_KEY) || "").trim(); }

export function swissTransitsAvailable(){
  const url = (localStorage.getItem(KEY_URL) || "").trim();
  const key = (localStorage.getItem(KEY_KEY) || "").trim();
  return !!(url && key);
}

function loadNatal(){
  try{
    const raw = localStorage.getItem(LS_NATAL);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return null;
    return obj;
  }catch(e){
    return null;
  }
}

function pickHouseForLon(lon, houses){
  if(!Array.isArray(houses) || houses.length < 4) return null;
  const cusps = houses
    .filter(h=> typeof h?.lon === "number" && typeof h?.house === "number")
    .map(h=>({house: Number(h.house), lon: norm360(Number(h.lon))}))
    .sort((a,b)=>a.lon-b.lon);
  if(cusps.length < 4) return null;
  const L = norm360(lon);
  let chosen = cusps[cusps.length - 1];
  for(const c of cusps){
    if(c.lon <= L) chosen = c;
    else break;
  }
  return chosen.house || null;
}

const ASPECTS = [
  {name:"Conjunción", deg:0,   orb:6.0, vibe:"intensifica"},
  {name:"Sextil",     deg:60,  orb:4.0, vibe:"abre puertas"},
  {name:"Cuadratura", deg:90,  orb:5.0, vibe:"tensa"},
  {name:"Trígono",    deg:120, orb:5.0, vibe:"fluye"},
  {name:"Oposición",  deg:180, orb:6.0, vibe:"espeja"},
];

const ORB_BY_TP = {
  "Moon": 8.0,
  "Sun": 6.0,
  "Mercury": 4.0,
  "Venus": 4.0,
  "Mars": 4.5,
  "Jupiter": 3.5,
  "Saturn": 3.5,
  "Uranus": 3.0,
  "Neptune": 3.0,
  "Pluto": 3.0,
};

function aspectHit(transitLon, natalLon, tp){
  const hits = [];
  const baseOrb = ORB_BY_TP[tp] ?? 3.0;
  for(const a of ASPECTS){
    const orb = Math.min(a.orb, baseOrb);
    const d = deltaDeg(transitLon, natalLon);
    const off = Math.abs(d - a.deg);
    if(off <= orb){
      hits.push({ aspect:a.name, aspect_deg:a.deg, orb:Number(off.toFixed(2)), vibe:a.vibe });
    }
  }
  hits.sort((x,y)=>x.orb-y.orb);
  return hits[0] || null;
}

function collectNatalPoints(natal){
  const pts = [];
  const pl = natal?.planets || {};
  for(const k of Object.keys(pl)){
    const p = pl[k];
    if(p && typeof p.lon === "number") pts.push({key:k, label:k, lon:norm360(p.lon)});
  }
  const ang = natal?.angles || {};
  for(const k of ["Asc","MC"]){
    const a = ang[k];
    if(a && typeof a.lon === "number") pts.push({key:k, label:k, lon:norm360(a.lon)});
  }
  return pts;
}

function priority(tp){
  // lower is more important
  if(tp === "Moon") return 0;
  if(tp === "Sun") return 1;
  if(tp === "Mercury" || tp === "Venus" || tp === "Mars") return 2;
  if(tp === "Jupiter" || tp === "Saturn") return 3;
  return 4;
}

function vibeHint(e){
  if(!e) return null;
  const tp = e.tp;
  if(e.aspect === "Cuadratura") return `${tp} en cuadratura a ${e.natal}: tensión útil. Pausa antes de reaccionar.`;
  if(e.aspect === "Oposición") return `${tp} en oposición a ${e.natal}: espejo. Escucha lo que el otro activa en ti.`;
  if(e.aspect === "Conjunción") return `${tp} en conjunción a ${e.natal}: foco alto. Canaliza en una sola cosa.`;
  if(e.aspect === "Trígono") return `${tp} en trígono a ${e.natal}: fluye. Avanza algo que venías postergando.`;
  if(e.aspect === "Sextil") return `${tp} en sextil a ${e.natal}: oportunidad pequeña. Si actúas, se abre.`;
  return null;
}

function topLine({moonSign, sunSign, bodiesTop, moonHouse, sunHouse, best, hasNatal}){
  const bits = [];
  bits.push(`Luna en ${moonSign}`);
  bits.push(`Sol en ${sunSign}`);
  if(hasNatal){
    if(moonHouse) bits.push(`Luna por Casa ${moonHouse}`);
    if(sunHouse) bits.push(`Sol por Casa ${sunHouse}`);
  }
  // Add one non-lunar/sun headline if available
  if(best){
    bits.push(`${best.tp} ${best.aspect.toLowerCase()} ${best.natal} (orb ${best.orb}°)`);
  }else if(bodiesTop){
    bits.push(bodiesTop);
  }
  return bits.join(" • ");
}


export async function getSwissDailyCached({ now = new Date(), forceRefresh = false } = {}){
  const iso = (now instanceof Date) ? now.toISOString().slice(0,10) : String(now||"").slice(0,10);
  const cacheKey = `mc_swiss_daily_${iso}`;
  if(!forceRefresh){
    try{
      const cached = localStorage.getItem(cacheKey);
      if(cached) return JSON.parse(cached);
    }catch(e){}
  }

  const url = getSwissAstroUrl();
  const key = getSwissAstroKey();
  if(!url || !key) return null;

  try{
    const res = await fetch(url.replace(/\/+$/,"") + "/astro/daily", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mc-key": key
      }
    });
    if(!res.ok){
      const t = await res.text().catch(()=> "");
      console.warn("[SwissAstro] HTTP", res.status, t);
      return null;
    }
    const data = await res.json();
    try{ localStorage.setItem(cacheKey, JSON.stringify(data)); }catch(e){}
    return data;
  }catch(e){
    console.warn("[SwissAstro] fetch failed", e);
    return null;
  }
}

export function swissDailyAvailable(){
  return swissTransitsAvailable();
}

// Back-compat: Settings / astro engine expects this function.
// We map the daily endpoint into the signal structure used by the app.
export async function getTransitSwissSignals({ now = new Date(), natal = null } = {}){
  const data = await getSwissDailyCached({ now });
  if(!data) return null;

  const transits = Array.isArray(data.transits) ? data.transits : [];
  const events = transits.map((t, i)=>({
    tp: "daily",
    aspect: String(i),
    natal: String(t || ""),
    title: String(t || ""),
    orb: null
  }));

  const top = transits[0] || data.message || "Sin tránsitos";
  const hint = data.message || "Swiss daily (mock).";

  return {
    ok: true,
    transit_engine: data.engine || "swiss_daily_v1",
    transit_has_natal: false,
    transit_moon_house: null,
    transit_sun_house: null,
    transit_events: events,
    transit_top: top,
    transit_hint: hint,
    transit_money_whisper: null,

    // Extra fields (for UI cards)
    daily_date: data.date || null,
    daily_moon_phase: data.moon_phase ?? null,
    daily_moon_sign: data.moon_sign || null,
    daily_message: data.message || null,
    daily_transits: transits
  };
}

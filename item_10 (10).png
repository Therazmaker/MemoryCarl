/*
  Transit Lite (Sun + Moon transits vs natal)
  -------------------------------------------------
  v1: local-only, lightweight, "good enough" daily guidance.

  What it does:
  - Computes current Sun/Moon ecliptic longitude (tropical) using the same lightweight routines as Cosmic Lite.
  - If natal chart JSON is present (memorycarl_v2_natal_chart_json), it derives:
      * Current house for Sun + Moon (based on natal house cusps longitudes)
      * Major aspects from transiting Sun/Moon to natal planets + angles (Asc/MC) with small orbs
  - Produces a short human-readable "transit_top" line + a structured "transit_events" array.

  IMPORTANT:
  - This is an approximation engine. Next upgrade is Swiss Ephemeris for high precision + more bodies.
*/

import { computeMoonNow, computeSunNow } from "./cosmic_lite.js";

const LS_NATAL = "memorycarl_v2_natal_chart_json";

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function norm360(x){ x = x % 360; if(x < 0) x += 360; return x; }
function deltaDeg(a,b){
  // minimal absolute angular distance [0..180]
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
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
  // houses: array of {house:1..12, lon:deg}
  if(!Array.isArray(houses) || houses.length < 4) return null;
  const cusps = houses
    .filter(h=> typeof h?.lon === "number" && typeof h?.house === "number")
    .map(h=>({house: Number(h.house), lon: norm360(Number(h.lon))}))
    .sort((a,b)=>a.lon-b.lon);

  if(cusps.length < 4) return null;

  const L = norm360(lon);

  // Find last cusp <= L. If none, we're in the segment after the last cusp (wrap to house of last cusp).
  let chosen = cusps[cusps.length - 1];
  for(const c of cusps){
    if(c.lon <= L) chosen = c;
    else break;
  }
  return chosen.house || null;
}

const ASPECTS = [
  {name:"Conjunción", deg:0,   orbSun:6.0, orbMoon:8.0, vibe:"intensifica"},
  {name:"Sextil",     deg:60,  orbSun:4.0, orbMoon:5.0, vibe:"abre puertas"},
  {name:"Cuadratura", deg:90,  orbSun:5.0, orbMoon:6.0, vibe:"tensa"},
  {name:"Trígono",    deg:120, orbSun:5.0, orbMoon:6.0, vibe:"fluye"},
  {name:"Oposición",  deg:180, orbSun:6.0, orbMoon:8.0, vibe:"espeja"},
];

function aspectHits(transitLon, natalLon, isMoon){
  const hits = [];
  for(const a of ASPECTS){
    const orb = isMoon ? a.orbMoon : a.orbSun;
    const d = deltaDeg(transitLon, natalLon);
    const off = Math.abs(d - a.deg);
    if(off <= orb){
      hits.push({
        aspect: a.name,
        aspect_deg: a.deg,
        orb: Number(off.toFixed(2)),
        vibe: a.vibe
      });
    }
  }
  // return closest hit first (rarely multiple)
  hits.sort((x,y)=>x.orb-y.orb);
  return hits;
}

function collectNatalPoints(natal){
  const pts = [];
  const pl = natal?.planets || {};
  for(const k of Object.keys(pl)){
    const p = pl[k];
    if(p && typeof p.lon === "number"){
      pts.push({key:k, label:k, lon:norm360(p.lon)});
    }
  }
  const ang = natal?.angles || {};
  for(const k of ["Asc","MC"]){
    const a = ang[k];
    if(a && typeof a.lon === "number"){
      pts.push({key:k, label:k, lon:norm360(a.lon)});
    }
  }
  return pts;
}

function topLine({moon, sun, moonHouse, sunHouse, events, hasNatal}){
  const bits = [];
  // Always show something even without natal
  bits.push(`Luna en ${moon.moon_sign}`);
  bits.push(`Sol en ${sun.sun_sign}`);
  if(hasNatal){
    if(moonHouse) bits.push(`Luna por Casa ${moonHouse}`);
    if(sunHouse) bits.push(`Sol por Casa ${sunHouse}`);
  }
  let extra = "";
  if(events && events.length){
    const e = events[0];
    extra = ` · ${e.tp} ${e.aspect.toLowerCase()} ${e.natal} (orb ${e.orb}°)`;
  }
  return bits.join(" • ") + extra;
}

function vibeHint(events){
  if(!events || !events.length) return null;
  const e = events[0];
  const tp = e.tp;
  // tiny narrative: not deterministic, a "weather report"
  if(e.aspect === "Cuadratura"){
    return `${tp} en cuadratura a ${e.natal}: la energía se siente apurada. Pausa antes de reaccionar.`;
  }
  if(e.aspect === "Oposición"){
    return `${tp} en oposición a ${e.natal}: lo de afuera te muestra algo tuyo. Observa sin pelear.`;
  }
  if(e.aspect === "Conjunción"){
    return `${tp} en conjunción a ${e.natal}: foco alto. Canaliza en una sola cosa.`;
  }
  if(e.aspect === "Trígono"){
    return `${tp} en trígono a ${e.natal}: fluye. Aprovecha para avanzar algo pendiente.`;
  }
  if(e.aspect === "Sextil"){
    return `${tp} en sextil a ${e.natal}: oportunidad pequeña. Si actúas, se abre.`;
  }
  return null;
}

export function getTransitLiteSignals(now = new Date()){
  const natal = loadNatal();
  const moon = computeMoonNow(now);
  const sun = computeSunNow(now);

  const hasNatal = !!natal;
  let moonHouse = null;
  let sunHouse = null;

  let events = [];
  if(hasNatal){
    moonHouse = pickHouseForLon(moon.moon_deg, natal?.houses);
    sunHouse  = pickHouseForLon(sun.sun_deg, natal?.houses);

    const pts = collectNatalPoints(natal);

    // Transits: Moon + Sun
    for(const pt of pts){
      const mHits = aspectHits(moon.moon_deg, pt.lon, true);
      if(mHits.length){
        const h = mHits[0];
        events.push({
          tp: "Luna",
          natal: pt.label,
          aspect: h.aspect,
          aspect_deg: h.aspect_deg,
          orb: h.orb
        });
      }
      const sHits = aspectHits(sun.sun_deg, pt.lon, false);
      if(sHits.length){
        const h = sHits[0];
        events.push({
          tp: "Sol",
          natal: pt.label,
          aspect: h.aspect,
          aspect_deg: h.aspect_deg,
          orb: h.orb
        });
      }
    }

    // sort: tightest orb first, Moon slightly prioritized on same orb
    events.sort((a,b)=>{
      if(a.orb !== b.orb) return a.orb - b.orb;
      if(a.tp !== b.tp) return a.tp === "Luna" ? -1 : 1;
      return 0;
    });

    // cap for UI
    events = events.slice(0, 6);
  }

  const top = topLine({moon, sun, moonHouse, sunHouse, events, hasNatal});
  const hint = vibeHint(events);

  return {
    // base bodies
    sun_sign: sun.sun_sign,
    sun_deg: sun.sun_deg,

    // houses
    transit_has_natal: hasNatal,
    transit_moon_house: moonHouse,
    transit_sun_house: sunHouse,

    // aspects
    transit_events: events,

    // narrative
    transit_top: top,
    transit_hint: hint,

    // meta
    transit_engine: "lite_v1"
  };
}

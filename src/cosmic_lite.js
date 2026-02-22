/*
  Cosmic Lite (Moon phase + Moon sign)
  -------------------------------------------------
  Goal: small, dependency-free utilities for MemoryCarl.

  Notes:
  - Uses lightweight astronomy routines inspired by SunCalc (MIT).
  - Outputs are approximate but stable enough for daily guidance UX.

  Returned values:
  - moon_phase_frac: 0..1 (0 new, 0.5 full)
  - moon_phase_name: e.g. "Luna llena"
  - moon_sign: Tropical zodiac sign (Aries..Piscis)
  - moon_deg: 0..360 ecliptic longitude
*/

const PI = Math.PI;
const rad = PI / 180;

// --- Julian date helpers ---
function toJulian(date){ return date.valueOf() / 86400000 - 0.5 + 2440588; }
function toDays(date){ return toJulian(date) - 2451545; }

// --- Astronomy helpers (SunCalc-style) ---
const e = rad * 23.4397; // obliquity of the Earth

function rightAscension(l, b){
  return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
}

function declination(l, b){
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}

function solarMeanAnomaly(d){
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M){
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372; // perihelion of the Earth
  return M + C + P + PI;
}

function sunCoords(d){
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0), M, L };
}

function moonCoords(d){
  // geocentric ecliptic coordinates of the moon
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.229350 * d);

  const l = L + rad * 6.289 * Math.sin(M);       // ecliptic longitude
  const b = rad * 5.128 * Math.sin(F);           // ecliptic latitude
  const dt = 385001 - 20905 * Math.cos(M);       // distance (km)

  return {
    ra: rightAscension(l, b),
    dec: declination(l, b),
    dist: dt,
    lon: l,
    lat: b
  };
}

function moonIllumination(date){
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);

  const sdist = 149598000; // distance to sun in km

  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) +
    Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );

  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) -
    Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );

  const fraction = (1 + Math.cos(inc)) / 2;

  // phase: 0..1 where 0 is new and 0.5 is full
  const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI;

  return { fraction, phase };
}

function norm360(deg){
  let x = deg % 360;
  if(x < 0) x += 360;
  return x;
}

const SIGNS = [
  "Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo",
  "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"
];

function zodiacFromDeg(deg){
  const idx = Math.floor(norm360(deg) / 30) % 12;
  return SIGNS[idx];
}

function phaseName(phase){
  // phase in [0..1)
  const p = (phase % 1 + 1) % 1;
  // thresholds tuned for human-readable buckets
  if(p < 0.03 || p >= 0.97) return "Luna nueva";
  if(p < 0.22) return "Creciente";
  if(p < 0.28) return "Cuarto creciente";
  if(p < 0.47) return "Gibosa creciente";
  if(p < 0.53) return "Luna llena";
  if(p < 0.72) return "Gibosa menguante";
  if(p < 0.78) return "Cuarto menguante";
  return "Menguante";
}

export function computeMoonNow(date = new Date()){
  const illum = moonIllumination(date);
  const d = toDays(date);
  const m = moonCoords(d);
  const moonDeg = norm360((m.lon / rad));
  const sign = zodiacFromDeg(moonDeg);
  const name = phaseName(illum.phase);

  return {
    moon_phase_frac: Number(illum.phase.toFixed(4)),
    moon_illum_frac: Number(illum.fraction.toFixed(4)),
    moon_phase_name: name,
    moon_sign: sign,
    moon_deg: Number(moonDeg.toFixed(2))
  };
}

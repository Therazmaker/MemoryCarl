import os
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Tuple

import swisseph as swe


MC_API_KEY = (os.getenv("MC_API_KEY") or "").strip()
EPHE_PATH = (os.getenv("SWISSEPH_PATH") or "").strip()


def _init_swiss():
    # Optional ephemeris path. If missing, we'll fall back to MOSEPH.
    try:
        if EPHE_PATH:
            swe.set_ephe_path(EPHE_PATH)
    except Exception:
        pass


_init_swiss()

app = FastAPI(title="NeuroClaw Swiss Astro", version="1.0")


class TransitReq(BaseModel):
    now_iso: str | None = None
    lat: float | None = None
    lon: float | None = None


class FullProReq(BaseModel):
    now_iso: str | None = None
    natal: Dict[str, Any] | None = None


PLANETS = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Uranus": swe.URANUS,
    "Neptune": swe.NEPTUNE,
    "Pluto": swe.PLUTO,
}


def _parse_now(now_iso: str | None) -> datetime:
    if not now_iso:
        return datetime.now(timezone.utc)
    # accept Z or offset
    try:
        if now_iso.endswith("Z"):
            return datetime.fromisoformat(now_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
        return datetime.fromisoformat(now_iso).astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _jd_ut(dt: datetime) -> float:
    dt = dt.astimezone(timezone.utc)
    h = dt.hour + dt.minute / 60.0 + dt.second / 3600.0 + dt.microsecond / 3_600_000_000.0
    return swe.julday(dt.year, dt.month, dt.day, h)


SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]


ASPECTS = [
    ("Conjunción", 0.0),
    ("Sextil", 60.0),
    ("Cuadratura", 90.0),
    ("Trígono", 120.0),
    ("Oposición", 180.0),
]


ORB_BY_TP = {
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
}


def _norm360(x: float) -> float:
    x = x % 360.0
    return x + 360.0 if x < 0 else x


def _delta_deg(a: float, b: float) -> float:
    d = abs(_norm360(a) - _norm360(b))
    return 360.0 - d if d > 180.0 else d


def _sign_name(lon: float) -> str:
    i = int(_norm360(lon) // 30.0)
    return SIGNS[i % 12]


def _phase_from_sun_moon(sun_lon: float, moon_lon: float) -> Dict[str, Any]:
    # phase angle 0=new, 180=full
    import math

    ang = _norm360(moon_lon - sun_lon)
    frac = ang / 360.0
    illum = (1.0 - math.cos(math.radians(ang))) / 2.0

    def near(a: float, b: float, w: float) -> bool:
        return abs(a - b) <= w

    if near(ang, 0.0, 12.0):
        name = "Luna nueva"
    elif near(ang, 90.0, 12.0):
        name = "Cuarto creciente"
    elif near(ang, 180.0, 12.0):
        name = "Luna llena"
    elif near(ang, 270.0, 12.0):
        name = "Cuarto menguante"
    elif 0.0 < ang < 90.0:
        name = "Creciente"
    elif 90.0 < ang < 180.0:
        name = "Gibosa creciente"
    elif 180.0 < ang < 270.0:
        name = "Gibosa menguante"
    else:
        name = "Menguante"

    return {
        "phase_angle": float(ang),
        "phase_frac": float(frac),
        "illum": float(illum),
        "phase_name": name,
    }


def _house_for_lon(lon: float, cusps: List[float]) -> Optional[int]:
    if not cusps or len(cusps) < 12:
        return None
    L = _norm360(lon)
    c = [_norm360(x) for x in cusps]
    pairs = [(i + 1, c[i]) for i in range(12)]
    pairs.sort(key=lambda x: x[1])
    chosen = pairs[-1][0]
    for h, cl in pairs:
        if cl <= L:
            chosen = h
        else:
            break
    return int(chosen)


def _aspect_hit(tp: str, t_lon: float, n_lon: float) -> Optional[Dict[str, Any]]:
    base_orb = ORB_BY_TP.get(tp, 3.0)
    d = _delta_deg(t_lon, n_lon)
    best = None
    for name, adeg in ASPECTS:
        off = abs(d - adeg)
        orb = min(base_orb, 6.0 if name in ("Conjunción", "Oposición") else 5.0)
        if name == "Sextil":
            orb = min(orb, 4.0)
        if off <= orb:
            cand = {"aspect": name, "aspect_deg": adeg, "orb": round(off, 2)}
            if best is None or cand["orb"] < best["orb"]:
                best = cand
    return best


def _priority(tp: str) -> int:
    if tp == "Moon":
        return 0
    if tp == "Sun":
        return 1
    if tp in ("Mercury", "Venus", "Mars"):
        return 2
    if tp in ("Jupiter", "Saturn"):
        return 3
    return 4


def _parse_tz_offset_min(natal: Dict[str, Any]) -> int:
    try:
        meta = natal.get("meta") if isinstance(natal, dict) else None
        if isinstance(meta, dict):
            v = meta.get("tz_offset_min")
            if isinstance(v, (int, float)):
                return int(v)
            s = str(meta.get("timezone_assumed") or meta.get("timezone") or "").upper()
            import re
            m = re.search(r"(UTC|GMT)\s*([+\-−])\s*(\d{1,2})(?:[:.]?(\d{2}))?", s)
            if m:
                sign = -1 if m.group(2) in ("-", "−") else 1
                hh = int(m.group(3))
                mm = int(m.group(4) or "0")
                return sign * (hh * 60 + mm)
    except Exception:
        pass
    return 0


def _parse_birth_local(natal: Dict[str, Any]) -> Optional[datetime]:
    try:
        meta = natal.get("meta") if isinstance(natal, dict) else None
        if isinstance(meta, dict):
            s = meta.get("birth_local")
            if isinstance(s, str) and s:
                return datetime.fromisoformat(s)
    except Exception:
        return None
    return None


def _extract_latlon(natal: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    meta = natal.get("meta") if isinstance(natal, dict) else None
    if isinstance(meta, dict):
        coords = meta.get("coords")
        if isinstance(coords, dict):
            lat = coords.get("lat")
            lon = coords.get("lon")
            try:
                return (float(lat), float(lon))
            except Exception:
                pass
        try:
            return (float(meta.get("lat")), float(meta.get("lon")))
        except Exception:
            return (None, None)
    return (None, None)


def _calc_houses(jd_ut: float, lat: float, lon: float) -> Tuple[List[float], Dict[str, float]]:
    try:
        cusps, ascmc = swe.houses(jd_ut, lat, lon, b"P")
        cc = [float(cusps[i]) for i in range(1, 13)]
        ang = {"Asc": float(ascmc[0]), "MC": float(ascmc[1])}
        return cc, ang
    except Exception:
        return [0.0] * 12, {"Asc": 0.0, "MC": 0.0}


def _calc_all(jd: float):
    out = {}
    flags_try = [swe.FLG_SWIEPH | swe.FLG_SPEED, swe.FLG_MOSEPH | swe.FLG_SPEED]

    for name, pid in PLANETS.items():
        last_err = None
        for flg in flags_try:
            try:
                # returns (xx, retflag)
                xx, _ = swe.calc_ut(jd, pid, flg)
                lon = float(xx[0])
                speed_lon = float(xx[3])
                out[name] = {
                    "lon": lon,
                    "retro": bool(speed_lon < 0),
                    "speed_lon": speed_lon,
                }
                last_err = None
                break
            except Exception as e:
                last_err = e
        if last_err is not None:
            # Keep stable: still return something, but mark missing
            out[name] = {"lon": 0.0, "retro": False, "error": str(last_err)}
    return out


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/astro/transits")
def astro_transits(req: TransitReq, x_mc_key: str | None = Header(default=None)):
    if MC_API_KEY:
        if not x_mc_key or x_mc_key.strip() != MC_API_KEY:
            raise HTTPException(status_code=401, detail="bad key")

    now = _parse_now(req.now_iso)
    jd = _jd_ut(now)
    planets = _calc_all(jd)
    return {
        "ok": True,
        "engine": "swiss_ephemeris",
        "now_utc": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "jd_ut": jd,
        "planets": {k: {"lon": v["lon"], "retro": v.get("retro", False)} for k, v in planets.items()},
        # Optional extra debug, safe to ignore in client
        "_debug": {k: {"speed_lon": v.get("speed_lon", 0.0)} for k, v in planets.items()},
    }


def _money_whisper(phase_name: str, moon_house: Optional[int]) -> str:
    # Not financial advice. It is a reflective prompt.
    tag = "(no es consejo financiero)"
    house_bit = ""
    if moon_house in (2, 8):
        house_bit = " Dinero/deuda están sensibles; evita decisiones por emoción."
    elif moon_house == 4:
        house_bit = " Enfoque hogar: compras del hogar con lista, sin impulso."
    elif moon_house == 10:
        house_bit = " Enfoque carrera: prioriza lo que te da estabilidad."

    if phase_name == "Luna nueva":
        return f"Luna nueva: siembra orden. Hoy conviene planear, presupuestar y escribir 1 regla simple de gasto. {tag}{house_bit}"
    if phase_name == "Cuarto creciente":
        return f"Cuarto creciente: acción con estructura. Compra solo lo que ya decidiste antes, no por impulso. {tag}{house_bit}"
    if phase_name == "Luna llena":
        return f"Luna llena: emociones arriba. Pausa 24h antes de compras grandes; revisa deudas con calma. {tag}{house_bit}"
    if phase_name == "Cuarto menguante":
        return f"Cuarto menguante: recorta y depura. Buen día para cancelar algo, revisar suscripciones o ajustar hábitos. {tag}{house_bit}"
    if phase_name == "Gibosa creciente":
        return f"Gibosa creciente: afina el plan. Revisa precios, compara y evita el “ya que estoy”. {tag}{house_bit}"
    if phase_name == "Gibosa menguante":
        return f"Gibosa menguante: integra y ordena. Paga lo importante primero; deja lo impulsivo fuera. {tag}{house_bit}"
    if phase_name == "Creciente":
        return f"Creciente: pasos pequeños. Micro-regla: “solo 1 compra y con lista”. {tag}{house_bit}"
    return f"Menguante: baja el ruido. Hoy conviene evitar gastos emocionales y preparar la próxima semana. {tag}{house_bit}"


@app.post("/astro/fullpro")
def astro_fullpro(req: FullProReq, x_mc_key: str | None = Header(default=None)):
    if MC_API_KEY:
        if not x_mc_key or x_mc_key.strip() != MC_API_KEY:
            raise HTTPException(status_code=401, detail="bad key")

    now = _parse_now(req.now_iso)
    jd_now = _jd_ut(now)
    trans = _calc_all(jd_now)

    # natal (optional)
    natal_in = req.natal or None
    natal_pts: List[Tuple[str, float]] = []
    cusps: List[float] = []
    natal_angles: Dict[str, float] = {}
    has_natal = False
    natal_meta = {}

    if isinstance(natal_in, dict):
        natal_meta = natal_in.get("meta") if isinstance(natal_in.get("meta"), dict) else {}
        b_local = _parse_birth_local(natal_in)
        tz_off_min = _parse_tz_offset_min(natal_in)
        lat, lon = _extract_latlon(natal_in)
        if b_local and lat is not None and lon is not None:
            has_natal = True
            # Convert local naive datetime to UTC using tz offset minutes
            b_utc = b_local.replace(tzinfo=timezone.utc)  # temp
            # shift: local = utc + offset => utc = local - offset
            from datetime import timedelta
            b_utc = datetime(b_local.year, b_local.month, b_local.day, b_local.hour, b_local.minute, b_local.second, b_local.microsecond, tzinfo=timezone.utc) - timedelta(minutes=tz_off_min)
            jd_birth = _jd_ut(b_utc)
            natal_calc = _calc_all(jd_birth)
            cusps, natal_angles = _calc_houses(jd_birth, float(lat), float(lon))
            for k, v in natal_calc.items():
                natal_pts.append((k, float(v["lon"])))
            natal_pts.append(("Asc", float(natal_angles.get("Asc", 0.0))))
            natal_pts.append(("MC", float(natal_angles.get("MC", 0.0))))

    # Build derived transit fields
    sun_lon = float(trans["Sun"]["lon"]) if "Sun" in trans else 0.0
    moon_lon = float(trans["Moon"]["lon"]) if "Moon" in trans else 0.0
    phase = _phase_from_sun_moon(sun_lon, moon_lon)

    # Houses for key transit bodies
    moon_house = _house_for_lon(moon_lon, cusps) if has_natal else None
    sun_house = _house_for_lon(sun_lon, cusps) if has_natal else None

    # Aspects + applying/separating
    events: List[Dict[str, Any]] = []
    headline = None
    # future sample
    jd_future = jd_now + (6.0 / 24.0)
    trans_future = _calc_all(jd_future)

    if has_natal:
        for tp, tv in trans.items():
            t_lon = float(tv["lon"])
            for nk, n_lon in natal_pts:
                hit = _aspect_hit(tp, t_lon, float(n_lon))
                if not hit:
                    continue
                # applying?
                t2_lon = float(trans_future.get(tp, {}).get("lon", t_lon))
                hit2 = _aspect_hit(tp, t2_lon, float(n_lon))
                orb2 = float(hit2["orb"]) if hit2 else float(hit["orb"]) + 9.9
                applying = orb2 < float(hit["orb"])
                events.append({
                    "tp": tp,
                    "natal": nk,
                    "aspect": hit["aspect"],
                    "aspect_deg": hit["aspect_deg"],
                    "orb": hit["orb"],
                    "applying": applying,
                    "retro": bool(tv.get("retro", False)),
                })

        events.sort(key=lambda e: (float(e.get("orb", 99.0)), _priority(str(e.get("tp")))))
        events = events[:16]
        headline = events[0] if events else None

    top_bits = [f"{phase['phase_name']} • Luna en {_sign_name(moon_lon)}", f"Sol en {_sign_name(sun_lon)}"]
    if has_natal:
        if moon_house:
            top_bits.append(f"Luna por Casa {moon_house}")
        if sun_house:
            top_bits.append(f"Sol por Casa {sun_house}")
    if headline:
        ap = "aplicando" if headline.get("applying") else "separando"
        top_bits.append(f"{headline['tp']} {headline['aspect'].lower()} {headline['natal']} (orb {headline['orb']}°, {ap})")
    top_line = " • ".join(top_bits)

    hint = None
    if headline:
        tp = headline["tp"]
        asp = headline["aspect"]
        nat = headline["natal"]
        ap = "entra" if headline.get("applying") else "ya pasó el pico"
        if asp == "Cuadratura":
            hint = f"{tp} en cuadratura a {nat}: tensión útil. No reacciones en automático (el aspecto {ap})."
        elif asp == "Oposición":
            hint = f"{tp} en oposición a {nat}: espejo. Negocia contigo antes de discutir (el aspecto {ap})."
        elif asp == "Conjunción":
            hint = f"{tp} en conjunción a {nat}: foco alto. Canaliza en 1 cosa y evita dispersarte (el aspecto {ap})."
        elif asp == "Trígono":
            hint = f"{tp} en trígono a {nat}: facilidad. Avanza lo importante con calma (el aspecto {ap})."
        elif asp == "Sextil":
            hint = f"{tp} en sextil a {nat}: oportunidad pequeña. Si actúas, abre camino (el aspecto {ap})."

    money = _money_whisper(str(phase["phase_name"]), moon_house)

    return {
        "ok": True,
        "engine": "swiss_ephemeris_fullpro",
        "now_utc": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "jd_ut": jd_now,
        "phase": phase,
        "signs": {"Sun": _sign_name(sun_lon), "Moon": _sign_name(moon_lon)},
        "houses": {"moon_house": moon_house, "sun_house": sun_house} if has_natal else {"moon_house": None, "sun_house": None},
        "events": events,
        "headline": headline,
        "top": top_line,
        "hint": hint,
        "money_whisper": money,
        "planets": {k: {"lon": float(v["lon"]), "retro": bool(v.get("retro", False))} for k, v in trans.items()},
        "natal_used": has_natal,
    }

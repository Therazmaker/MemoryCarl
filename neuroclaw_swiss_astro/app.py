import os
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

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

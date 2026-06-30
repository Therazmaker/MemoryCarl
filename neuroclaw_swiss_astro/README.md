# NeuroClaw Swiss Astro (Backend)

Este backend agrega un endpoint **/astro/transits** que usa **Swiss Ephemeris (pyswisseph)** para calcular tránsitos actuales.

## Qué hace

- Calcula longitudes eclípticas (tropical) para: **Sol, Luna, Mercurio, Venus, Marte, Júpiter, Saturno, Urano, Neptuno, Plutón**.
- Devuelve `retro: true/false` usando la velocidad longitudinal.
- Diseñado para que tu **MemoryCarl (front-end)** consuma esto y genere **casas + aspectos + aviso de Bubble**.

## Deploy rápido (Cloud Run)

1) Entra a esta carpeta y deploy con tu flow habitual.
2) Variables:
   - `MC_API_KEY`: el mismo key que ya usas en NeuroClaw (header `x-mc-key`).
   - `SWISSEPH_PATH` (opcional): ruta a ephemeris `.se1` si las tienes. Si no, usa MOSEPH fallback.

## Probar local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8080
```

### Test

```bash
curl -s -X POST http://127.0.0.1:8080/astro/transits \
  -H 'content-type: application/json' \
  -H 'x-mc-key: TU_KEY' \
  -d '{"now_iso":"2026-02-22T05:00:00Z"}' | jq
```

Si responde `ok:true`, ya está.

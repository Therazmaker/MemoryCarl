# PreMatch Story Engine v2

## Fuentes reales que usa

- **Match core**: selección activa del modo `versus` (home/away/liga/fecha).
- **Tabla/contexto de liga**: se deriva desde `db.tracker` filtrado por liga.
- **Forma**: últimos partidos por equipo desde `db.tracker`.
- **Local/visitante**: split de rendimiento (PPG) desde `db.tracker`.
- **H2H**: últimos cruces directos home vs away desde `db.tracker`.
- **Readiness/MRE**: `computeMatchReadinessEngine` (misma fuente ya existente: `brainV2.memories` con fallback a tracker).
- **Señales brain/MNE**: tags en `row.summary.reasons` guardados en memorias Brain v2.
- **Jugadores clave**: `db.players` por rating.
- **Mercado/cuotas**: probabilidades limpias `clean1x2Probs` cuando el usuario ingresa cuotas.

## Flujo por capas

1. **Data collection**: `collectPrematchData`.
2. **Insight extraction**: `buildPrematchInsights`.
3. **Editorial angle**: `buildEditorialAngle`.
4. **Editorial composer**: `composePrematchEditorial`.

La UI dispara este flujo y renderiza texto + (opcional) JSON de debug.

## Detección de ángulo

Reglas actuales (conservadoras):

- `favorite_but_not_free` si mercado/readiness favorecen al local pero la forma reciente favorece al rival.
- `stronger_side_with_schedule_risk` cuando hay gap de favorito + varias contradicciones.
- `balanced_fixture_despite_market_gap` cuando forma/readiness están parejos.
- `dominant_home_side_vs_resurgent_visitor` cuando la forma del visitante aprieta el relato.

Si faltan datos, cae en `context_driven_match`.

## Política de faltantes

- Sin H2H -> sección omitida.
- Sin cuotas -> sección de mercado omitida.
- Sin señales MNE -> sección brain reducida u omitida.
- Sin ausencias reales -> no se inventan bajas.

## Extensión

Para nuevas reglas:

- Añadir campos a `buildPrematchInsights`.
- Añadir detección en `buildEditorialAngle`.
- Añadir bloque opcional en `composePrematchSections`.

Mantener siempre la regla de **no inventar datos**.

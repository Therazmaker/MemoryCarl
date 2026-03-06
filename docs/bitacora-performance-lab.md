# Bitácora Performance Lab

La pestaña **Bitácora** ahora extiende el historial existente con un bloque de medición de rendimiento.

## Métricas

- **CLV (Closing Line Value)**: se calcula por pick cuando existe `closingOdds`.
  - `impliedTaken = 1 / odds`
  - `impliedClose = 1 / closingOdds`
  - `clvDelta = impliedClose - impliedTaken` (positivo = mejor precio tomado).
- **ROI**: `profitTotal / stakeTotal`.
- **EV acumulado**: suma de `evValue * stake` solo para picks con EV disponible.
- **Win rate**: `wins / picks`.
- **Equity vs EV**: series acumuladas de profit real y EV acumulado.
- **Rolling ROI**: ROI sobre ventana móvil (20 picks por defecto).

## Compatibilidad hacia atrás

- Picks viejos sin `closingOdds` se mantienen y su CLV se omite.
- Picks viejos sin `evValue` se mantienen y el EV acumulado ignora esos picks.
- Si faltan `league`, `tag`, `confidence`, se usan valores por defecto conservadores.

## Breakdowns

La Bitácora muestra breakdown compacto por:

- Tipo de pick.
- Rango de cuota.
- Liga.
- Etiqueta.
- (Internamente también queda preparado por confianza.)

Cada breakdown incluye picks, win rate, ROI y CLV (si aplica).

## Insights automáticos

Reglas determinísticas simples, por ejemplo:

- CLV positivo + ROI negativo (señal de varianza).
- Mejor tipo / tag / rango de cuota por ROI con mínimo de muestra.
- Tendencia reciente del ROI rolling.

## Extensión futura

Para ampliar:

1. Agregar nuevos grupos en `buildPerformanceBreakdowns`.
2. Añadir reglas nuevas en `buildPerformanceInsights`.
3. Incluir nuevos campos opcionales en `normalizePickRecord` manteniendo defaults.

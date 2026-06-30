# Form Surprise Index (FSI)

El FSI agrega una capa simple y explicable para responder:

- ¿Un equipo está rindiendo **dentro de su nivel normal**?
- ¿Está **por encima** de su identidad estructural?
- ¿Está **por debajo** de lo esperado?

## Fuentes usadas

1. **Base estructural temporada** (manual en perfil del equipo):
   - PJ, G, E, P, GF, GC, DG, PTS (opcional posición).
2. **Forma reciente real** (últimos N partidos de `brainV2.memories`, por defecto N=5).

## Métricas comparadas

- Base temporada:
  - PPG (`pts/pj`)
  - GF por partido
  - GC por partido
  - DG por partido
- Forma reciente:
  - PPG últimos N
  - GF por partido últimos N
  - GC por partido últimos N
  - DG por partido últimos N

## Cálculo del índice

El índice combina deltas recientes vs base:

- `ΔPPG` (peso principal)
- `ΔGF/partido`
- mejora defensiva `baseGC - recentGC`
- `ΔDG/partido`

Resultado final: `FSI` en rango `[-100, 100]`.

## Etiquetas

- `strongly_above_expectation`
- `above_expectation`
- `normal`
- `below_expectation`
- `strongly_below_expectation`

## Fallbacks

- Si no hay base manual: **Base de temporada no disponible**.
- Si no hay suficientes partidos recientes con marcador: **Forma reciente insuficiente**.
- El sistema anterior sigue funcionando sin cambios; FSI es una capa adicional.

## Por qué ayuda

Permite detectar casos donde dos equipos llegan “fuertes”, pero uno lo hace en nivel esperado y otro muy por encima de su base histórica de temporada.
Eso mejora la lectura de “equipo más peligroso ahora mismo” sin usar ML.

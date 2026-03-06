# MATCH READINESS CARD · Fuente de datos y fallback

## Fuente principal
- El MATCH READINESS CARD ahora consume partidos desde `brainV2.memories` (persistidos por `b2SaveMatch` y por import/autofill de `footballlab_matchpack_v1`).
- Solo si no hay filas utilizables en `brainV2.memories`, usa fallback conservador a `db.tracker`.

## Resolución de equipo
- Se normaliza identidad con:
  - lowercase
  - sin acentos
  - espacios compactos
- Se resuelven alias cortos conocidos (ej.: `PSG` ⇄ `Paris SG` ⇄ `Paris Saint-Germain`, `Monaco` ⇄ `AS Monaco`).

## Filtro por liga
- Si hay `leagueId`, se intenta filtrar por liga.
- Si ese filtro deja 0 pero existen partidos del equipo en memoria, se cae a `all competitions (fallback)` y se muestra en UI.

## Cuándo aparece `SIN_DATOS`
- Solo cuando no existen partidos válidos ni en `brainV2.memories` ni en fallback `db.tracker`.
- La UI muestra evidencia explícita de muestras, fuente, filtro y si hubo fallback.

## “Juegos en memoria”
- Son filas válidas de partidos del equipo dentro de `brainV2.memories`, tras resolver identidad (teamId y/o alias de nombre).

## Índice por equipo en `teamProfiles`
- `brainV2.memories` sigue siendo la **fuente principal** del partido completo.
- `brainV2.teamProfiles` actúa como índice liviano por equipo con `matchRefs` (referencias + metadatos mínimos).
- Cada `matchRef` guarda solo: `memoryId`, `teamId`, `teamName`, `date`, `opponent`, `score`.
- No se duplican `statsRaw`, `narrative`, ni payloads extensos.

## Sincronización automática
- Al guardar desde `b2SaveMatch`, el partido se persiste en `brainV2.memories` como antes.
- En el mismo flujo se indexa automáticamente en `brainV2.teamProfiles` para el equipo principal.
- Cuando hay rival identificable (`opponent`), también se indexa para ese rival por nombre normalizado/alias.

## Reconstrucción del histórico
- En `loadBrainV2` / `saveBrainV2` se normaliza estado de `teamProfiles`.
- Si hay memorias históricas y faltan referencias, se reconstruye el índice defensivamente.
- También existe reconstrucción explícita al borrar/editar partidos para mantener coherencia del índice.

## Consulta rápida por equipo
- Helpers disponibles:
  - `getTeamMatchRefs(...)` para listar referencias de un equipo (con alias).
  - `resolveTeamMatchesFromRefs(...)` para resolver esas referencias al partido real en `brainV2.memories`.

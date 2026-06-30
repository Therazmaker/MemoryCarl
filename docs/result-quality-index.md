# Result Quality Index (RQI)

El **RQI** evalúa la calidad real de la racha reciente (N partidos, default `N=5`) para distinguir entre:

- rachas **sólidas y convincentes**
- rachas **frágiles o engañosas**

> No predice resultados futuros. Solo mide qué tan sustentables parecen los resultados recientes según rendimiento y señales de partido.

## Qué mide

RQI combina 5 subscores (0–100):

1. **Result Strength (25%)**
   - puntos por partido recientes
   - diferencia de gol promedio reciente

2. **Dominance (25%)**
   - diferencial de xG (si existe)
   - diferencial de tiros / tiros a puerta (si existe)
   - posesión, corners, señales narrativas de control (si existen)

3. **Fragility / Stress (20%)**
   - goles encajados
   - xG concedido, tiros recibidos (si existen)
   - partidos de margen corto
   - señales narrativas/MNE de caos o sufrimiento

4. **Efficiency Alert (15%)**
   - alerta cuando los resultados parecen por encima del volumen real
   - sobreconversión (goles vs xG) si hay xG
   - puntos altos con poco volumen de tiro
   - exceso de victorias mínimas

5. **Control / Conviction (15%)**
   - autoridad en posesión/territorio
   - producción ofensiva útil
   - señales narrativas de control vs caos

## Clasificación final

RQI final (0–100):

- `<35`: `very_fragile` / **muy frágil**
- `35–46`: `fragile` / **frágil**
- `47–59`: `neutral` / **neutro**
- `60–74`: `solid` / **sólido**
- `>=75`: `very_solid` / **muy sólido**

## Lectura e interpretación

El bloque incluye:

- score final por equipo
- subscores por dimensión
- resumen automático
- flags explicables, por ejemplo:
  - “suma puntos por encima de su dominio real”
  - “victorias de margen corto o contexto de alto sufrimiento”
  - “eficiencia por encima del volumen generado”
  - “racha respaldada por dominio y control del guion”

## Fallbacks y datos parciales

Si faltan datos (xG, posesión, MNE):

- RQI usa lo disponible (goles, score, tiros, narrativa)
- evita inventar campos
- agrega limitaciones explícitas en `interpretation.limitations`

Esto permite mantener el sistema estable sin romper el flujo existente.

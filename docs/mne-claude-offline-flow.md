# MNE ↔ Claude (offline/manual) flujo

Este proyecto soporta un flujo opcional para aprender offline sin API:

1. En la vista del MNE, usar **Export for Claude**.
2. Se descarga un JSON `mne-claude-export-*.json` con:
   - metadata del match,
   - segmentos narrativos,
   - riesgos/triggers,
   - interpretación MNE,
   - contexto de memoria compacta.
3. Subir ese archivo manualmente a Claude (fuera de la app).
4. Pegar o cargar en la UI el JSON de respuesta de Claude con **Import Claude Feedback** o **Import from text**.
5. El import valida el schema y guarda el aprendizaje en memoria persistente (`FL_BRAIN_V2` → `mne.claudeExchange`).

## Schema esperado (feedback)

- `schemaVersion`: `mne_claude_feedback_v1` (obligatorio)
- `matchRef`: objeto (obligatorio)
- `evaluation`, `missedSignals`, `patternInsights`, `newRules`, `weightSuggestions`, `trainingNotes`, `confidenceNotes`, `reusableHeuristics`: opcionales pero recomendados.

Si faltan campos opcionales, el sistema rellena defaults.
Si el schema o JSON son inválidos, se muestra un error legible y no se modifica el estado.

## Compatibilidad

- Es una capa adicional opcional.
- Si no se usa import/export de Claude, el MNE sigue con su flujo normal.

/**
 * graphRepairEngine.js — Reparador de Grafo Cognitivo impulsado por Claude API
 * MemoryCarl / NeuroChat
 */

import { getAllNeurons, saveNeuron, updateNeuron, deleteNeuronSafely, reindexConnections } from "./neuronStore.js";
import { getClaudeSettings, isClaudeConfigured } from "../services/claudeClient.js";
import { sanitizeNeuron, validateNeuron } from "./schemas.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Parsea e intenta reparar respuestas JSON de LLMs que tengan comas finales
 * o estén truncadas por límite de tokens.
 */
export function safeParseJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Respuesta vacía o no válida.");
  }

  let cleaned = text.trim();

  // Quitar bloques de código Markdown ```json ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Ubicar delimitadores de JSON principal
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else {
      cleaned = cleaned.substring(firstBrace);
    }
  }

  const removeTrailingCommas = (str) => str.replace(/,\s*([\}\]])/g, "$1");

  // Intento 1: Parseo directo limpiando comas sobrantes
  try {
    return JSON.parse(removeTrailingCommas(cleaned));
  } catch (err1) {
    // Intento 2: Reparación de JSON truncado por límite de tokens
    const repaired = repairTruncatedJSON(removeTrailingCommas(cleaned));
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (_) {}
    }
    throw new Error(`Error parseando respuesta JSON de Claude: ${err1.message}`);
  }
}

/**
 * Reconstruye estructuras JSON truncadas intentando cerrar comillas, llaves y corchetes pendientes.
 */
function repairTruncatedJSON(jsonStr) {
  let str = jsonStr.trim();

  // Cerrar comilla si quedó a mitad de un string
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = char === "\\" && !escaped;
  }
  if (inString) {
    str += '"';
  }

  // Eliminar coma o propiedad incompleta al final
  str = str.replace(/,\s*$/, "");
  str = str.replace(/,\s*"[^"]*"?\s*:?\s*$/, "");

  // Balancear llaves y corchetes
  const stack = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = char === "\\" && !escaped;

    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" && stack[stack.length - 1] === "{") {
        stack.pop();
      } else if (char === "]" && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === "{") str += "}";
    if (last === "[") str += "]";
  }

  return str;
}

/**
 * Ejecuta una reparación profunda del grafo neuronal utilizando Claude API.
 *
 * @param {object} options
 * @param {function} [options.onProgress] Callback para informar sobre el estado del proceso
 * @returns {Promise<{ ok: boolean, summary?: string, deletedCount?: number, mergedCount?: number, updatedCount?: number, connectionsCreatedCount?: number, error?: string }>}
 */
export async function repairGraphWithClaude(options = {}) {
  const { onProgress = () => {} } = options;

  onProgress("Validando configuración de Claude API...");
  if (!isClaudeConfigured()) {
    return { ok: false, error: "Claude API Key no está configurada o es inválida en los ajustes." };
  }

  const settings = getClaudeSettings();
  onProgress("Cargando neuronas del grafo actual...");
  const allNeurons = getAllNeurons({ includeDeleted: false });

  if (allNeurons.length === 0) {
    return { ok: true, summary: "No hay neuronas activas en el grafo para analizar.", deletedCount: 0, mergedCount: 0, updatedCount: 0, connectionsCreatedCount: 0 };
  }

  // Pre-limpieza local de neuronas vacías
  let localEmptyPruned = 0;
  for (const n of allNeurons) {
    if (!n.core?.concept || !n.core.concept.trim()) {
      deleteNeuronSafely(n.id, { hard: true });
      localEmptyPruned++;
    }
  }

  const remainingNeurons = getAllNeurons({ includeDeleted: false });
  if (remainingNeurons.length === 0) {
    return { ok: true, summary: `Se eliminaron ${localEmptyPruned} neuronas vacías localmente. El grafo quedó sin neuronas.`, deletedCount: localEmptyPruned, mergedCount: 0, updatedCount: 0, connectionsCreatedCount: 0 };
  }

  onProgress(`Formateando ${remainingNeurons.length} neuronas para enviar a Claude...`);

  const formattedNeurons = remainingNeurons.map((n) => ({
    id: n.id,
    type: n.type,
    concept: n.core?.concept || "",
    domain: n.core?.domain || "general",
    summary: n.core?.summary || "",
    triggers: (n.triggers || []).slice(0, 10),
    connections: n.connections || [],
  }));

  const systemPrompt = `Eres un Ingeniero Cognitivo de Grafos especializado en depurar, estructurar y enriquecer redes neuronales de memoria personal.

Analiza las neuronas del usuario y realiza 3 operaciones fundamentales:
1. **ELIMINAR (\`deletions\`)**: Identifica neuronas vacías, corruptas, duplicadas inservibles o sin concepto real.
2. **FUSIONAR (\`merges\`)**: Identifica neuronas que hablen de la MISMA persona, concepto, entidad o lugar (ej. "Frederick" e "Hijo Frederick", o "Fergis" y "Esposa Fergis"). Consolida en \`targetId\` y marca \`sourceId\` para fusión.
3. **ACTUALIZAR Y CONECTAR (\`updates\`)**:
   - Enriquece resúmenes o conceptos usando el contexto cruzado entre neuronas (ej. si una neurona dice que Alicia es amiga de Fergis y otra menciona a Fergis, vincula esas personas).
   - Añade conexiones explícitas e inteligibles (\`addConnections\`) entre neuronas relacionadas semántica o afectivamente (padre-hijo, esposos, amigos, hábitos-proyectos).
   - Añade triggers clave faltantes (\`addTriggers\`).

REGLAS CRÍTICAS:
- Sé riguroso y mantén intacta la información real del usuario.
- Devuelve EXCLUSIVAMENTE un objeto JSON válido según el siguiente esquema (sin Markdown extra):

{
  "summary": "Breve explicación en español de los hallazgos y correcciones aplicadas",
  "deletions": ["id1", "id2"],
  "merges": [
    {
      "sourceId": "id_duplicado",
      "targetId": "id_canónico",
      "mergedTriggers": ["trigger1", "trigger2"],
      "updatedSummary": "Resumen unificado opcional"
    }
  ],
  "updates": [
    {
      "id": "id_neurona",
      "changes": {
        "core.concept": "Concepto mejorado si aplica",
        "core.summary": "Resumen clarificado con contexto real"
      },
      "addTriggers": ["trigger_nuevo"],
      "addConnections": ["id_otra_neurona_relacionada"]
    }
  ]
}`;

  const requestBody = {
    model: settings.model || "claude-haiku-4-5",
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Lista de neuronas (${remainingNeurons.length}):\n${JSON.stringify(formattedNeurons)}\n\nDevuelve únicamente el JSON con deletions, merges y updates.`,
      },
    ],
  };

  onProgress("Analizando grafo con Claude AI...");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (_) {}
      return { ok: false, error: `Error en respuesta de Claude API: ${errMsg}` };
    }

    const data = await res.json();
    const fullText = data?.content?.[0]?.text;

    if (!fullText) {
      return { ok: false, error: "Claude devolvió una respuesta vacía." };
    }

    onProgress("Parseando plan de reparación de Claude...");
    const repairPlan = safeParseJSON(fullText);

    onProgress("Aplicando correcciones en el almacenamiento local...");

    let deletedCount = localEmptyPruned;
    let mergedCount = 0;
    let updatedCount = 0;
    let connectionsCreatedCount = 0;

    // 1. Aplicar eliminaciones
    if (Array.isArray(repairPlan.deletions)) {
      for (const id of repairPlan.deletions) {
        if (typeof id === "string" && id) {
          const removed = deleteNeuronSafely(id, { hard: true });
          if (removed.ok) deletedCount++;
        }
      }
    }

    // 2. Aplicar fusiones (merges)
    if (Array.isArray(repairPlan.merges)) {
      const currentNeurons = getAllNeurons({ includeDeleted: false });
      for (const merge of repairPlan.merges) {
        const { sourceId, targetId, mergedTriggers = [], updatedSummary } = merge;
        if (!sourceId || !targetId || sourceId === targetId) continue;

        const source = currentNeurons.find((n) => n.id === sourceId);
        const target = currentNeurons.find((n) => n.id === targetId);

        if (target) {
          const newTriggers = [...new Set([...(target.triggers || []), ...(source?.triggers || []), ...mergedTriggers])];
          const newConnections = [...new Set([...(target.connections || []), ...(source?.connections || []).filter((c) => c !== targetId)])];

          const patch = {
            triggers: newTriggers,
            connections: newConnections,
          };

          if (updatedSummary) {
            patch.core = { ...(target.core || {}), summary: updatedSummary };
          }

          updateNeuron(targetId, patch);
          deleteNeuronSafely(sourceId, { hard: true });
          mergedCount++;
        }
      }
    }

    // 3. Aplicar actualizaciones y conexiones
    if (Array.isArray(repairPlan.updates)) {
      for (const update of repairPlan.updates) {
        const { id, changes = {}, addTriggers = [], addConnections = [] } = update;
        if (!id) continue;

        const existing = remainingNeurons.find((n) => n.id === id);
        if (!existing) continue;

        const patchedConcept = changes["core.concept"] || existing.core?.concept;
        const patchedSummary = changes["core.summary"] || existing.core?.summary;
        const patchedDomain = changes["core.domain"] || existing.core?.domain;

        const newTriggers = [...new Set([...(existing.triggers || []), ...addTriggers])];
        const newConnections = [...new Set([...(existing.connections || []), ...addConnections.filter((c) => c !== id)])];

        if (addConnections.length > 0) {
          connectionsCreatedCount += addConnections.length;
        }

        const patch = {
          core: {
            concept: patchedConcept,
            summary: patchedSummary,
            domain: patchedDomain,
          },
          triggers: newTriggers,
          connections: newConnections,
        };

        const result = updateNeuron(id, patch);
        if (result) updatedCount++;
      }
    }

    onProgress("Reindexando conexiones y sincronizando...");
    reindexConnections();

    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase();
    }

    return {
      ok: true,
      summary: repairPlan.summary || "Grafo reparado exitosamente con Claude.",
      deletedCount,
      mergedCount,
      updatedCount,
      connectionsCreatedCount,
    };
  } catch (err) {
    clearTimeout(timer);
    console.error("[graphRepairEngine] Error durante la reparación:", err);
    return { ok: false, error: err.message || "Ocurrió un error inesperado procesando la reparación." };
  }
}

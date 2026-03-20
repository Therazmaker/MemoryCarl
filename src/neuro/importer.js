/**
 * importer.js — Importación segura de neuronas en formato JSON
 * NeuroChat / MemoryCarl
 *
 * Exporta:
 *   parseNeuronJsonInput(raw)
 *   normalizeImportedNeuronPayload(payload)
 *   previewNeuronImport(payload)
 *   importNeuronJson(payload, options?)
 *   getNeuronSchemaTemplate()
 *   getNeuronPromptTemplate()
 *   copyNeuronSchemaAndPrompt()
 */

import { sanitizeNeuron, validateNeuron, NEURON_TYPES, MANUAL_CATEGORIES, EMOTION_VALUES } from "./schemas.js";
import { saveNeuron, getAllNeurons, getNeuronById } from "./neuronStore.js";

// ---- Parseo robusto ----

/**
 * Extrae JSON de una cadena cruda que puede contener markdown fences,
 * texto extra antes/después, wrappers { neurons: [...] }, etc.
 * @param {string} raw
 * @returns {{ parsed: any, error: string|null }}
 */
export function parseNeuronJsonInput(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { parsed: null, error: "Entrada vacía" };
  }

  // 1. Quitar markdown fences: ```json ... ``` o ``` ... ```
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // 2. Intentar parsear directo
  try {
    const parsed = JSON.parse(cleaned);
    return { parsed, error: null };
  } catch (_e) {
    // continue
  }

  // 3. Buscar primer bloque JSON válido (objeto o array) en el texto
  const jsonObjectMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonObjectMatch) {
    try {
      const parsed = JSON.parse(jsonObjectMatch[1]);
      return { parsed, error: null };
    } catch (_e) {
      // continue
    }
  }

  return { parsed: null, error: "JSON inválido: no se pudo extraer un objeto o array válido" };
}

/**
 * Normaliza el payload crudo a un array de objetos neurona.
 * Acepta: objeto único, array, { neurons: [...] }
 * @param {any} parsed
 * @returns {{ neurons: any[], error: string|null }}
 */
export function normalizeImportedNeuronPayload(parsed) {
  if (parsed == null) {
    return { neurons: [], error: "Payload nulo" };
  }

  // Wrapper { neurons: [...] }
  if (typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.neurons)) {
    return { neurons: parsed.neurons, error: null };
  }

  // Array directo
  if (Array.isArray(parsed)) {
    return { neurons: parsed, error: null };
  }

  // Neurona única (objeto)
  if (typeof parsed === "object") {
    return { neurons: [parsed], error: null };
  }

  return { neurons: [], error: "Formato no reconocido: se esperaba objeto, array o { neurons: [...] }" };
}

/**
 * Resultado de preview por neurona candidata.
 * @typedef {{ status: "valid"|"fixable"|"rejected", neuron?: any, errors: string[], raw: any }} NeuronPreviewItem
 */

/**
 * Evalúa un array de objetos raw y los clasifica en: válidas, corregibles, rechazadas.
 * También detecta posibles duplicados.
 * @param {any[]} rawNeurons
 * @returns {{ valid: NeuronPreviewItem[], fixable: NeuronPreviewItem[], rejected: NeuronPreviewItem[] }}
 */
export function previewNeuronImport(rawNeurons) {
  if (!Array.isArray(rawNeurons)) {
    return { valid: [], fixable: [], rejected: [] };
  }

  const existing = getAllNeurons();
  const existingConcepts = new Set(existing.map((n) => String(n.core?.concept || "").toLowerCase().trim()));

  const valid = [];
  const fixable = [];
  const rejected = [];

  for (const raw of rawNeurons) {
    if (!raw || typeof raw !== "object") {
      rejected.push({ status: "rejected", errors: ["No es un objeto"], raw });
      continue;
    }

    const sanitized = sanitizeNeuron(raw);
    if (!sanitized) {
      rejected.push({ status: "rejected", errors: ["No se pudo sanitizar"], raw });
      continue;
    }

    const errors = validateNeuron(sanitized);
    const warnings = [];

    // Detectar duplicado probable
    const concept = String(sanitized.core?.concept || "").toLowerCase().trim();
    if (concept && existingConcepts.has(concept)) {
      warnings.push(`Duplicado probable: neurona con concepto "${sanitized.core.concept}" ya existe`);
    }

    if (errors.length === 0) {
      valid.push({ status: "valid", neuron: sanitized, errors: warnings, raw });
    } else if (_isFixable(errors)) {
      fixable.push({ status: "fixable", neuron: sanitized, errors: [...errors, ...warnings], raw });
    } else {
      rejected.push({ status: "rejected", neuron: sanitized, errors: [...errors, ...warnings], raw });
    }
  }

  return { valid, fixable, rejected };
}

/** Determina si los errores de validación son corregibles automáticamente */
function _isFixable(errors) {
  if (!errors.length) return false;
  const hardErrors = errors.filter((e) =>
    e.includes("type inválido") ||
    e.includes("core faltante") ||
    e.includes("id inválido") ||
    e.includes("neurona no es un objeto")
  );
  // Fixable if there are errors but none are hard/unrecoverable
  return hardErrors.length === 0;
}

/**
 * Importa neuronas JSON con manejo de duplicados.
 * @param {any[]} rawNeurons - array ya normalizado de raw neurons
 * @param {{ duplicateStrategy?: "new"|"merge"|"discard", skipInvalid?: boolean }} [options]
 * @returns {{ imported: number, merged: number, discarded: number, errors: string[] }}
 */
export function importNeuronJson(rawNeurons, options = {}) {
  const { duplicateStrategy = "discard", skipInvalid = true } = options;

  if (!Array.isArray(rawNeurons)) {
    return { imported: 0, merged: 0, discarded: 0, errors: ["Entrada no es un array"] };
  }

  const existing = getAllNeurons();
  const existingByConceptLower = new Map(
    existing.map((n) => [String(n.core?.concept || "").toLowerCase().trim(), n])
  );
  const existingById = new Map(existing.map((n) => [n.id, n]));

  let imported = 0;
  let merged = 0;
  let discarded = 0;
  const errors = [];

  for (const raw of rawNeurons) {
    const sanitized = sanitizeNeuron(raw);
    if (!sanitized) {
      if (!skipInvalid) errors.push(`No se pudo sanitizar: ${JSON.stringify(raw).slice(0, 80)}`);
      discarded++;
      continue;
    }

    const validationErrors = validateNeuron(sanitized);
    if (validationErrors.length > 0 && !skipInvalid) {
      errors.push(...validationErrors);
      discarded++;
      continue;
    }

    const concept = String(sanitized.core?.concept || "").toLowerCase().trim();
    const isDuplicateById = existingById.has(sanitized.id);
    const isDuplicateByConcept = concept && existingByConceptLower.has(concept);

    if (isDuplicateById || isDuplicateByConcept) {
      if (duplicateStrategy === "discard") {
        discarded++;
        continue;
      } else if (duplicateStrategy === "merge") {
        const existing_ = isDuplicateById
          ? existingById.get(sanitized.id)
          : existingByConceptLower.get(concept);

        if (existing_) {
          const mergedNeuron = sanitizeNeuron({
            ...existing_,
            core: { ...existing_.core, ...sanitized.core },
            triggers: [...new Set([...(existing_.triggers || []), ...(sanitized.triggers || [])])].slice(0, 20),
            evidence: [...new Set([...(existing_.evidence || []), ...(sanitized.evidence || [])])].slice(0, 20),
            meta: sanitized.meta ? { ...(existing_.meta || {}), ...sanitized.meta } : existing_.meta,
            updatedAt: new Date().toISOString(),
          });
          if (mergedNeuron) {
            saveNeuron(mergedNeuron);
            merged++;
          }
        }
        continue;
      }
      // strategy === "new": assign new ID and continue
      sanitized.id = `nrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const saved = saveNeuron(sanitized);
    if (saved) {
      imported++;
      existingById.set(saved.id, saved);
      existingByConceptLower.set(String(saved.core?.concept || "").toLowerCase().trim(), saved);
    } else {
      discarded++;
    }
  }

  return { imported, merged, discarded, errors };
}

// ---- Schema y Prompt para copiar ----

/**
 * Devuelve el schema mínimo esperado de una neurona para copiar al portapapeles.
 * @returns {string}
 */
export function getNeuronSchemaTemplate() {
  const schema = {
    type: `(uno de: ${NEURON_TYPES.join(" | ")})`,
    core: {
      concept: "string — nombre único del concepto",
      domain: "string — ej: work, personal, health, hobbies, relationships",
      summary: "string — descripción concisa (máx 500 chars)",
    },
    triggers: ["string — palabras clave que activan esta neurona (máx 20)"],
    emotion: `(uno de: ${EMOTION_VALUES.join(" | ")})`,
    evidence: ["string — hechos o referencias que sostienen esta neurona (máx 20)"],
    source: {
      kind: "manual",
      ref: "context_window",
    },
    meta: {
      aliases: ["string — nombres alternativos en minúsculas (máx 30)"],
      priority: "low | medium | high",
      pin: false,
      manualCategory: `(uno de: ${MANUAL_CATEGORIES.join(" | ")})`,
      notes: "string — notas internas (máx 600 chars)",
    },
  };
  return JSON.stringify(schema, null, 2);
}

/**
 * Devuelve el prompt listo para pegar en ChatGPT.
 * @returns {string}
 */
export function getNeuronPromptTemplate() {
  return `Genera una neurona compatible con mi sistema NeuroChat en JSON válido.

REGLAS:
- No uses markdown ni code fences. Solo JSON puro.
- El campo "type" debe ser uno de: ${NEURON_TYPES.join(", ")}.
- El campo "emotion" debe ser uno de: ${EMOTION_VALUES.join(", ")}.
- "meta.manualCategory" debe ser uno de: ${MANUAL_CATEGORIES.join(", ")}.
- "core.concept" debe ser único, específico y descriptivo.
- "triggers" son palabras clave en minúsculas que activan la neurona.
- "meta.aliases" son nombres alternativos en minúsculas.
- Hazla específica, útil, conectable y no redundante.
- Incluye siempre: type, core (concept, domain, summary), triggers, emotion.

SCHEMA:
${getNeuronSchemaTemplate()}

Ejemplo de neurona válida:
{
  "type": "person",
  "core": {
    "concept": "Fergis",
    "domain": "relationships",
    "summary": "Pareja de Carl, importante en su vida personal y proyectos."
  },
  "triggers": ["fergis", "mi pareja", "mi novia", "mi esposa"],
  "emotion": "love",
  "evidence": ["Mencionada frecuentemente en contexto personal"],
  "source": { "kind": "manual", "ref": "context_window" },
  "meta": {
    "aliases": ["fergis", "mi pareja"],
    "priority": "high",
    "pin": true,
    "manualCategory": "people",
    "notes": ""
  }
}`;
}

/**
 * Copia schema + prompt al portapapeles.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function copyNeuronSchemaAndPrompt() {
  const content = `=== SCHEMA DE NEURONA ===\n${getNeuronSchemaTemplate()}\n\n=== PROMPT PARA CHATGPT ===\n${getNeuronPromptTemplate()}`;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return { success: true, message: "Schema + prompt copiados al portapapeles ✓" };
    } catch (_e) {
      // fallback
    }
  }

  // Fallback: textarea + execCommand
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = content;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return { success: true, message: "Schema + prompt copiados ✓" };
    } catch (_e2) {
      return { success: false, message: "No se pudo copiar al portapapeles" };
    } finally {
      document.body.removeChild(ta);
    }
  }

  return { success: false, message: "Portapapeles no disponible" };
}

/**
 * Copia solo el schema al portapapeles.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function copyNeuronSchemaToClipboard() {
  const content = getNeuronSchemaTemplate();
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return { success: true, message: "Schema copiado ✓" };
    } catch (_e) {}
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = content;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return { success: true, message: "Schema copiado ✓" };
    } catch (_e2) {
      return { success: false, message: "No se pudo copiar al portapapeles" };
    } finally {
      document.body.removeChild(ta);
    }
  }
  return { success: false, message: "Portapapeles no disponible" };
}

/**
 * Copia solo el prompt al portapapeles.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function copyNeuronPromptToClipboard() {
  const content = getNeuronPromptTemplate();
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return { success: true, message: "Prompt copiado ✓" };
    } catch (_e) {}
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = content;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return { success: true, message: "Prompt copiado ✓" };
    } catch (_e2) {
      return { success: false, message: "No se pudo copiar al portapapeles" };
    } finally {
      document.body.removeChild(ta);
    }
  }
  return { success: false, message: "Portapapeles no disponible" };
}

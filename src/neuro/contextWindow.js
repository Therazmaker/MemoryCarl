import {
  createManualContextNeuron,
  updateManualContextNeuron,
  deleteManualContextNeuron,
  searchManualContextNeurons,
  getManualContextNeurons,
} from "./neuronStore.js";
import { linkNeurons, unlinkNeurons } from "./connections.js";

export const QUICK_CONTEXT_TEMPLATES = {
  person: {
    type: "person",
    manualCategory: "people",
    summary: "Quién es para ti y su contexto principal.",
    priority: "high",
    pin: true,
  },
  work: {
    type: "work_context",
    manualCategory: "work",
    summary: "Trabajo, rol o frente profesional recurrente.",
    priority: "medium",
    pin: false,
  },
  hobby: {
    type: "hobby",
    manualCategory: "hobbies",
    summary: "Actividad que disfrutas y repites.",
    priority: "medium",
    pin: false,
  },
  project: {
    type: "project",
    manualCategory: "projects",
    summary: "Proyecto activo o de largo plazo.",
    priority: "high",
    pin: true,
  },
  preference: {
    type: "preference",
    manualCategory: "preferences",
    summary: "Preferencia estable que influye tus decisiones.",
    priority: "medium",
    pin: false,
  },
};

function toNeuronInput(input) {
  return {
    type: input.type,
    core: {
      concept: input.concept || "",
      domain: input.domain || "general",
      summary: input.summary || "",
    },
    emotion: input.emotion || "neutral",
    triggers: Array.isArray(input.triggers) ? input.triggers : String(input.triggers || "").split(",").map((v) => v.trim()).filter(Boolean),
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    meta: {
      aliases: Array.isArray(input.aliases) ? input.aliases : String(input.aliases || "").split(",").map((v) => v.trim()).filter(Boolean),
      manualCategory: input.manualCategory,
      priority: input.priority,
      pin: Boolean(input.pin),
      notes: input.notes || "",
      colorTag: input.colorTag || "",
    },
  };
}

export async function createContextWindowNeuron(input) {
  return createManualContextNeuron(toNeuronInput(input));
}

export async function updateContextWindowNeuron(id, patch) {
  return updateManualContextNeuron(id, toNeuronInput(patch));
}

export async function duplicateContextWindowNeuron(id) {
  const source = getManualContextNeurons().find((n) => n.id === id);
  if (!source) return null;
  return createManualContextNeuron({
    ...source,
    id: undefined,
    core: {
      ...source.core,
      concept: `${source.core.concept} (copia)`,
    },
  });
}

export function deleteContextWindowNeuron(id) {
  return deleteManualContextNeuron(id);
}

export function listContextWindowNeurons(filters = {}) {
  if (filters.query || filters.category || filters.type || filters.priority || filters.pinned != null || filters.withConnections != null) {
    return searchManualContextNeurons(filters.query || "", filters);
  }
  return getManualContextNeurons();
}

export function applyQuickTemplate(templateKey, concept = "") {
  const template = QUICK_CONTEXT_TEMPLATES[templateKey];
  if (!template) return null;
  return {
    concept,
    summary: template.summary,
    type: template.type,
    manualCategory: template.manualCategory,
    priority: template.priority,
    pin: template.pin,
    aliases: "",
    emotion: "neutral",
    triggers: "",
    notes: "",
    colorTag: "",
  };
}

export function createManualLink(sourceId, targetId) {
  return linkNeurons(sourceId, targetId, { connectionSource: "manual" });
}

export function removeManualLink(sourceId, targetId) {
  return unlinkNeurons(sourceId, targetId);
}

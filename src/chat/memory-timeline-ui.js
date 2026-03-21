import { compressRelatedInsights, resolveLinkedNeuronDisplay } from "../memory/memoryStore.js";
import { getAllNeurons } from "../neuro/neuronStore.js";

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildLinkedNeuronLabels(memory = {}, neurons = getAllNeurons()) {
  return resolveLinkedNeuronDisplay(memory, neurons).map((row) => {
    if (row.missing) return `⚠️ ${row.concept}`;
    if (row.domain && row.domain !== "general") return `${row.concept} · ${row.domain}`;
    return row.concept;
  });
}

export function renderMemoryLinkedNeurons(memory = {}, neurons = getAllNeurons()) {
  const labels = buildLinkedNeuronLabels(memory, neurons);
  if (!labels.length) return "<li>Sin vínculos.</li>";
  return labels.map((label) => `<li>${esc(label)}</li>`).join("");
}

export function getDedupedRelatedInsights(memory = {}) {
  return compressRelatedInsights(memory.relatedInsights || []);
}

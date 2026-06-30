import test from "node:test";
import assert from "node:assert/strict";

import {
  detectInputType,
  extractTopics,
  classifySentence,
  groupByStructure,
  cleanPhrase,
  detectStyle,
  extractResponsePattern,
} from "../src/neuro/responsePatternExtractor.js";
import {
  savePattern,
  getAllPatterns,
  dedupePattern,
  findMatchingPatterns,
} from "../src/neuro/responsePatternsStore.js";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
}

function resetStorage() {
  localStorage.clear();
}

test("detecta input_type correctamente", () => {
  assert.equal(detectInputType("¿cómo sigo con esto?"), "question");
  assert.equal(detectInputType("Hoy tuve un día difícil"), "emotional_reflective");
  assert.equal(detectInputType("Debo cambiar de trabajo"), "decision");
  assert.equal(detectInputType("Solo quiero pensar en mi progreso"), "general_reflection");
});

test("extrae topics desde neuronas", () => {
  const topics = extractTopics([
    { core: { concept: "Trabajo" } },
    { neuron: { core: { concept: "trabajo" } } },
    { core: { concept: " Relación " } },
  ]);

  assert.deepEqual(topics, ["trabajo", "relación"]);
});

test("clasifica frases correctamente", () => {
  assert.equal(classifySentence("Suena muy importante para ti"), "validation");
  assert.equal(classifySentence("Esto conecta con tu necesidad de calma"), "connection");
  assert.equal(classifySentence("Esto refleja un cambio interno"), "interpretation");
  assert.equal(classifySentence("Probablemente estás buscando claridad"), "insight");
  assert.equal(classifySentence("Seguimos cuando quieras"), "generic");
});

test("agrupa en estructura válida", () => {
  const grouped = groupByStructure([
    "Suena difícil sostener eso",
    "Esto conecta con un proceso mayor",
    "Esto refleja una tensión interna",
  ]);

  assert.equal(grouped.validation.length, 1);
  assert.equal(grouped.connection.length, 1);
  assert.equal(grouped.interpretation.length, 1);
});

test("limpia frases correctamente", () => {
  assert.equal(cleanPhrase("hoy esto puede ayudarte"), "esto puede ayudarte");
  assert.equal(cleanPhrase("corto"), "");
});

test("detecta estilo", () => {
  const light = detectStyle("Suena importante. Puede ser útil.");
  const deep = detectStyle("Suena importante para ti. Esto conecta con experiencias previas que fueron exigentes. Esto refleja un proceso de adaptación. Es posible que ahora necesites redefinir prioridades con calma y constancia.");

  assert.equal(light.depth, "light");
  assert.equal(deep.depth, "deep");
  assert.equal(light.tone, "reflective");
});

test("genera patrón válido", () => {
  const pattern = extractResponsePattern({
    input: "Hoy tuve un día mal y frustrado",
    neurons: [{ core: { concept: "Trabajo" } }, { core: { concept: "Estrés" } }],
    response: "Suena intenso lo que estás viviendo. Esto conecta con una etapa de exigencia. Esto refleja un proceso de ajuste. Es posible que necesites recuperar foco.",
  });

  assert.ok(pattern);
  assert.equal(pattern.type, "response_pattern");
  assert.equal(pattern.context.input_type, "emotional_reflective");
  assert.equal(pattern.context.emotion, "negative");
  assert.ok(pattern.structure.length >= 1);
});

test("evita patrones vacíos", () => {
  const pattern = extractResponsePattern({
    input: "ok",
    neurons: [],
    response: "Muy corto",
  });

  assert.equal(pattern, null);
});

test("dedupe funciona", () => {
  resetStorage();
  const pattern = extractResponsePattern({
    input: "Hoy tuve dudas con mi proyecto",
    neurons: [{ core: { concept: "Proyecto" } }],
    response: "Suena desafiante para ti. Esto conecta con tu expectativa de control. Esto refleja una transición en tu manera de decidir. Es posible que priorizar un paso te dé claridad.",
  });

  const first = savePattern(pattern);
  const isDup = dedupePattern({ ...pattern, id: "rsp_other" });
  const second = savePattern({ ...pattern, id: "rsp_other" });
  const matches = findMatchingPatterns(pattern.context);

  assert.ok(first);
  assert.equal(isDup, true);
  assert.equal(second, null);
  assert.equal(getAllPatterns().length, 1);
  assert.ok(matches.length >= 1);
});

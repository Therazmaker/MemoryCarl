import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalReply } from "../src/neuro/localReplyEngine.js";

function neuron(overrides = {}) {
  return {
    id: "n1",
    core: { concept: "ansiedad laboral", domain: "work", summary: "Aparece en situaciones de presión sin estructura clara" },
    emotion: "fear",
    triggers: ["reuniones", "plazos", "ambigüedad"],
    weight: 0.7,
    temporal: { timeContext: "current", recencyWeight: 1.0 },
    ...overrides,
  };
}

function activated(n, score = 0.8) {
  return [{ neuron: n, score }];
}

test("sin neuronas → mensaje de bootstrap sin crash", () => {
  const result = buildLocalReply({ userInput: "hola", activated: [] });
  assert.equal(typeof result, "string");
  assert.ok(result.length > 10);
});

test("input emocional → intent validar_emocion, respuesta menciona concepto", () => {
  const n = neuron({ emotion: "sadness" });
  const result = buildLocalReply({
    userInput: "me siento muy mal con el trabajo",
    activated: activated(n),
    history: [],
  });
  assert.match(result, /ansiedad laboral/i);
});

test("input con '?' → intent pregunta_directa, respuesta menciona summary", () => {
  const n = neuron();
  const result = buildLocalReply({
    userInput: "¿qué recuerdas sobre mi trabajo?",
    activated: activated(n),
    history: [],
  });
  assert.match(result, /Aparece en situaciones de presión/i);
});

test("usuario confirma turno anterior → respuesta empieza con 'Tiene sentido'", () => {
  const n = neuron();
  const result = buildLocalReply({
    userInput: "sí, exactamente",
    activated: activated(n),
    history: [
      { role: "user", content: "me cuesta mucho en el trabajo" },
      { role: "assistant", content: "¿Esto de 'ansiedad laboral' aparece más en momentos de presión?" },
    ],
  });
  assert.match(result, /Tiene sentido/i);
});

test("usuario niega turno anterior → respuesta empieza con 'Entendido'", () => {
  const n = neuron();
  const result = buildLocalReply({
    userInput: "no, no es eso",
    activated: activated(n),
    history: [
      { role: "assistant", content: "¿Esto aparece en reuniones?" },
    ],
  });
  assert.match(result, /Entendido/i);
});

test("modo journal → respuesta incluye prefijo de diario", () => {
  const n = neuron();
  const result = buildLocalReply({
    userInput: "hoy fue un día raro",
    activated: activated(n),
    mode: "journal",
    history: [],
  });
  assert.match(result, /Para este diario/i);
});

test("pregunta generativa siempre incluye el concept de la neurona top-1", () => {
  const n = neuron({ core: { concept: "procrastinación", domain: "personal", summary: "Evitación ante tareas sin sentido claro" } });
  const result = buildLocalReply({
    userInput: "no sé por qué sigo postergando todo",
    activated: activated(n),
    history: [],
  });
  assert.match(result, /procrastinación/i);
  assert.match(result, /\?/);
});

test("con dos neuronas → respuesta menciona ambos conceptos", () => {
  const n1 = neuron({ core: { concept: "perfeccionismo", domain: "work", summary: "Estándar muy alto" } });
  const n2 = neuron({ id: "n2", core: { concept: "agotamiento", domain: "personal", summary: "Fatiga acumulada" }, emotion: "sadness" });
  const result = buildLocalReply({
    userInput: "estoy agotado de querer hacerlo todo bien",
    activated: [{ neuron: n1, score: 0.9 }, { neuron: n2, score: 0.7 }],
    history: [],
  });
  assert.match(result, /perfeccionismo/i);
  assert.match(result, /agotamiento/i);
});

test("con insights → insightSummary aparece en la respuesta", () => {
  const n = neuron();
  const result = buildLocalReply({
    userInput: "otra vez lo mismo",
    activated: activated(n),
    insights: [{ type: "recurring_pattern", summary: "Este patrón se repite en ciclos de tres semanas.", confidence: 0.8 }],
    insightSummary: "Este patrón se repite en ciclos de tres semanas.",
    history: [],
  });
  assert.match(result, /Este patrón se repite/i);
});

test("sin crashes con inputs vacíos o null", () => {
  assert.doesNotThrow(() => buildLocalReply({ userInput: "", activated: [] }));
  assert.doesNotThrow(() => buildLocalReply({ userInput: null, activated: [] }));
  assert.doesNotThrow(() => buildLocalReply({}));
});

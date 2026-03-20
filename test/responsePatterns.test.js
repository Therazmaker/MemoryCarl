import test from "node:test";
import assert from "node:assert/strict";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

import {
  extractResponsePattern,
  saveResponsePattern,
  getAllPatterns,
  findBestPattern,
  buildResponseFromPattern,
} from "../src/neuro/responsePatterns.js";

test("extractResponsePattern builds structured response_pattern", () => {
  const pattern = extractResponsePattern({
    input: "Me siento ansioso y no sé qué hacer con mi trabajo",
    neurons: [{ core: { concept: "trabajo", domain: "career" }, triggers: ["ansiedad laboral"], emotion: "sadness" }],
    response: "Entiendo que te sientas así. A veces nos pasa cuando hay mucha presión. Podría significar que necesitas un límite más claro. Te propongo empezar por una prioridad hoy.",
  });

  assert.equal(pattern.type, "response_pattern");
  assert.ok(Array.isArray(pattern.structure));
  assert.ok(pattern.structure.length > 0);
  assert.ok(pattern.context.topics.includes("trabajo"));
  assert.equal(pattern.context.input_type, "emocional");
});

test("saveResponsePattern prevents near duplicates", () => {
  resetStorage();
  const pattern = extractResponsePattern({
    input: "Estoy triste",
    neurons: [{ core: { concept: "emociones", domain: "salud" }, triggers: ["triste"], emotion: "sadness" }],
    response: "Entiendo cómo te sientes. Puede significar que necesitas descanso.",
  });

  const first = saveResponsePattern(pattern);
  const second = saveResponsePattern({ ...pattern, id: "otro_id" });

  assert.ok(first);
  assert.equal(second, null);
  assert.equal(getAllPatterns().length, 1);
});

test("findBestPattern returns good match and can generate local response", () => {
  resetStorage();
  const pattern = extractResponsePattern({
    input: "Estoy frustrado con mi proyecto",
    neurons: [{ core: { concept: "proyecto", domain: "work" }, triggers: ["frustrado"], emotion: "anger" }],
    response: "Entiendo esa frustración. A veces pasa en proyectos largos. Podría indicar saturación. Te propongo simplificar el siguiente paso.",
  });
  saveResponsePattern(pattern);

  const best = findBestPattern("Estoy frustrado por mi proyecto de trabajo", [
    { core: { concept: "proyecto", domain: "work" }, triggers: ["trabajo"], emotion: "anger" },
  ]);

  assert.ok(best);
  assert.equal(best.isGoodMatch, true);
  const localReply = buildResponseFromPattern(best.pattern, "input");
  assert.ok(localReply.length > 20);
});

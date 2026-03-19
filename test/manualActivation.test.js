import test from "node:test";
import assert from "node:assert/strict";

import { activateNeurons, computeAliasMatch, getManualNeuronBoost } from "../src/neuro/activation.js";
import { createNeuron } from "../src/neuro/schemas.js";

test("alias match boosts manual neuron activation", async () => {
  const manual = createNeuron({
    id: "m1",
    type: "person",
    core: { concept: "Fergis", domain: "relationships", summary: "Pareja" },
    source: { kind: "manual", ref: "context_window" },
    meta: { aliases: ["mi esposa"], priority: "high", pin: true, manualCategory: "people" },
    triggers: ["familia"],
  });
  const other = createNeuron({ id: "a1", core: { concept: "Trabajo", domain: "work", summary: "Oficina" } });

  const activated = await activateNeurons("Hoy hablé con mi esposa", [manual, other], { persistActivation: false, minScore: 0.05 });
  assert.equal(activated[0].neuron.id, "m1");
  assert.ok(activated[0].components.aliasMatch > 0.8);
});

test("pin + priority alone do not activate without match", () => {
  const manual = createNeuron({ source: { kind: "manual", ref: "context_window" }, meta: { pin: true, priority: "high", aliases: [] } });
  const boost = getManualNeuronBoost(manual, { aliasMatch: 0, entityMention: false, conceptMention: false });
  assert.equal(boost, 0);
  assert.equal(computeAliasMatch("hola mundo", manual), 0);
});

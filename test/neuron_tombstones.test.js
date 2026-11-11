import test from "node:test";
import assert from "node:assert/strict";

import { applyNeuronTombstones } from "../src/services/cloudRestore.js";

const n = (id, connections = []) => ({ id, core: { concept: id }, connections });

test("quita las neuronas borradas en la nube y redirige conexiones y memorias", () => {
  const neurons = [n("keep", ["a", "b"]), n("a", ["keep"]), n("b"), n("other", ["a", "junk"]), n("junk")];
  const memories = [{ id: "m1", linkedNeurons: ["a", "keep"] }, { id: "m2", linkedNeurons: ["junk"] }, { id: "m3", linkedNeurons: ["other"] }];
  const r = applyNeuronTombstones(neurons, memories, { ids: ["a", "b", "junk"], mergedInto: { a: "keep", b: "keep" } });
  assert.deepEqual(r.neurons.map((x) => x.id), ["keep", "other"]);
  assert.equal(r.removed, 3);
  assert.deepEqual(r.neurons.find((x) => x.id === "keep").connections, [], "a y b eran ella misma");
  assert.deepEqual(r.neurons.find((x) => x.id === "other").connections, ["keep"]);
  assert.deepEqual(r.memories.map((m) => m.linkedNeurons), [["keep"], [], ["other"]]);
  assert.equal(r.memoriesChanged, 2);
});

test("sin lista o ya aplicada: no cambia nada", () => {
  const neurons = [n("x")];
  assert.equal(applyNeuronTombstones(neurons, [], {}).neurons, neurons);
  const once = applyNeuronTombstones([n("x"), n("y")], [], { ids: ["y"] });
  const twice = applyNeuronTombstones(once.neurons, once.memories, { ids: ["y"] });
  assert.equal(twice.removed, 0);
  assert.equal(twice.memoriesChanged, 0);
});

import test from "node:test";
import assert from "node:assert/strict";

import { getActivationTuning } from "../src/neuro/activation.js";
import { getBootstrapState } from "../src/neuro/bootstrap.js";

test("activation threshold lowers with few neurons", () => {
  const strong = getActivationTuning(4, { bootstrapState: getBootstrapState(4) });
  const normal = getActivationTuning(10, { bootstrapState: getBootstrapState(10) });
  const off = getActivationTuning(20, { bootstrapState: getBootstrapState(20) });

  assert.ok(strong.minScore < normal.minScore);
  assert.ok(normal.minScore < off.minScore);
});

test("bootstrap tuning increases keyword weight and relaxes semantic weight", () => {
  const strong = getActivationTuning(4, { bootstrapState: getBootstrapState(4) });
  const off = getActivationTuning(25, { bootstrapState: getBootstrapState(25) });

  assert.ok(strong.weights.keyword > off.weights.keyword);
  assert.ok(strong.weights.semantic < off.weights.semantic);
  assert.equal(strong.bootstrapAdjusted, true);
});

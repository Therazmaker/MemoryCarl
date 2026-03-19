/**
 * bootstrap.js — Estado de arranque temprano (seed/bootstrap mode)
 * NeuroChat / MemoryCarl
 */

const DEFAULT_BOOTSTRAP_OPTIONS = {
  strongThreshold: 8,
  normalThreshold: 15,
};

function resolveOptions(options = {}) {
  const strongThreshold = Number.isFinite(options.strongThreshold)
    ? Math.max(1, Number(options.strongThreshold))
    : DEFAULT_BOOTSTRAP_OPTIONS.strongThreshold;
  const normalThreshold = Number.isFinite(options.normalThreshold)
    ? Math.max(strongThreshold + 1, Number(options.normalThreshold))
    : DEFAULT_BOOTSTRAP_OPTIONS.normalThreshold;

  return { strongThreshold, normalThreshold };
}

export function getBootstrapState(totalNeurons, options = {}) {
  const { strongThreshold, normalThreshold } = resolveOptions(options);
  const total = Number.isFinite(totalNeurons) ? Math.max(0, Number(totalNeurons)) : 0;

  if (total < strongThreshold) {
    return {
      enabled: true,
      level: "strong",
      totalNeurons: total,
      threshold: normalThreshold,
      thresholds: { strong: strongThreshold, normal: normalThreshold },
    };
  }

  if (total < normalThreshold) {
    return {
      enabled: true,
      level: "normal",
      totalNeurons: total,
      threshold: normalThreshold,
      thresholds: { strong: strongThreshold, normal: normalThreshold },
    };
  }

  return {
    enabled: false,
    level: "off",
    totalNeurons: total,
    threshold: normalThreshold,
    thresholds: { strong: strongThreshold, normal: normalThreshold },
  };
}

export function isBootstrapMode(totalNeurons, options = {}) {
  return getBootstrapState(totalNeurons, options).enabled;
}

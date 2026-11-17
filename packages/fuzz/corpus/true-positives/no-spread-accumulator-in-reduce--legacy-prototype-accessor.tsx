// rule: no-spread-accumulator-in-reduce
// weakness: alias-guard
// source: PR 2298 review, inherited reducer replaced through a legacy accessor
// verdict: fail
// fixture-context: physical
import { labels } from "../regressions/providers/frozen-reduce-labels";

const {
  constructor: { prototype: arrayPrototype },
} = [];

export const foldLabels = (externalItems) => {
  const method = "__define" + "Getter__";
  arrayPrototype[method]("reduce", () => (callback, seed) => {
    for (const item of externalItems) seed = callback(seed, item);
    return seed;
  });
  return labels.reduce((result, label) => [...result, label], []);
};

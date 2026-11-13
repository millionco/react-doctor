// rule: no-spread-accumulator-in-reduce
// weakness: alias-guard
// source: independently invented module fixture
// verdict: fail
// fixture-context: physical
import { labels } from "../regressions/providers/frozen-reduce-labels";

const {
  constructor: { prototype: arrayPrototype },
} = [];
({ reduce: arrayPrototype.reduce } = {
  reduce(callback, seed) {
    for (const item of externalItems) seed = callback(seed, item);
    return seed;
  },
});

export const foldedLabels = labels.reduce((result, label) => [...result, label], []);

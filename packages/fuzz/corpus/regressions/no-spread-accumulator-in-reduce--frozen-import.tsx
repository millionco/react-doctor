// rule: no-spread-accumulator-in-reduce
// weakness: cross-file
// source: independently invented module fixture
// verdict: pass
// fixture-context: physical
import { labels } from "./providers/frozen-reduce-labels";

export const foldedLabels = labels.reduce((result, label) => [...result, label], []);

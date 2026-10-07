// rule: server-cache-with-object-literal
// verdict: pass
// Source: issue #1810 and PR #1811 review.
// Weakness: A reassigned alias no longer identifies a cached function.
import { cache } from "react";
const read = cache(load);
let alias = read;
alias = other;
export const result = alias({ id: 1 });

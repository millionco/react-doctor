---
"oxlint-plugin-react-doctor": patch
---

fix: prevent stack overflow in function resolution with depth limiting

React Doctor 0.9.12 could overflow the JavaScript call stack while resolving function references through deeply nested expressions, TypeScript path aliases, or complex import chains. The crash manifested as "RangeError: Maximum call stack size exceeded" during the lint phase, causing the entire project scan to abort with incomplete results.

The `resolveExactLocalFunction` utility now enforces a configurable depth limit (FUNCTION_RESOLUTION_MAX_DEPTH = 15) to prevent unbounded recursion. When resolution depth is exhausted, the function returns null rather than continuing to recurse, allowing the scan to complete normally.

This fix preserves all existing diagnostic behavior—the depth limit only affects pathological edge cases that would have crashed before.

Closes #1657

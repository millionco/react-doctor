---
"oxlint-plugin-react-doctor": patch
---

fix: prevent stack overflow in AST traversal on deeply nested code structures

Fixes issue #1438 where scanning files with deeply nested async functions and try/catch blocks would crash with "RangeError: Maximum call stack size exceeded". Converted `walkAst()` from recursive to iterative traversal using an explicit stack, eliminating unbounded recursion while preserving identical semantics. Also added memoization to `subtreeCanThrowSynchronously` to cache results and avoid redundant analysis.

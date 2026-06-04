---
"react-doctor": patch
---

`prefer-module-scope-static-value` ("Static value rebuilt every render") is now disabled when React Compiler is enabled.

React Compiler already hoists and caches per-render array/object allocations, so both halves of the recommendation — avoid the re-allocation and preserve referential equality for memoized children — are handled automatically, making the warning pure noise on a compiler-enabled codebase (#669). The rule now carries `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` rules that gate on the same capability.

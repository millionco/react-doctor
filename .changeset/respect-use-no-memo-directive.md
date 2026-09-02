---
"oxlint-plugin-react-doctor": patch
---

fix: respect "use no memo" directive in react-compiler-no-manual-memoization rule

When a component has the "use no memo" directive, React Compiler skips optimization for that component, so manual memoization (useMemo, useCallback, memo) is still needed. The rule now detects this directive and suppresses warnings in such cases.

Fixes #1749

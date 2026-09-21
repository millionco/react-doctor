---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix `effect-needs-cleanup` false positive for React 19 callback ref cleanup returns. React 19 callback refs can return cleanup functions with the signature `(node: T | null) => void | (() => void)`. The rule now correctly handles cases where cleanup is only returned after resource usage (e.g., after `ResizeObserver.observe()`), allowing `void` returns on the null branch.

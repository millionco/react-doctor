---
"oxlint-plugin-react-doctor": patch
---

perf: memoize getElementType per JSX opening element (with a settings-identity guard) so the ~30 a11y rules resolve each element once instead of once per rule

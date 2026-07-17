---
"oxlint-plugin-react-doctor": patch
---

Avoid `effect-needs-cleanup` false positives when a `useSyncExternalStore` subscribe callback returns a delegated disposer through a conditional or nullish fallback.

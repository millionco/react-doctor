---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Avoid listener churn warnings for a readonly callback field returned by a closed local Hook using native useCallback with empty dependencies. Preserve warnings for fresh, opaque, mutable or shadowed handlers and other unstable listeners in the same effect.

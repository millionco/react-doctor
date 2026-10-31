---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Correct `no-adjust-state-on-prop-change` advice to allow guarded render adjustments when state depends on previous renders and derivation, a key reset, and event updates do not fit.

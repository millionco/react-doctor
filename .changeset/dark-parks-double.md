---
"oxlint-plugin-react-doctor": patch
---

Fix `effect-needs-cleanup` false positives for conditionally allocated resources whose exact stable handle is released by the returned effect cleanup.

---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Detect render-time ref.current writes made through Object.assign while preserving predictable guarded initialization and deferred effect or event writes. Keep semantic analysis lazy for unrelated calls. Exclude calls to an overridden Object.assign.

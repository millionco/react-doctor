---
"@react-doctor/core": patch
"react-doctor": patch
---

Replace the Socket.dev supply-chain check with OSV across the core checker, CLI wiring, docs, schema, and tests. The supply-chain config now uses `failOn` for severity gating instead of `minScore`, and diagnostics now report OSV vulnerability IDs and severities.

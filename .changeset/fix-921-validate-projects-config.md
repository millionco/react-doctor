---
"@react-doctor/core": patch
"react-doctor": patch
---

fix: validate string array config fields (projects, textComponents, etc.)

Non-string entries in `config.projects` caused `selectProjects` to crash with `requestedName.trim is not a function`. The validator now filters non-string entries from `projects`, `textComponents`, `rawTextWrapperComponents`, and `serverAuthFunctionNames` with warnings instead of crashing.

Fixes #921 (Sentry REACT-DOCTOR-1R)

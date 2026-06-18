---
"@react-doctor/core": patch
---

Skip pnpm hardening check for monorepo sub-packages. Hardening settings are workspace-level and should only be checked at the workspace root or standalone pnpm projects.

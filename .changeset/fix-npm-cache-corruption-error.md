---
"react-doctor": patch
---

Detect and provide helpful guidance for npm cache corruption errors (MODULE_NOT_FOUND for ajv/conf in npx cache), a known issue with npm 12 + Node 26 where packages are incompletely installed. The CLI now recognizes this failure pattern and suggests clearing the npx cache or using an alternative package manager (bunx/pnpm dlx) instead of treating it as an internal bug.

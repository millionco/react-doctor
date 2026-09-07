---
"react-doctor": patch
---

Skip TypeScript files without JSX support (`.ts`, `.mts`, and `.cts`, including declarations) before applying JSX duplication analysis budgets. Large generated type files no longer make the maintainability scan incomplete or consume its source-file budget. JSX-capable files retain the existing limits.

---
"react-doctor": patch
---

Exclude every discovered nested workspace project from an ancestor scan, whether or not it was selected. Scanning only the root of a monorepo previously pulled a nested app's files into the root scan and judged them against the root's framework and React Compiler settings, so a compiler-enabled Expo app inside a Vite workspace reported compiler-gated rules like `prefer-module-scope-pure-function` that its own config suppresses. A nested project's files are now only checked by that project's scan, matching what selecting both projects already did.

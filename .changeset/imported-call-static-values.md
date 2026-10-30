---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid recommending module-scope hoisting for literals that evaluate imported functions, including readonly const aliases. This conservatively retains per-render evaluation without classifying imported functions as impure.

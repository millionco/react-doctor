---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Detect fbtee scoped JSX React Compiler bailout at source level. Adds new rule `fbtee-scoped-jsx-compiler-bailout` that catches when fbtee's scoped `useFbt()` / `useFbs()` bindings are used in JSX form before the fbtee transform. This closes the diagnostic gap where React Compiler bailouts were only reported after the transform, not at the source level.

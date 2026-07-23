---
"@react-doctor/core": patch
"react-doctor": patch
---

fix: detect React Compiler when babel-plugin-react-compiler is installed

Fixes false positive in `context-provider-value-from-unmemoized-local-literal` and other React Compiler-gated rules when the compiler is installed as a package dependency without explicit configuration in config files.

The detector now checks for `babel-plugin-react-compiler` and `react-compiler-runtime` in package dependencies, not just in babel/vite/next config files.

Closes #1436

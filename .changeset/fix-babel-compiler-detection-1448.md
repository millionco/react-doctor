---
"@react-doctor/core": patch
"react-doctor": patch
---

Detect React Compiler in babel config files and package.json babel field. Previously, projects using babel-plugin-react-compiler in package.json babel config or babel config files would fail detection, causing React Compiler-gated rules like context-provider-value-from-unmemoized-local-literal to incorrectly fire. Fixes #1448.

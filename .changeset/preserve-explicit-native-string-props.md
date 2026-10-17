---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid numeric-zero advice for readonly explicitly string-typed props in closed React forwardRef callbacks.

Retain the numeric-zero warning when source-visible loader or dynamic-code access makes the React forwardRef provider uncertain, including erased TypeScript binding masks.

Cache provider admission per analysis and module source so repeated string guards share one program scan.

Resolve genuine string parameters through merged type declarations while retaining warnings for runtime writes in nested scopes.

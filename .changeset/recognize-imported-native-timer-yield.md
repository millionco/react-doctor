---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Avoid parallelization advice for a directly imported timeout helper that yields to the host by resolving its Promise from a native timer. Continue checking unrelated awaits in the same loop.

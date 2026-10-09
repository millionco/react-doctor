---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid cleanup warnings for local functions and state setters named setInterval or setTimeout. Require a global timer or a matching Node timers import before classifying these calls as timer allocations.

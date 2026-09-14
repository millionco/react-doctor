---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix(nextjs-no-side-effect-in-get-handler): collect safe bindings from within helper functions

The rule was incorrectly flagging `Headers.set()` on freshly constructed Headers objects when the construction happened inside a same-file helper function. Now we also collect safe bindings (like `new Headers()` assignments) from within each helper's own scope and merge them into the effective safe set, so helpers that create and mutate their own local response objects no longer trigger false positives.

---
"oxlint-plugin-react-doctor": patch
---

Detect unguarded state updates in inline microtask and proven native Promise callbacks started by effects with changing dependencies. Preserve cleanup guards, stable dependencies, and opaque or shadowed thenables.

Exclude inert generator callbacks and mutated or escaped Promise receivers, and cache immutable provenance checks for shared Promise bindings.

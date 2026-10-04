---
"oxlint-plugin-react-doctor": patch
---

Resolve local Hook-shaped object methods before applying React Hook namespace heuristics, including inspection dispatchers and useEffectEvent.
Preserve Hook diagnostics for unresolved invoked callbacks and bound Hook aliases, while resolving proven local callbacks at each call site.

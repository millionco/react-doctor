---
"oxlint-plugin-react-doctor": patch
---

Recognize timers created in synchronous Promise callbacks when an effect cleanup invalidates the callback's boolean guard and releases one effect-local handle. Repeated, suspended, shared-handle, shadowed-API, and unguarded callbacks remain diagnostics because they can allocate or orphan timers after cleanup, and the diagnostic now describes missing guaranteed ownership rather than claiming no cleanup was returned.

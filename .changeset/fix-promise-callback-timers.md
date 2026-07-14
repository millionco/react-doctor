---
"oxlint-plugin-react-doctor": patch
---

Recognize timers created in synchronous Promise callbacks when an effect cleanup invalidates an effect-local boolean guard and releases the same effect-local handle on every cleanup path, including idiomatic truthy and nullish handle guards followed by a nullish reset and inactive branches that perform work before terminating. Guarded cleanup only counts when the actual release covers every live-handle path and precedes any handle reset. Repeated, suspended, shared-state, conditionally released, generator-cleanup, shadowed-API, unguarded, and rejoining-call callbacks remain diagnostics because they can allocate or orphan timers after cleanup, and the diagnostic now describes missing guaranteed ownership rather than claiming no cleanup was returned.

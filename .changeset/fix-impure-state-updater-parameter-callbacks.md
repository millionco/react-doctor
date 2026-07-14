---
"oxlint-plugin-react-doctor": patch
---

Stop `no-impure-state-updater` firing on promise callbacks and event handlers. A setter call whose argument is a plain parameter (`setX(value)` inside `(value) => …`) was resolved to its enclosing function and analyzed as the updater callback, so `fetchInvites().then((data) => setInvites(data))` and `onChange={(next) => setSort(next)}` were reported as impure updaters. `resolveToFunction` now refuses to resolve a parameter binding to the function it merely lives in, which is centralized for every effect-analysis consumer.

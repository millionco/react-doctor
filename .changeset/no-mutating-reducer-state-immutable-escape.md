---
"oxlint-plugin-react-doctor": patch
---

`no-mutating-reducer-state` no longer flags immutable-collection reducers: `return state.set(k, v)` / `const next = state.delete(k); return next` on an Immutable.js/Mori collection returns a NEW collection and is the correct reducer shape, but was reported as an in-place mutation at error severity. Since native Map/Set can't be distinguished without type info, the escape is result-shaped — a collection `.set`/`.add`/`.delete`/`.clear` call whose result is CONSUMED (returned or assigned) matches the immutable idiom and is skipped, while a discarded-result call (`state.set(k, v); return state`) still fires (it's either a native mutation or a no-op immutable call, both bugs). Array mutators stay unconditional because consuming a native `.splice()` result is idiomatic and still mutates.

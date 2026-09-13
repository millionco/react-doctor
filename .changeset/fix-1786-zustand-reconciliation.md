---
"oxlint-plugin-react-doctor": patch
---

Fix a `query-mutation-missing-invalidation` false positive when a mutation re-syncs a Zustand store from an awaited server fetch, without exempting unrelated Zustand writes.

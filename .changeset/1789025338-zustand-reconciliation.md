---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix `query-mutation-missing-invalidation` false positive when mutations explicitly reconcile Zustand state with fresh data. The rule now recognizes when a mutation fetches fresh data (via await) and updates a Zustand store (via setState) as valid state synchronization, similar to query cache invalidation.

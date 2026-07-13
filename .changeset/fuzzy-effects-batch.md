---
"oxlint-plugin-react-doctor": patch
---

Retire `no-cascading-set-state` because React batches synchronous state updates from one effect into the same follow-up commit, so counting setter calls does not establish repeated redraws.

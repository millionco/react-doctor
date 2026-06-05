---
"oxlint-plugin-react-doctor": patch
---

Add `query-destructure-result` rule: flags `const result = useQuery(...)` where the whole TanStack Query object is assigned instead of destructured, bypassing tracked-property optimization.

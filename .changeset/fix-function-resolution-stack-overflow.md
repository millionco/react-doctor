---
"oxlint-plugin-react-doctor": patch
---

Prevent stack overflows while resolving deeply nested local function references. React Doctor now stops following a reference chain after a bounded number of steps instead of aborting the lint scan.

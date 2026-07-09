---
"oxlint-plugin-react-doctor": patch
---

`no-nested-component-definition` is demoted from error to warn, unifying it with `no-unstable-nested-components` — the same defect class (a component defined inside another component's render) was reported at two different severities depending on which rule caught it.

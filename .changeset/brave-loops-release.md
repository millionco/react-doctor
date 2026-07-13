---
"oxlint-plugin-react-doctor": patch
---

Require exhaustive `for...of` removal loops before they satisfy retained-handler cleanup in `effect-needs-cleanup` — a `break`-truncated loop no longer hides a partial listener leak.

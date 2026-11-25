---
"oxlint-plugin-react-doctor": patch
---

Avoid false positives when an async effect rechecks its private cancellation flag on each loop iteration or continues after a successful cancellation-aware timer wait.

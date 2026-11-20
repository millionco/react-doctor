---
"oxlint-plugin-react-doctor": patch
---

Avoid reporting a private readiness marker that is set after a guarded browser storage check. Keep reporting markers that can be rearmed, rendered, or set through a path that skips the check.

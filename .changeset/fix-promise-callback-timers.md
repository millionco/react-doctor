---
"oxlint-plugin-react-doctor": patch
---

Recognize timers created in Promise callbacks when an effect cleanup invalidates the callback's boolean guard and releases the same timer handle. Unguarded callbacks remain diagnostics because they can create resources after unmount.

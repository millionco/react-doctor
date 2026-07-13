---
"oxlint-plugin-react-doctor": patch
---

Fix `no-impure-state-updater` false positives on promise callbacks and event handlers. The rule was incorrectly analyzing functions when their parameters were used in state setter calls, treating promise callbacks like `(d) => setInvites(d)` and event handlers as updater callbacks.

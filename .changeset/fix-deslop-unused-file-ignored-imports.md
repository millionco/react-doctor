---
"react-doctor": patch
---

Fix a false-positive `deslop/unused-file` for a file imported only by a file in `ignore.files`. Ignored files are now kept in the dead-code dependency graph (only their reporting is suppressed), so a module reachable solely through an ignored file is no longer flagged as unused.

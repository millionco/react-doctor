---
"oxlint-plugin-react-doctor": patch
---

Fix `async-defer-await` warnings on compound guards that compare function parameters with mutable state after an await. Keep these checks after the await so they can detect stale responses. Fixes #1895.

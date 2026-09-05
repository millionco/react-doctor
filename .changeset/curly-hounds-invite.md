---
"oxlint-plugin-react-doctor": patch
---

Fix `async-defer-await` false positive on `run.live` liveness guards. The rule now recognizes "live" as a cancellation/liveness flag name, silencing false positives on the standard React effect pattern `if (!run.live) return` after an await.

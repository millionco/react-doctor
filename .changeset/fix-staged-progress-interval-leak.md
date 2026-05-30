---
"react-doctor": patch
---

Fix `react-doctor --staged` (and other scans) hanging after the diagnostics summary is already printed. When an adopted lint config crashed oxlint on the first attempt, the oxlint runner's per-batch progress timer was left running while the scan silently retried with `extends` stripped — so the run finished and printed results, but the orphaned `setInterval` kept the Node event loop alive and the process never returned control to the shell. The batch loop now clears the timer in a `finally`, so it's always cleaned up even when a batch throws. See #599.

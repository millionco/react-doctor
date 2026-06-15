---
"@react-doctor/core": patch
"react-doctor": patch
---

Show the full file total when the scan hands off to dead-code analysis, so the live counter no longer looks stuck below `N` (#815).

The linter already emits a final `(N, N)` progress tick when its last batch finishes, but ora throttles renders to its frame interval — that last frame was overwritten by the `"Analyzing dead code…"` text before it ever painted, so the spinner appeared to freeze at whatever value the smooth-creep timer last drew (e.g. `80/165`). Every file was always scanned; only the counter looked short. The dead-code phase now reads `Scanned N files, analyzing dead code…`, keeping the complete count visible for the whole (longer) dead-code pass.

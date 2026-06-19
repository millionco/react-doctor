---
"@react-doctor/core": patch
"react-doctor": patch
---

Diagnostics are now emitted in a deterministic order across runs (JSON report, terminal output, on-disk dump, and the agent handoff), so two runs of the same repo produce byte-identical ordering instead of the parallel lint pass's arrival order. Lint scans also schedule the largest source files first (LPT batch ordering) for better wall-clock on large repos — a free reordering using the file size the minified-file gate already stat'd. Set `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to fall back to discovery order. The diagnostics array content (and the JSON `schemaVersion`) is unchanged — only the ordering becomes deterministic.

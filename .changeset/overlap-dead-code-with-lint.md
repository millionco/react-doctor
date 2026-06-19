---
"@react-doctor/core": patch
"react-doctor": patch
---

Overlap dead-code analysis with the lint pass on full scans, gated on available memory.

Dead-code reachability analysis previously ran strictly after lint finished. It now runs concurrently with lint (forked as a child fiber) when a memory gate confirms there is headroom to run the 8 GB-heap dead-code worker alongside the oxlint workers, collapsing their combined wall-clock toward `max(lint, dead-code)` instead of the sum on the majority full-scan path. When free memory is tight the scan transparently falls back to the previous strictly-sequential behavior, so there is no peak-memory regression, and a lint failure now interrupts the in-flight dead-code worker (SIGKILL) instead of leaving it running. Diagnostic output, scoring, and terminal progress are identical either way; diff/staged/`--no-warnings` runs are unaffected (dead-code is already skipped there). The overlap can be forced on or off with `REACT_DOCTOR_DEAD_CODE_OVERLAP=on|off`.

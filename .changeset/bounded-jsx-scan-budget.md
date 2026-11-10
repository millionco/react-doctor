---
"react-doctor": patch
---

Allow duplicate-JSX analysis to complete on larger projects with a bounded 500,000-node default. Explicit node limits still stop the scan, now with one global reason based on observed nodes instead of repeated per-file errors and continued parsing after exhaustion.

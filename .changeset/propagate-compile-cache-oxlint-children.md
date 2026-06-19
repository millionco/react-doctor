---
"@react-doctor/core": patch
---

Propagate the V8 compile cache (`NODE_COMPILE_CACHE`) to oxlint batch subprocesses so later batches reuse warm bytecode. Measured ~2% of the lint phase on large multi-batch scans; no benefit for single-batch (`--diff`/`--staged`) scans. The dominant per-child cost is plugin eval/registration, which the compile cache does not address — this is a small internal speedup, not a headline. Opt out with `NODE_DISABLE_COMPILE_CACHE=1`.

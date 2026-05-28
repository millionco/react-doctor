---
"react-doctor": patch
---

perf(lint): run oxlint file batches across a bounded worker pool

Large repos previously linted their file batches one subprocess at a
time, leaving most CPU cores idle during the scan. Batches now fan out
across a pool sized to the machine's available parallelism (capped to
keep many-core CI boxes from reintroducing the memory-pressure cliff the
batching guards against). Set `REACT_DOCTOR_LINT_CONCURRENCY` to tune the
pool — `1` restores the previous sequential behavior, higher values opt a
memory-rich runner into more parallelism.

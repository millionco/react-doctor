---
"react-doctor": minor
---

Add an `--experimental-parallel [workers]` flag that runs the oxlint lint pass across multiple worker processes instead of one batch at a time. React Doctor's rules are oxlint JS plugins (single-threaded per process), so a serial scan only ever pins one core; `--experimental-parallel` fans the file batches out across the requested number of concurrent oxlint subprocesses, which scales the scan nearly linearly with CPU cores (measured ~3.5–4.6x on a 1,500-file project and ~4.6x on Sentry's 8,773 files) while producing byte-identical diagnostics.

`--experimental-parallel` with no value auto-detects available cores; `--experimental-parallel <n>` caps the worker count; `REACT_DOCTOR_PARALLEL=<n>` seeds the default for flag-less / CI runs. The worker count is clamped to a safe range to bound peak memory, and the default remains serial so resource usage stays opt-in.

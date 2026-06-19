---
"react-doctor": patch
"@react-doctor/core": patch
---

Replace the fixed 16-worker lint ceiling with a memory-and-core-budgeted auto count (up to 32). The auto path now picks `min(cores, floor(availableMemory / 1 GiB))` clamped to `[1, 32]`, where `availableMemory` is `os.totalmem()` floored by the container's cgroup memory limit (read directly, since Node's memory APIs report the host total inside a container). `os.freemem()` is deliberately not used — it excludes reclaimable page cache and reads near-zero on macOS / cache-heavy Linux, which would have collapsed the default scan to a single worker.

The 1 GiB/worker budget matches the per-worker footprint the old fixed-16 ceiling already tolerated (16 workers on a typical 16 GiB CI box), so machines with at least ~1 GiB per core stay core-bound and unchanged. A 32/64-core runner with enough memory now uses up to 32 workers instead of idling cores behind the old 16; a high-core but memory-starved box or container uses fewer workers so the oxlint native binding doesn't OOM (the existing `EAGAIN`/`ENOMEM` serial replay remains the runtime backstop). Past ~10 workers parallel efficiency already flattens, so this is headroom and OOM-safety, not a proportional speedup.

The cgroup v2 limit is read from the mount-root `memory.max`, which is the container's limit under the standard cgroup-namespace setup CI runners use; a non-namespaced nested cgroup falls back to the host total (with the serial replay as the backstop).

Note for `diagnose({ projects })` batch scans: each project's lint pass is budgeted independently against the whole machine, so a batch (default 4 concurrent projects) can now spawn up to `4 × 32` concurrent oxlint processes on a large runner (was `4 × 16`). The per-project `EAGAIN`/`ENOMEM` serial replay still backstops any over-subscription; dividing the per-project memory budget by the batch concurrency is a possible follow-up.

Explicit `REACT_DOCTOR_PARALLEL=N` and `inspect({ concurrency: N })` pins are now clamped to 32 (was 16). The `[~N workers]` scan suffix can show more than 16 on large runners, and the `oxlint.workers` telemetry distribution (plus the wide-event `workerCount` / `parallel`) now reports the real resolved worker count on the default auto path instead of only when a count was pinned.

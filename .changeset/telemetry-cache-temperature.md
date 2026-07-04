---
"react-doctor": patch
---

Added cache-temperature telemetry to the per-scan Sentry wide event, so cache effectiveness is queryable at a glance instead of being inferred from per-subsystem dims. `cache.temperature` classifies every scan as `turbo` (whole-repo scan-result replay — now marked by an explicit `wholeRepoCacheHit` flag on the replay path, never inferred from absent dims), `warm` (any incremental reuse across the per-file lint, sidecar, or dead-code caches), `cold` (caches on, zero reuse), or `disabled` (the global `REACT_DOCTOR_NO_CACHE` off-switch). `cache.warmth` is the numeric headline magnitude in [0, 1] — the plain mean of the known subsystem reuse fractions, skipping subsystems that never consulted a cache. The existing per-subsystem dims (`lint.cacheHitRatio`, `lint.sidecarReplayRatio`, `deadCode.cacheHit`, `deadCode.summaryCacheHits/Misses`) are unchanged. Telemetry-only: no new counters, no JSON-report or cache-schema changes.

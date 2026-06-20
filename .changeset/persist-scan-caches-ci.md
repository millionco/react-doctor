---
"@react-doctor/core": patch
"react-doctor": patch
---

Persist react-doctor's scan caches across CI runs (plan 10).

In CI every commit is a fresh, SHA-scoped checkout, so the project-local `node_modules/.cache` never survives between commits — every run recomputes from scratch. This makes the engine's caches survivable:

- **`REACT_DOCTOR_CACHE_DIR`** (new env): an operator/CI-pinned cache root. The GitHub Action points it at a stable `${runner.temp}` path and persists it with `actions/cache`, so the per-file content-addressed lint cache restores across runs — a PR re-lints only its changed files instead of the whole project. Keyed on the react-doctor version + lockfile + os/arch, with a `restore-keys` partial-hit fallback; the engine re-validates every restored entry by content hash + ruleset hash, so a stale entry simply misses and recomputes (no correctness risk).
- **Supply-chain on-disk cache** (new): per-PURL Socket artifacts are cached under the cache dir with a 24h TTL (`SUPPLY_CHAIN_CACHE_TTL_MS`), so unchanged dependencies skip the network on repeated scans — locally and in CI — removing the bulk of the Socket fetches a full scan makes. Fail-open (a cache miss/error just fetches; a write failure never sinks the scan) and disabled by the existing `REACT_DOCTOR_NO_CACHE` off-switch.

The `action.yml` cache wiring ships as an action release (cut a tag after dogfooding). A `--print-cache-key` flag for a tighter (ruleset-exact) actions/cache key is a possible follow-up; the version+lockfile key already restores soundly today.

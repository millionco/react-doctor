---
"@react-doctor/core": patch
"react-doctor": patch
---

Bound every long-running scan phase with a hard, runtime-independent timeout so a single wedged dependency socket, quadratic file, or starved event loop can no longer hang a scan for hours (production traces showed `runInspect` up to 16h and `Linter.run` up to 7.5h).

- **Binary-split cascade** (`spawnLintBatches`): a cumulative split-time budget (`OXLINT_SPLIT_TOTAL_BUDGET_MS`, 3 min) and a recursion-depth cap (`OXLINT_SPLIT_MAX_DEPTH`, 8) now drop the remaining files of a pathological batch into the existing `onPartialFailure` / `skippedCheckReasons["lint:partial"]` channel instead of re-waiting a full spawn timeout at every split level.
- **Supply-chain check**: a whole-check cap (`SUPPLY_CHAIN_TOTAL_TIMEOUT_MS`, 90s) fails open (no diagnostics) on a many-socket pileup that ignores the per-fetch abort — the same fail-open contract the per-package lookup already had.
- **Dead-code & lint phases**: Effect-level caps (`REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS`, default 2.5 min; `REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS`, default 5 min) sit above the existing per-unit timeouts and fold a timeout into the existing skipped-check / lint-failure contracts so the rest of the scan still completes. On interruption the dead-code worker and any in-flight oxlint subprocesses are SIGKILL'd (the `AbortSignal` is threaded down to both), so the cap actually reclaims the work instead of leaving orphaned processes running.
- **Overall deadline**: `REACT_DOCTOR_SCAN_DEADLINE_MS` (default 15 min) backstops any phase not individually capped, raising the new `ScanDeadlineExceeded` reason on the `ReactDoctorError` union. It sits above the sum of the per-phase caps so a scan that legitimately uses those budgets degrades gracefully rather than hard-failing.

All four caps are env-tunable so the budgets can be raised without a redeploy. The defaults sit well above measured p95, so only the pathological tail is affected — no behavior change for normal scans.

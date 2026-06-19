---
"react-doctor": patch
---

Add a `--debug` flag that prints the run's Sentry trace id at the end of a scan.

When something looks wrong, run `react-doctor --debug`: it forces a Sentry performance trace for that run (even if `SENTRY_TRACES_SAMPLE_RATE` was turned down) and prints `Sentry trace (mention this when reporting): <id>` as the last line so the id can be pasted into a bug report for maintainers to pull the full trace. It prints on both outcomes — a clean run and a crash (the crash's trace is surfaced even when it happens before the scan span starts). The line goes to stderr, so `--json` / `--score` stdout stays machine-clean. Combining `--debug` with `--no-score` / `--no-telemetry` is rejected up front, since those flags disable the Sentry reporting `--debug` depends on. Telemetry also gains a low-cardinality `debug` run tag so adoption of the flag is visible.

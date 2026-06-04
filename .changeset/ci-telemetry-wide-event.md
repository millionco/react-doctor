---
"react-doctor": patch
---

react-doctor now records a single anonymized per-scan "wide event" on its Sentry run span — the full run/CI/project/outcome context (scan mode, score, diagnostics by severity and category, top rule, lint/dead-code state, and, in CI, the GitHub event, an official-action marker, the forwarded action inputs, and the pull-request gate) — so usage and CI behavior can be analyzed by querying spans instead of pre-aggregated counters.

It also mints a random per-run `runId` attached to the Sentry run context (never as a tag or metric dimension) to correlate the spans of a single run. Telemetry stays anonymized — no repo, owner, username, branch, or path is sent to Sentry — and `--no-score` / `--no-telemetry` still opts out entirely. The official GitHub Action forwards its inputs (fail-on, non-blocking, comment, annotations, version) so action configuration is visible in telemetry.

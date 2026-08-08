---
"react-doctor": patch
"@react-doctor/core": patch
---

Send traces and metrics to Axiom instead of Sentry. Sentry keeps crash reporting,
where its source-map symbolication, issue grouping, and quotable event ids have no
Axiom equivalent — so error reports are unchanged, and the JSON report's
`sentryEventId` field keeps its meaning.

Two user-visible changes: `--debug` now prints the run's Axiom trace id (crash
reports carry the same id as a tag, so one id resolves in both backends), and
`REACT_DOCTOR_NO_TELEMETRY` is now honored by the CLI as well as the language
server. `--no-score` and `--no-telemetry` are unchanged and still disable
everything.

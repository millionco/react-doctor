---
"react-doctor": patch
---

Respect `REACT_DOCTOR_NO_TELEMETRY` environment variable for score upload

The `REACT_DOCTOR_NO_TELEMETRY=1` environment variable now correctly suppresses the score API upload to `https://www.react.doctor/api/score`, matching the behavior of the `--no-telemetry` flag.

Previously, the env var only disabled Sentry and Axiom telemetry but not the score upload, which carries the most identifying data (repository owner/name, HEAD SHA, and diagnostic file paths). Now all three telemetry channels are consistently controlled by the environment variable.

---
"react-doctor": patch
---

Remove hardcoded Axiom ingest token from published package. First-party telemetry now requires `REACT_DOCTOR_AXIOM_TOKEN` environment variable to be set explicitly, removing the extractable credential from the npm tarball and making telemetry opt-in by default.

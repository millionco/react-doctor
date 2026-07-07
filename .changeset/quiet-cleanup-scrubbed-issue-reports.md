---
"react-doctor": patch
"deslop-js": patch
---

Scrub home-directory paths from the CLI's prefilled crash-report issue URL and body, matching the anonymization already applied to telemetry events. Also remove a dead deslop-js script-entry glob pass that scanned an empty pattern list on every run.

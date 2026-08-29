---
"react-doctor": patch
---

Fix GitHub Action false failures when npm exec pollutes JSON report with install messages.

When running on a cold cache, `npm exec` can print informational messages to stdout that corrupt the JSON report file. The action's `ensure-json-report.mjs` script now strips any leading non-JSON content before parsing, preventing false failures on clean scans.

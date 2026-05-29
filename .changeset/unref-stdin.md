---
"react-doctor": patch
---

Unref `process.stdin` at CLI startup so an inherited stdin pipe/socket can no longer keep the event loop alive after a scan completes. Previously `react-doctor --json` (and other one-shot runs) could finish the scan and flush the full report yet never exit when launched by a parent that holds the stdin write-end open (eval runners, CI harnesses, editor integrations) — Node kept the loop alive on the idle `Socket fd=0`. Interactive prompts are unaffected because `prompts`' `readline` interface re-refs stdin on demand.

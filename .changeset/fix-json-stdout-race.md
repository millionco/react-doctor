---
"react-doctor": patch
---

fix(cli): use synchronous stdout write for JSON reports to prevent truncation race (#1242)

The CLI now uses `fs.writeSync(1, ...)` instead of `process.stdout.write()` when outputting JSON reports to stdout. This eliminates an intermittent race condition where the process would exit before the async write completed, resulting in empty or truncated JSON output. The issue manifested as "react-doctor exited with status 0 before producing a JSON report" in the GitHub Action.

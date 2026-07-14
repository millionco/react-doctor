---
"react-doctor": patch
---

fix(action): write JSON report when --explain is used with --json

When the CLI is invoked with both --json and --explain (via the 'why' command), it would exit with status 0 after running the explain logic but without writing a JSON report. This caused the GitHub Action's ensure-json-report.mjs validation to fail with "react-doctor exited with status 0 before producing a JSON report."

The fix ensures an empty JSON report is written when JSON mode is active and the explain path is taken, allowing the Action to complete successfully.

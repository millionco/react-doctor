---
"react-doctor": patch
---

Show a syntax-highlighted source snippet in `react-doctor why <file>:<line>`.

The `buildCodeFrame` util already powers the source frames in the scan summary, but the `why` command (the single-location explain path) never called it — so explaining a diagnostic printed the rule, category, help, and suppression hint with no view of the offending code. It now renders the same code frame directly under the headline, with the caret on the offending column (or the whole line span for a multi-site diagnostic). When the file can't be read or the line is minified, it falls back to the existing text-only output.

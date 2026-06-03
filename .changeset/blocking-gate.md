---
"react-doctor": minor
"@react-doctor/core": minor
---

Rename the CI gate to `blocking` and post inline PR review comments.

- **`fail-on` is renamed to `blocking`** (CLI `--blocking <level>`, config `blocking`, GitHub Action `blocking` input). Same `error | warning | none` values, default `error` — a scan fails CI when an `"error"`-severity diagnostic reaches the `ciFailure` surface; `warning` blocks on any diagnostic, `none` keeps the scan advisory (always exits 0). `--fail-on` / `failOn` still work as a deprecated alias and emit a one-time warning.
- **The GitHub Action posts inline review comments instead of annotations.** The `annotations` input was removed; the Action now leaves real, dedup'd PR review comments anchored to the changed lines that triggered each diagnostic.
- **Action defaults updated:** `project` now defaults to `"*"` (explicitly "scan every discovered project"), and `node-version` defaults to `24`.

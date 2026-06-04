---
"react-doctor": minor
"@react-doctor/core": minor
---

Report only the issues a pull request **introduces** (Codecov-style baseline diff).

In `--diff <base>` mode, react-doctor now runs a second lint pass over the changed files as they existed at the base's merge-base and reports only the diagnostics the change introduced — pre-existing findings that merely shifted lines are matched out by a content fingerprint (`file + rule + flagged-line hash`), so a line insert above an existing issue no longer surfaces it as new. The head project-health **score is unchanged**; the gate (`--blocking`) fails on newly-introduced errors only.

- **New core API:** `computeDiagnosticDelta` (drift-robust new/fixed matcher), `Git.showRefContent` / `Git.mergeBase`, `materializeSourceTree` (shared base/staged tree builder), and `InspectOptions.baseline` / `InspectResult.baselineDelta`.
- **JSON report v2:** baseline runs emit `schemaVersion: 2` with a `baseline` block (`newCount`, `fixedCount`, `baseTotalCount`) and `mode: "baseline"`; `diagnostics` / `summary` counts are the introduced findings, `summary.score` stays the head score. v1 reports are unchanged.
- **GitHub Action:** on pull requests, fetches the base commit and reports a Codecov-style delta — a sticky summary with the new / fixed counts and inline review comments on the introduced findings. Use `fetch-depth: 0` on `actions/checkout` for reliable baselining; without enough history it falls back to reporting all findings in the changed files. New `fixed-issues` output.

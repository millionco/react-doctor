---
"react-doctor": minor
"@react-doctor/core": minor
---

Rework CI reporting: a renamed `blocking` gate, PR-introduced-issues-only baselines, inline PR review comments, and a simpler CLI flag surface.

**CI gate**

- **`fail-on` is renamed to `blocking`** (CLI `--blocking <level>`, config `blocking`, GitHub Action `blocking` input). Same `error | warning | none` values, default `error`: a scan fails CI when an `error`-severity diagnostic reaches the `ciFailure` surface; `warning` blocks on any diagnostic; `none` stays advisory (always exits 0). `--fail-on` / `failOn` still work as a deprecated, warned alias hidden from `--help`.
- `--blocking warning` now wins over `--no-warnings` (it previously silently no-op'd the gate — you can't block on warnings you've hidden).

**Baseline — report only the issues a PR introduces (Codecov-style)**

- In `--diff <base>` mode, react-doctor runs a second lint pass over the changed files as they existed at the base merge-base and reports only the diagnostics the change introduced; pre-existing findings that merely shifted lines are matched out by a content fingerprint (`file + rule + flagged-line hash`). The head project-health **score is unchanged**; the gate fails on newly-introduced errors only. If the baseline can't be computed (base unreachable, or a lint pass failed), the run degrades to a plain diff — all findings stay visible and CI isn't gated on findings whose new-vs-pre-existing attribution is unknown.
- **New core API:** `computeDiagnosticDelta`, `Git.showRefContent` / `Git.mergeBase`, `materializeSourceTree`, and `InspectOptions.baseline` / `InspectResult.baselineDelta`.
- **JSON report v2:** baseline runs emit `schemaVersion: 2` with a `baseline` block (`newCount`, `fixedCount`, `baseTotalCount`) and `mode: "baseline"`; `summary.score` stays the head score. v1 reports are unchanged.

**GitHub Action**

- Posts **inline PR review comments** on the changed lines that triggered each diagnostic (with fix guidance + a docs link), plus a restyled CLI-style sticky summary with linkable findings and the new / fixed delta. The `annotations` input was removed.
- On pull requests it fetches the base commit for baselining — use `fetch-depth: 0` on `actions/checkout`. New `fixed-issues` output. Defaults: `project: "*"`, `node-version: 24`.

**CLI flags (fewer flags, fewer footguns)**

- `--explain` / `--why` → the `react-doctor why <file>:<line>` subcommand (`rules explain <rule>` still explains what a rule means).
- Removed `--full` (use `--diff false` to force a full scan), `--pr-comment` (the Action renders its comment from `--json`), and the positive `--respect-inline-disables` (already the default; use `--no-respect-inline-disables` for audit mode). The internal `--changed-files-from` is hidden from `--help`.
- Removed flags now fail with a migration error instead of being silently dropped, and an empty `--project` filter (e.g. `--project ","`) is rejected.

---
"react-doctor": patch
---

Surface when a compare (PR-introduced-issues) scan couldn't reach the base and fell back to reporting every issue in the changed files.

- The JSON report now carries `baselineDegraded: true` (schemaVersion 1) when a `changed`-scope run intended a baseline comparison but couldn't compute it — most often a shallow CI checkout with no merge base. Previously the run silently degraded to a plain diff with no signal in the report or the PR comment.
- The scaffolded GitHub Actions workflow (`react-doctor ci install` / `install`) now checks out with `fetch-depth: 0`, so PR runs have the full history needed to find the merge base and report only the issues the PR introduces instead of all pre-existing ones.

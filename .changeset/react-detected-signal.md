---
"react-doctor": patch
---

Surface when a scan target had no discoverable React project, so a gated-off run can't pass for a clean one.

- The JSON report now carries `reactDetected: false` (additive optional field on schemaVersion 1 and 2) when no scanned project resolved a React or Preact runtime — the case where every React-runtime rule family gates off and the report would otherwise be byte-indistinguishable from a genuinely clean scan. It's `true` when any project resolved a runtime, and absent when nothing was scanned or the run errored. Consumers gating on the report (CI, verifiers, pre-commit hooks) should treat `reactDetected === false` as "wrong scan target", not "all clear"; per-project detail is already available via `projects[].project.reactVersion` / `preactVersion`.
- The CLI prints a stderr warning in the same case: "No React project detected at <path> — React rules were gated off; this is not the same as a clean scan."
- The programmatic API mirrors the signal: `diagnose()` results carry `reactDetected` (`DiagnoseResult.reactDetected`, per-project on `ProjectResultOk`, aggregate on `DiagnoseProjectsResult` — absent when no project scanned successfully), and the `hasReactRuntime(project)` predicate is exported from `react-doctor/api` and `@react-doctor/api`.

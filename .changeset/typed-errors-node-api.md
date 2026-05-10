---
"react-doctor": minor
---

Add typed error classes to the programmatic node API. `react-doctor/api`
now exports `ReactDoctorError` (base class), `ProjectNotFoundError`,
`NoReactDependencyError`, `PackageJsonNotFoundError`,
`AmbiguousProjectError`, and an `isReactDoctorError(value)` type-guard
helper.

`diagnose()` now throws these typed errors instead of plain `Error`
instances, letting callers branch on `instanceof` (or `error.name`)
without parsing message strings. Each error exposes the offending
`directory` as a property for structured handling.

`diagnose()` also no longer silently picks the first nested React
subproject when the requested directory has no root `package.json` and
contains multiple React subprojects. Single-subproject auto-resolution
is preserved (the original Vercel AI Code Review fix), but the
ambiguous case now throws `AmbiguousProjectError` with a `candidates`
array so callers can disambiguate explicitly. The CLI is unaffected —
it continues to use `selectProjects` for prompt-or-scan-all behavior.

---
"react-doctor": minor
---

Add typed error classes to the programmatic node API. `react-doctor/api`
now exports `ReactDoctorError` (base class), `ProjectNotFoundError`,
`NoReactDependencyError`, `PackageJsonNotFoundError`, and an
`isReactDoctorError(value)` type-guard helper.

`diagnose()` now throws these typed errors instead of plain `Error`
instances, letting callers branch on `instanceof` (or `error.name`)
without parsing message strings. Each error also exposes the offending
`directory` as a property for structured handling.

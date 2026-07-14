---
"@react-doctor/core": patch
"react-doctor": patch
---

Improve lint timeout error message to guide users on increasing the timeout

When lint analysis exceeds the 300s timeout on large projects, the error message now includes guidance about the `REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS` environment variable and suggests a concrete value to try. This addresses user confusion when encountering timeouts after TypeScript upgrades or on large codebases (~7000+ files).

Example new message: "Lint analysis exceeded 300s and was skipped. For large projects, increase the timeout: REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS=600000 (or higher)."

Closes #1267

---
"react-doctor": patch
---

Add opt-in crash reporting to Better Stack (via the Sentry SDK). Set `REACT_DOCTOR_ERROR_REPORTING=1` to send unhandled CLI errors; nothing is reported otherwise and `@sentry/node` is never even loaded. Reports are enriched with non-source context (CI provider, coding agent, command, platform, and where the error originated) to aid debugging. Releases upload source maps to Better Stack (matched by debug ID, not shipped in the npm tarball) so reported stack traces de-minify to the original TypeScript.

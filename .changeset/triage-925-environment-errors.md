---
"react-doctor": patch
---

Stop reporting unactionable environment errors to Sentry. A narrow set of filesystem conditions react-doctor cannot fix — a full disk (`ENOSPC`), a failing or read-only disk (`EIO`/`EROFS`), denied permissions (`EACCES`/`EPERM`), a path blocked by a file (`ENOTDIR`), or a missing binary (`spawn … ENOENT`) — now exit cleanly with an actionable message instead of crashing with a stack trace and appearing as product defects in Sentry. The set is deliberately narrow: codes that usually indicate a react-doctor bug (a missing file we expected, or an over-long argv such as `ENAMETOOLONG`) keep reaching Sentry. A low-cardinality `cli.env_error` metric, keyed by code, tracks how often these occur without inflating the crash dashboard. Closes REACT-DOCTOR-13, REACT-DOCTOR-1V, REACT-DOCTOR-24.

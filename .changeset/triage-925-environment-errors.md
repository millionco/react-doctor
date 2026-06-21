---
"react-doctor": patch
---

Stop reporting environment errors (ENOSPC, EIO, EACCES) to Sentry. Filesystem and spawn failures caused by disk-full, I/O errors, or permission denial are user-environment issues react-doctor cannot fix — they now exit cleanly with an actionable message instead of crashing with a stack trace and appearing as product defects in Sentry. A low-cardinality `cli.env_error` metric tracks how often these occur without inflating the crash dashboard. Closes REACT-DOCTOR-13, REACT-DOCTOR-1V, REACT-DOCTOR-24.

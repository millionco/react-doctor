---
"react-doctor": patch
"@react-doctor/core": patch
---

Degrade gracefully when git is unavailable or diff base ref is missing (fixes REACT-DOCTOR-F, REACT-DOCTOR-1K, REACT-DOCTOR-14, REACT-DOCTOR-22). CI containers without git installed and shallow clones missing the diff base ref now fall back to a full scan with a clear warning instead of crashing and reporting to Sentry.

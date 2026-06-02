---
"react-doctor": patch
---

react-doctor no longer crashes when `git` isn't installed.

During a normal scan, diff auto-detection reads the current branch first. When the `git` binary couldn't be spawned (e.g. a bare container with no git on `PATH`), that best-effort read threw instead of degrading, crashing the scan and reporting an environment issue to Sentry (REACT-DOCTOR-F). It now degrades to "unknown branch" — matching how a non-zero `git` exit was already handled — so the scan continues without git context.

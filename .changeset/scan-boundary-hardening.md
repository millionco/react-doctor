---
"react-doctor": patch
---

Snapshot adopted lint configs without executable plugins or out-of-repository config chains. Prevent Browserslist module loading during browser detection and compiler linting, reject symlinked audit-backup paths, remove source context and dependency metadata from crash reports, preserve lint-cache hash field boundaries, and pass source paths after the lint command option separator. Keep files whose names start with two dots eligible for scanning.

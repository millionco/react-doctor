---
"react-doctor": patch
---

react-doctor no longer crashes when a directory can't be enumerated during project discovery.

The recursive subproject crawl reads directories best-effort and already skipped ones it couldn't open for permission or missing-path reasons (`EACCES`/`EPERM`/`ENOENT`/`ENOTDIR`). It now also skips directories the underlying filesystem rejects outright — `EINVAL` on `scandir` (REACT-DOCTOR-N, seen on special/virtual mounts), plus symlink loops (`ELOOP`) and over-long paths (`ENAMETOOLONG`) — instead of throwing and reporting the environment issue to Sentry. The crawl continues past the unreadable directory.

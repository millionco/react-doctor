---
"react-doctor": patch
---

Update the dead-code analysis engine (`deslop-js`) to `0.0.14` so the published CLI's unused-file / dead-code detection runs on the latest release. The CLI previously pinned `^0.0.13` while the internal core engine was already on `0.0.14`; this aligns both on a single version and drops the duplicate from the lockfile.

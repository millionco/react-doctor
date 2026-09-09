---
"react-doctor": patch
---

Skip source files that Git still tracks but that no longer exist in the working tree (for example a deleted root `index.html` in a TanStack Start app) instead of failing the scan with `ENOENT` while preparing lint sources.

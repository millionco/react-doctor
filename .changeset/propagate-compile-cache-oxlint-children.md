---
"@react-doctor/core": patch
---

Propagate `NODE_COMPILE_CACHE` to oxlint batch subprocesses so repeated child processes can reuse warm V8 bytecode when available. This is a small internal lint performance improvement. Opt out with `NODE_DISABLE_COMPILE_CACHE=1`.

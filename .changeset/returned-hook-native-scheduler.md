---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Report calls to a directly imported factory-returned React callback inside a state updater when its immediate body clears a private timer handle and schedules a native timeout.

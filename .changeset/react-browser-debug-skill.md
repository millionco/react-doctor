---
"react-doctor": minor
---

Add the `browser` and `debug` commands behind the unified `/react-doctor` skill. `browser` drives a real Chrome over CDP (attaching to your running session, launching a dedicated persistent profile only as a fallback) for accessibility audits, console/network capture, performance traces with React DevTools profiling, snapshots, and screenshots. `debug` runs an NDJSON logging server the debug job posts runtime evidence to.

---
"react-doctor": minor
---

Add the `browser`, `debug`, and `mcp` commands behind the unified `/react-doctor` skill. `browser` drives a real Chrome over CDP (attaching to your running session, launching a dedicated persistent profile only as a fallback) for accessibility audits, console/network capture, performance traces with React DevTools profiling, snapshots, and screenshots. `debug` runs an NDJSON logging server the debug job posts runtime evidence to. `mcp` runs a Model Context Protocol server over stdio that exposes the doctor scan and the browser/debug jobs as MCP tools, so any MCP-capable agent can run `react-doctor mcp` and call `doctor_scan`, the `browser_*` tools, and the `debug_*` log server directly.

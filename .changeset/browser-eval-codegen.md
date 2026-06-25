---
"react-doctor": patch
---

Add `--codegen` to `browser eval` (and `codegen: true` to the `browser_eval` MCP tool): drive a Playwright expression as usual, then write it as a runnable Playwright regression test. The generated spec navigates to the page the session is on, replays the action, and asserts no console or page errors fired — the same signal `eval` already reports — so a verified interaction becomes a guarded test in one step. Writes to `--out` (default `react-doctor.spec.ts`); a failing action throws instead of writing a green-looking test.

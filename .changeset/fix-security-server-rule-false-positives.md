---
"oxlint-plugin-react-doctor": patch
---

Fix false positives in two rules (#838, #839).

- `agent-tool-capability-risk` / `mcp-tool-capability-risk` (#838): capability
  keywords are now matched in code only. Words inside a tool's `description`
  string (e.g. "ALWAYS fetch the underlying numbers first") and the AI-SDK
  `execute:` handler key no longer satisfy the dangerous-capability gate. A
  handler that actually calls `exec`/`fetch`/`readFile`/etc. still fires.

- `server-sequential-independent-await` (#839): declared-name collection now
  recurses into nested destructuring patterns, so
  `const [{ slug }, { isEnabled }] = await Promise.all(...)` followed by an
  `await` that reads `slug`/`isEnabled` is correctly treated as dependent and
  not flagged as a waterfall.

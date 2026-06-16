---
"oxlint-plugin-react-doctor": patch
---

Fix false positives in three rules (#838, #837, #839).

- `agent-tool-capability-risk` / `mcp-tool-capability-risk` (#838): capability
  keywords are now matched in code only. Words inside a tool's `description`
  string (e.g. "ALWAYS fetch the underlying numbers first") and the AI-SDK
  `execute:` handler key no longer satisfy the dangerous-capability gate. A
  handler that actually calls `exec`/`fetch`/`readFile`/etc. still fires.

- `url-prefilled-privileged-action` (#837): the validating-helper lookbehind now
  allows a member-access object between the helper call and the read, so
  `sanitizeAuthCallbackURL(url.searchParams.get("callbackURL"))` and
  `resolveSafeAuthCallbackURL(url.searchParams.get(...))` are recognized as
  validated and suppressed.

- `server-sequential-independent-await` (#839): declared-name collection now
  recurses into nested destructuring patterns, so
  `const [{ slug }, { isEnabled }] = await Promise.all(...)` followed by an
  `await` that reads `slug`/`isEnabled` is correctly treated as dependent and
  not flagged as a waterfall.

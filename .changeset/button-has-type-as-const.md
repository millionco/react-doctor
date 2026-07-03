---
"oxlint-plugin-react-doctor": patch
---

button-has-type: stop flagging `type` values wrapped in TS assertion expressions (`"submit" as const`, `satisfies`) — the wrapper is stripped before proving validity, so a local `const kind = "submit" as const` now resolves like the bare literal; invalid values under a wrapper stay flagged.

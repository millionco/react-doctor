---
"oxlint-plugin-react-doctor": patch
---

Fix server-after-nonblocking false positive for calls already wrapped in after()

The server-after-nonblocking rule no longer flags console.\* and analytics calls that are already wrapped in after() from next/server, which is the fix the rule itself prescribes. Closes #1313.

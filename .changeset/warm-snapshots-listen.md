---
"oxlint-plugin-react-doctor": patch
---

Add `valtio-no-snapshot-in-callback` to warn when deferred callbacks read Valtio snapshots and accidentally track callback-only fields as render dependencies.

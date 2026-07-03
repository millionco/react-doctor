---
"oxlint-plugin-react-doctor": patch
---

no-initialize-state: stop flagging mount effects that seed state from a zero-arg `new Date()` (e.g. an SSR-safe live clock's `setNow(new Date().toLocaleTimeString())`) — it captures the current instant like `Date.now()`, which was already exempt; `new Date(value)` stays flagged.

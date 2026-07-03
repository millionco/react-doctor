---
"oxlint-plugin-react-doctor": patch
---

no-array-index-as-key: stop flagging index keys when the mapped receiver is a variable holding a static placeholder array (`const list = Array.from({ length: 3 }); list.map(...)`) — the binding is now resolved to its initializer, matching the existing inline `Array.from({ length: N })` exemption.

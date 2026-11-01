---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Recognize synchronous derived-state writes through transparent local helpers that receive a React state setter. Preserve external, deferred, mutable, and independently editable state, including event writes through readonly setter aliases for direct and forwarded effect writes. Compare forwarded values with their existing state initializer.

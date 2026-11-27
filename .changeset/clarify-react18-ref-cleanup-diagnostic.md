---
"oxlint-plugin-react-doctor": patch
---

Clarify that React 18 ignores returned ref cleanup functions even when a callback detaches through the null path. Explain how to support React 18 without a cleanup return.

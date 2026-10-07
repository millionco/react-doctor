---
"oxlint-plugin-react-doctor": patch
---

A class render helper can receive indices from a numeric Array.from placeholder list. Accept these keys only when every visible use proves that placeholder source and the helper does not escape. Keep warnings for mutable data lists and unknown callers.

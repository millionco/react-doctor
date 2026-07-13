---
"oxlint-plugin-react-doctor": patch
---

Avoid rerender-memo-with-default-value false positives when a same-file React.memo comparator proves fresh empty defaults do not change its bailout.

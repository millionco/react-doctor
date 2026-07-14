---
"oxlint-plugin-react-doctor": patch
---

Fix `no-uncontrolled-input` false positives for input types whose `value` is read-only in React, including types behind deep const aliases and constant ternaries.

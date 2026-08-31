---
"oxlint-plugin-react-doctor": patch
---

fix: classify fragment returns of translation text as text-producing

Fragment returns mixing translation text elements (fbt/fbs) with literal text now classify correctly as text-producing components. The fragment is render-transparent, so both halves land in the caller's `<Text>`.

Fixes #1731

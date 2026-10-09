---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Match listener cleanup when both branches of conditional options have the same capture value. Keep warnings for differing capture values, changed options, and missing cleanup.

Recognize exhaustive listener-removal loops extracted into a synchronous helper when the cleanup only invokes that helper.

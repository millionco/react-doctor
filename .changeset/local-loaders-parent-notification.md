---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid parent-notification warnings when a local memoized loader only reads props and updates local state. Keep warnings for actual parent callback calls, including asynchronous and direct callback wrappers.

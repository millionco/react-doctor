---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid reporting fresh context values inside callbacks that a local helper replaces before invoking, including replacements in catch or finally after a synchronous throw from an awaited operand. Preserve warnings when replacement occurs only after asynchronous suspension.

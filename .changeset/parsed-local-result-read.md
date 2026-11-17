---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Detect unchecked property reads, simple destructuring, and terminal method calls on a const local JSON.parse result in the next statement.

Preserve runtime bindings hidden by erased TypeScript declarations and decline local-result analysis when global-object eval can rewrite JSON.parse.

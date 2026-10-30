---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Recognize timer cleanup published synchronously to a local disposer before an async effect task suspends.

Keep the cleanup warning when a named effect callback can register or escape another resource generation.

Preserve synchronous cleanup for statically dead callback references and closed reads of function metadata.

Recognize stored observer cleanup through local `const` arrow helpers that are called once and invoke cleanup synchronously.

Keep cleanup warnings when an async resource factory publishes a promise instead of a callable disposer.

Recognize synchronously published timer cleanup through closed local arrow helpers.

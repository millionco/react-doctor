---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `nextjs-no-side-effect-in-get-handler` when locally-built `Headers` object is passed to a same-file helper that mutates it.

The rule now transfers locally-created response object safety through the exact same-file helper call. Calls that pass external state to the same helper remain reportable.

Fixes #1757

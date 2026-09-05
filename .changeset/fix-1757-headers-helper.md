---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `nextjs-no-side-effect-in-get-handler` when locally-built `Headers` object is passed to a same-file helper that mutates it.

The rule now tracks when safe objects (like `new Headers()`) are passed as arguments to helpers, treating the corresponding parameters as safe when scanning the helper body.

Fixes #1757

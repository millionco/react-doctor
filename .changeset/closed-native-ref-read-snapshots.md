---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid state-after-await warnings for readonly scalar snapshots of a closed native ref counter when a synchronous native effect increments it before any other statement and every callback invocation follows that increment.

Preserve runtime React loader exposure checks when TypeScript-only ambient declarations erase the apparent loader binding.

Recognize erased type-only import equals bindings while preserving genuine local runtime values merged with interfaces.

Recognize empty and type-only namespaces without treating instantiated namespace values as native globals.

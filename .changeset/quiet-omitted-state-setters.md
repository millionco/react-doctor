---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Allow immutable value-only useState tuples with omitted setters while preserving value-pattern and setter-naming checks.

Keep runtime loader and provider exposure unsupported when TypeScript-only declarations erase their apparent local bindings.

Recognize erased type-only import equals bindings while preserving genuine local runtime values merged with interfaces.

Recognize empty and type-only namespaces without treating instantiated namespace values as native globals.

Recognize bounded numeric data indexing with closed callers and native window listeners while preserving runtime loader, provider mutation and callable extraction checks.

Reuse program-wide provider and numeric helper facts, and reject provider replacements through legacy accessor methods.

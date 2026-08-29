---
"oxlint-plugin-react-doctor": patch
---

fix(js-set-map-lookups): recognize *Message naming pattern as string-typed

The `js-set-map-lookups` rule was incorrectly flagging `String.prototype.includes()` calls on identifiers with the `*Message` naming pattern (e.g., `rawMessage`, `errorMessage`, `logMessage`) as array membership tests that should use Set/Map lookups. These are actually substring searches.

Added "Message" to `STRING_TYPED_IDENTIFIER_SUFFIXES` so the rule now recognizes this common string convention even without explicit type annotations.

---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix: prevent false positive in js-set-map-lookups for String().includes()

The rule now correctly recognizes `String(entry).includes(code)` as a substring search on the string returned by the global `String()` constructor, rather than flagging it as an inefficient array lookup. The fix adds a check to ensure that `String` refers to the global constructor and not a shadowed local variable.

Closes #1733

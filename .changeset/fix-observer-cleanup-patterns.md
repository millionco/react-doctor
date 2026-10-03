---
"oxlint-plugin-react-doctor": patch
---

fix(effect-needs-cleanup): accept observer cleanup for for-of loops and nested functions

Fixes false positives for two observer patterns:
- Observer with multiple `.observe()` calls inside a `for...of` loop, cleaned up with single `.disconnect()`
- Observer created/assigned inside an effect-invoked nested function, cleaned up at effect level

The rule now recognizes that calling `.disconnect()` on an observer cleans up ALL observations, so a single cleanup call is sufficient even when `.observe()` is called multiple times in a loop or from a nested function.

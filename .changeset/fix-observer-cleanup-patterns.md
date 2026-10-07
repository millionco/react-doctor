---
"oxlint-plugin-react-doctor": patch
---

fix(effect-needs-cleanup): accept observer cleanup for tuple-loop and retry patterns

Fixes false positives for two observer patterns:
- Observer with multiple `.observe()` calls inside a `for...of` loop, cleaned up with single `.disconnect()`
- Observer created/assigned inside an effect-invoked retry function (e.g., using `requestAnimationFrame`), cleaned up at effect level

The rule now correctly distinguishes between:
- Safe: observers created in synchronously-invoked functions or timer/scheduler callbacks
- Unsafe: observers created in functions passed to external APIs (MutationObserver constructor, scheduler registration)

This preserves the rule's ability to catch legitimate missing cleanup while eliminating false positives for controlled patterns.

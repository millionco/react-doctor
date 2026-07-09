---
"oxlint-plugin-react-doctor": patch
---

`rules-of-hooks` and `no-effect-event-in-deps` no longer apply React's effect-event semantics to a `useEffectEvent` that resolves to a userland definition. Previously only a same-named hook imported from a non-React package was exempt; a polyfill DEFINED in the same module (the floating-ui shape — a stable-callback helper designed to be stored, passed as props, and listed in deps) was still treated as React's export, which was the single largest false-positive source in the corpus audit. The called identifier is now resolved through scope analysis: local (non-import) bindings are exempt, React-runtime imports and bare globals (upstream fixture parity) keep firing at error severity.

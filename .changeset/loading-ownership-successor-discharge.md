---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Require loading ownership transfers to reset the flag or start a request with a matching rejection-safe finalizer. Keep warnings when a replacement only sets loading, exits before its protected request, or resets only on success.

Check successor parameter initialization and loading-transfer prefixes before accepting a reset. Preserve warnings for throwing getters, destructuring, iterators, coercion, reads before initialization, escaped ownership refs, and deferred async generators.

Do not treat numeric parameter defaults or destructuring fallbacks as proof that a finalizer prefix cannot throw.

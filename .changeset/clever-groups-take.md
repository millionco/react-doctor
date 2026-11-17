---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Qualify the `no-reset-all-state-on-prop-change` advice: use a key only when the entire subtree should remount. Keep the owner of state, requests, or subscriptions that must survive mounted and reset only the affected UI state.

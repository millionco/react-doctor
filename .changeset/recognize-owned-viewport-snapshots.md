---
"oxlint-plugin-react-doctor": patch
---

Recognize viewport state initialized from browser dimensions and refreshed only by its own resize listener in `no-chain-state-updates`. Preserve warnings when an application handler can also write the state or the listener receiver is ambiguous.

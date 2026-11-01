---
"oxlint-plugin-react-doctor": patch
---

Treat an effect cleanup that only reads a binding as empty. `return () => { value; }`, `return () => value` and `return () => void value` no longer silence `no-adjust-state-on-prop-change` and the other effect rules that skip effects with a cleanup. A cleanup that reads a member still counts, since the read can run a getter. `no-mirror-prop-effect`, `no-event-trigger-state`, `no-effect-event-handler`, `no-effect-chain` and `rendering-hydration-no-flicker` also no longer skip an effect that returns an empty or read-only cleanup.

---
"oxlint-plugin-react-doctor": patch
---

Treat an effect cleanup that only reads a binding as empty. `return () => { value; }`, `return () => value` and `return () => void value` no longer silence `no-adjust-state-on-prop-change` and the other effect rules that skip effects with a cleanup. A cleanup that reads a member still counts, since the read can run a getter.

---
"oxlint-plugin-react-doctor": patch
---

Treat an effect cleanup that only reads a proven local runtime binding as empty. `return () => { value; }`, `return () => value` and `return () => void value` no longer silence `no-adjust-state-on-prop-change` and the other effect rules that skip effects with a cleanup. Preserve cleanup exemptions for global identifiers and member reads that can run getters, and keep no-op filtering conservative in other rules.

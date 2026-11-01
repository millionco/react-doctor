---
"oxlint-plugin-react-doctor": patch
---

Treat an effect cleanup that only reads a proven local runtime binding as empty. Preserve cleanup exemptions for global identifiers and member reads that can run getters, and keep no-op filtering conservative in other rules. `no-mirror-prop-effect`, `no-event-trigger-state`, `no-effect-event-handler`, `no-effect-chain` and `rendering-hydration-no-flicker` also stop skipping effects with proven empty or read-only inline cleanups. Unknown cleanup factories and other effectful returns remain conservative.

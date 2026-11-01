---
"oxlint-plugin-react-doctor": patch
---

Stop treating an empty effect cleanup as a real one. `return () => {}`, `return () => undefined`, a `noop` binding, or `flag ? () => {} : undefined` no longer silences `no-adjust-state-on-prop-change`, `no-chain-state-updates`, `no-effect-event-handler`, `no-event-handler`, `no-pass-data-to-parent`, or the derived-state rules' cleanup-managed state check. Cleanups that do work, and `enabled ? subscribe() : () => {}`, still exempt the effect.

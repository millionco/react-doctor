---
"oxlint-plugin-react-doctor": patch
---

Stop treating an empty effect cleanup as a real one. `return () => {}`, `return () => undefined`, a direct `const` function binding, or `flag ? () => {} : undefined` no longer silences `no-adjust-state-on-prop-change`, `no-chain-state-updates`, `no-effect-event-handler`, `no-event-handler`, `no-pass-data-to-parent`, or the derived-state rules' cleanup-managed state check. Cleanups that do work during parameter evaluation and disposer calls opposite inline or named empty functions still exempt the effect. Mutable bindings and unproven callback factories retain the existing conservative exemption.

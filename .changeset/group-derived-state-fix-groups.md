---
"react-doctor": minor
---

Group findings that a single fix resolves into one root-cause task.

Several findings can share one fix — e.g. four `useEffect`s that reset state on the same prop change all clear with a single `key` prop. Those findings now carry a shared `fixGroupId` in the JSON report and the on-disk `diagnostics.json` dump, so a tool that turns findings into work items counts one fix as one task instead of N. The terminal labels such a group "One fix clears all N findings", and the agent handoff frames it as a single task ("one fix · N sites") and tells the agent to group by `fixGroupId`.

Grouping is presentation-only and keyed on identical (file, rule, message) for an allowlist of rules where the same message means the same fix — the state-on-prop-change family today (`no-derived-state-effect`, `no-adjust-state-on-prop-change`, `no-reset-all-state-on-prop-change`, and the `no-derived-state` / `no-derived-useState` rules). The score is unchanged — it already de-weights repeated same-rule findings and never reads the new field. `fixGroupId` is an additive optional field, so existing JSON consumers are unaffected.

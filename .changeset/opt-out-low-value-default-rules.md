---
"oxlint-plugin-react-doctor": minor
---

Demote 19 low-signal rules to opt-in (`defaultEnabled: false`) so the recommended preset focuses on correctness, performance, accessibility, and security instead of subjective style.

- Subjective design / house-style preferences (now opt-in): `no-gradient-text`, `no-dark-mode-glow`, `no-pure-black-background`, `no-side-tab-border`, `no-wide-letter-spacing`, `no-justified-text`, `no-z-index-9999`, `design-no-em-dash-in-jsx-text`, `design-no-three-period-ellipsis`, `design-no-vague-button-label`, `design-no-redundant-padding-axes`, `design-no-redundant-size-axes`, `design-no-space-on-flex-children`.
- Naming-convention preferences (now opt-in): `no-generic-handler-names`, `jsx-pascal-case`.
- Legacy class-component / PropTypes rules that don't fire in a modern function-component + TypeScript codebase (now opt-in): `prefer-es6-class`, `no-default-props`, `no-prop-types`.
- Deduplicated the array-index-key pair: `no-array-index-key` is now opt-in because it double-reported with the canonical `no-array-index-as-key` (Bugs category, friendlier message). Opt back into `no-array-index-key` only if you need its extra `React.cloneElement` coverage.

Every rule still ships in the plugin and can be re-enabled via `severityControls` / config, so teams that adopted any of these as a deliberate house style keep them with a one-line opt-in.

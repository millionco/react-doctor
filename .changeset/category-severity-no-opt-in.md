---
"react-doctor": patch
---

Fix category-level severities silently force-enabling opt-out rules. A config that only re-stamps category severities (e.g. `categories: { "Maintainability": "warn" }`) no longer activates `defaultEnabled: false` rules such as `forbid-component-props`, `react-in-jsx-scope`, `no-danger`, or `design-no-redundant-size-axes` in that category — enabling an opt-out rule now requires pinning the rule itself (or a legacy alias key) to `"warn"`/`"error"` under `rules`, matching the documented contract. Category severities still re-stamp the severity of already-enabled rules, and `react-doctor rules` now previews the same behavior.

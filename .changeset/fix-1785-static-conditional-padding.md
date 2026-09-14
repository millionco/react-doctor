---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `rn-scrollview-dynamic-padding` for conditionals with static branches.

The rule now recognizes ConditionalExpressions (ternaries) where both branches are static values (e.g., `hasHeader ? 0 : 16`). These are fundamentally different from truly dynamic values like `keyboardHeight` which can take unpredictable runtime values. A toggle between two fixed values is more predictable and less likely to cause the jarring "rows jump" behavior the rule is concerned about.

Fixes #1785

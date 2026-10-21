---
"oxlint-plugin-react-doctor": patch
---

Fix `effect-needs-cleanup` false positive when React Navigation `useNavigation()` result is renamed. The rule now correctly recognizes cleanup for `addListener` calls regardless of the receiver variable name, while preserving support for `navigation` props.

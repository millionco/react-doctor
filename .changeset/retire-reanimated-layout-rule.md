---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

React Doctor no longer reports `rn-animate-layout-property` for React Native Reanimated `useAnimatedStyle` layout styles.

The rule is now a retired compatibility stub: existing configs can still resolve the rule id, but it is default-off and emits no diagnostics. Reanimated supports animating layout-affecting styles on its animated style pipeline; while transform/opacity can still be preferable for purely visual movement, blanket-reporting every `width`, `height`, `padding`, or margin update as a bug produced false positives for valid UI-thread animations such as keyboard-driven layouts.

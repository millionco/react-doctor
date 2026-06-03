---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

React Doctor narrows `rn-animate-layout-property` for React Native Reanimated `useAnimatedStyle` layout styles.

The rule now reports only when a layout-affecting style is locally driven by Reanimated animation helpers such as `withTiming` or `withSpring`. It no longer blanket-reports `interpolate(...)`, shared-value reads, or other valid UI-thread layout updates such as keyboard-driven layouts.

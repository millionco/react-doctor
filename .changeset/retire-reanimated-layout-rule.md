---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Retires `rn-animate-layout-property`. Reanimated `useAnimatedStyle` runs entirely on the UI thread, so layout-affecting style animations driven by helpers like `withTiming` or `withSpring` are valid and should not be flagged.

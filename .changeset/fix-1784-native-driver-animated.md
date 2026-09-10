---
"oxlint-plugin-react-doctor": patch
---

Fix an `rn-prefer-reanimated` false positive on files whose `Animated` calls all run with `useNativeDriver: true`, while still flagging any JS-driven animation in the same file.

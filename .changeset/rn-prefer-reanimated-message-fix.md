---
"oxlint-plugin-react-doctor": patch
---

fix(rn-prefer-reanimated): soften message to conditional, mention useNativeDriver option

The rule was claiming definite JS-thread execution even when code uses `useNativeDriver: true` for native-thread animations. Changed to conditional framing and updated recommendation to mention both Reanimated and useNativeDriver options.

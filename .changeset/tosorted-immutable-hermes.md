---
"oxlint-plugin-react-doctor": patch
---

Stop `js-tosorted-immutable` from firing in React Native / Expo projects. Hermes (the default RN/Expo JS engine) hasn't shipped the ES2023 change-array-by-copy methods, so the rule's recommended `array.toSorted()` rewrite of `[...array].sort()` crashed at runtime with `TypeError: undefined is not a function`. The rule now carries `disabledBy: ["react-native"]`, so it only fires on projects whose engine supports `toSorted()`.

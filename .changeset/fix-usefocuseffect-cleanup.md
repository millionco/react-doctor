---
"oxlint-plugin-react-doctor": patch  
"react-doctor": patch
---

fix: recognize `useFocusEffect` and validate cleanup properly

Fixes false positives where named `useCallback` with proper cleanup passed to `useFocusEffect` were incorrectly flagged.

- Recognize `useFocusEffect` from `@react-navigation/native` and `expo-router` as cleanup-requiring effect hooks
- Exempt `useCallback` passed inline to effect hooks from retained leak analysis
- Exempt `useCallback` that returns cleanup functions

Closes #1897

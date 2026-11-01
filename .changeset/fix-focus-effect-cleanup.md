---
"oxlint-plugin-react-doctor": patch
---

Recognize `useFocusEffect` from Expo Router and React Navigation in `effect-needs-cleanup`. Accept returned cleanup from named and inline `useCallback` callbacks, and report missing cleanup in both forms. Resolve hook imports and callback aliases without suppressing leaks from callbacks also used as event handlers.

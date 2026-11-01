---
"oxlint-plugin-react-doctor": patch
---

Recognize `useFocusEffect` from Expo Router and React Navigation in `effect-needs-cleanup`. Accept returned cleanup from named and inline `useCallback` callbacks, and report missing cleanup in both forms. Resolve hook imports and callback aliases without suppressing leaks from callbacks also used as event handlers.

Limit nested timer-setup forwarding to proven focus owners and direct, synchronous forwarding shapes; retain conservative diagnostics across opaque operations and discarded cleanup.

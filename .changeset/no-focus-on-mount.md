---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Add the `no-focus-on-mount` state-and-effects rule. Calling `focus()` inside an empty-deps `useEffect` / `useLayoutEffect` runs on initial mount, where it can steal focus before the surrounding UI is actually ready (and surprise users who never interacted with the field). The rule flags a `.focus()` member call reached inside a mount effect whose dependency array is empty, while staying quiet on effects with a non-empty dependency array, effects with no dependency array, computed `["focus"]` access, and non-effect hooks. It steers users toward triggering focus from the user action that opens the UI or gating it on an explicit ready/open state. See #315.

---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Add the `no-focus-on-mount` state-and-effects rule. Calling `focus()` inside an empty-deps `useEffect` / `useLayoutEffect` runs on initial mount, where it can steal focus before the surrounding UI is actually ready (and surprise users who never interacted with the field). The rule flags a `.focus()` member call that executes during mount — directly in the effect body, inside an immediately-invoked function, or scheduled via `setTimeout` / `requestAnimationFrame` / other timers — while staying quiet when the focus is deferred to a later interaction: focus inside an event-listener/handler callback registered on mount, focus restored in the effect's cleanup, effects with a non-empty dependency array, effects with no dependency array, computed `["focus"]` access, and non-effect hooks. It steers users toward triggering focus from the user action that opens the UI or gating it on an explicit ready/open state. See #315.

---
"oxlint-plugin-react-doctor": patch
---

Add the `react-doctor/no-self-updating-effect` rule. It warns when a `useEffect` / `useLayoutEffect` lists a state value in its dependency array and the effect body unconditionally calls that state's own `useState` setter with a value that never settles — a functional updater (`setCount((value) => value + 1)`), a freshly-constructed reference (`setItems([])`, `setUser({ ...user })`), or a value derived from the same state (`setCount(count + 1)`). Every commit re-runs the effect and re-sets the state, causing a render loop that `exhaustive-deps` does not catch because the dependency array is already complete. The rule stays quiet on mount-only `[]` effects, setters deferred inside timer/subscription/promise callbacks, guarded updates, and plausibly-stable scalar writes that settle via `Object.is` (`setOpen(true)`, `setTab(props.tab)`). See #346.

---
"oxlint-plugin-react-doctor": patch
---

Add the `react-doctor/no-self-updating-effect` rule. It warns when a `useEffect` / `useLayoutEffect` lists a state value in its dependency array and the effect body unconditionally calls that state's own `useState` setter — a feedback loop where every commit re-runs the effect and re-sets the state, causing a render loop that `exhaustive-deps` does not catch (the dependency array is already complete). The rule stays quiet on mount-only `[]` effects, setters deferred inside timer/subscription/promise callbacks, guarded updates that can reach a fixed point, and primitive-literal writes that settle via `Object.is`. See #346.

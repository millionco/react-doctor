---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Cut false positives across the state-and-effects rule family while locking the true-positive shapes in with regression tests:

- `no-cascading-set-state` now counts setters per synchronous dispatch: deferred callbacks (timers, listeners, observers, promise continuations, subscriptions) no longer inflate the count on their own, but still compound when the effect also sets state synchronously; IIFE and synchronous-iteration (`forEach`/`map`/…) callbacks stay counted; statements after an unconditional `return`/`throw` are ignored, and early-return guard branches accumulate across re-runs.
- `no-chain-state-updates`, `no-event-handler`, `no-pass-live-state-to-parent`, and `no-prop-callback-in-effect` stay silent when the triggering state is externally driven — its setter is called exclusively from timers, listeners, observers, promise continuations, or subscriptions — since there is no React event handler to fold the work into.
- `no-derived-state` no longer flags a controlled-value mirror whose setter is also handed to a child as an `on*` JSX callback (`onChange={setValue}`): the state buffers the child's live edits.
- `no-direct-state-mutation` exempts state whose `useState` initializer provably constructs a class instance (`useState(new TrackQueue())` or a lazy initializer returning one) — an opaque imperative object, not render data.
- `no-pass-live-state-to-parent` and `no-prop-callback-in-effect` skip prop calls whose result flows into another call's argument (`setDisplay(format(amount))`) — a pure transform, not a parent hand-back — and `no-pass-live-state-to-parent` also skips functions returned by state-owning custom hooks.
- `rerender-functional-setstate` recognizes `debounce`/`throttle` wrappers as deferred execution.
- `rerender-state-only-in-handlers` no longer flags state that drives a side-effect-only `useEffect` dependency, feeds a render-phase hook call, or participates in React's adjust-state-while-rendering pattern. Effect reads are now resolved through binding scopes, so a local that shadows a state name neither hides nor fakes a read of the outer value.
- `no-initialize-state` only defers to a mount effect for measurement API calls (`window.matchMedia(...)`), not bare method references (`!!window.matchMedia`) or scalar reads (`window.innerWidth`).

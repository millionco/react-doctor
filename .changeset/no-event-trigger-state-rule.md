---
"react-doctor": minor
---

feat(react-doctor): add `no-event-trigger-state` rule

New rule (severity: `warn`) flagging the §6 anti-pattern from React's
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#sending-a-post-request)
guide:

```tsx
const [jsonToSubmit, setJsonToSubmit] = useState(null);
useEffect(() => {
  if (jsonToSubmit !== null) {
    post("/api/register", jsonToSubmit);
  }
}, [jsonToSubmit]);

function handleSubmit(event) {
  event.preventDefault();
  setJsonToSubmit({ firstName, lastName });
}
```

The state variable exists only to schedule an effect to run on click.
The fix is to call `post("/api/register", { firstName, lastName })`
directly inside `handleSubmit` and delete the state.

Detector pre-conditions (all four must hold) — chosen to keep
real-world false positives near zero:

1. `useEffect` with a single-identifier dep array, where the dep is a
   `useState` binding declared in this component.
2. effect body is exactly one `IfStatement` guarding on that state
   with one of: bare truthy, `!== null` / `!== undefined`,
   `=== Literal`, `.length`, or `!X`.
3. the `if`'s consequent contains a `CallExpression` whose callee is
   in a small allowlist (`fetch`, `post`, `navigate`,
   `showNotification`, `alert`, `track`, …) **or** a
   `MemberExpression` whose property is in another allowlist (`axios.post`,
   `router.push`, `analytics.track`, …).
4. every `setX(...)` call site in the component is inside a JSX
   `on*` handler (or a function bound to one) — i.e. the trigger is
   set only by user interactions.

(4) is the strongest signal that the state exists *only* to schedule
the effect, and is what distinguishes this rule from §5 (already
handled by the existing `no-effect-event-handler`).

The article's legitimate "analytics on mount" effect (`useEffect(() =>
post('/analytics/event', { eventName: 'visit_form' }), [])`) is not
flagged — it has empty deps, no trigger state, and runs because the
form was displayed.

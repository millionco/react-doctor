# React Audit Playbook

For any finding that maps to a React Doctor rule, never invent the fix. Copy the
reviewer-tested recipe from `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md`,
or run `npx react-doctor@latest rules explain <rule>`. The exact fix is not yours
to approximate; the canonical prompt is.

Use these five categories as the user-facing audit buckets. Judge leverage from
user impact and execution frequency, not from the rule's raw severity alone.
Confirm every finding at its `path:line`, and respect deliberate suppressions,
disabled rules, and documented tradeoffs.

## 1. Bugs & correctness

This category covers behavior that can render the wrong UI, lose state, create
stale data, or break React's rendering model. High leverage means a defect on a
shared route, a hot interaction, or a stateful list—not a theoretical issue in
dead or rarely reached code.

**Hunt for:**

- `no-array-index-as-key` — Array index used as a key; insertion and reordering
  can attach state to the wrong row.
- `no-random-key` — Random value used as a key; every render remounts the item.
- `jsx-key` — Missing key in list; React cannot reconcile siblings reliably.
- `exhaustive-deps` — Missing effect dependencies; closures observe stale state.
- `no-self-updating-effect` — Effect updates its own dependency; feedback loops.
- `no-set-state-in-render` — State update during render; render-loop risk.
- `no-uncontrolled-input` — Uncontrolled input value; controlled behavior drifts.
- `rendering-conditional-render` — Number before `&&` renders stray `0`.

**Beyond the scan:** Check async races, cancellation on unmount, state machines
with impossible transitions, optimistic updates that need rollback, and whether
an effect belongs in an event handler. Look for missing error and Suspense
boundaries around failure-prone or loading-sensitive subtrees.

## 2. Performance

This category covers work repeated in render, layout, the main thread, or the
network. Leverage is impact multiplied by frequency and fan-out: a per-keystroke
editor, provider, or 10,000-row list outranks the same pattern in a settings
dialog. Do not optimize cold paths merely because a rule can be satisfied.

**Hunt for:**

- `jsx-no-constructed-context-values` — Unstable context provider value; all
  consumers can re-render when the provider renders.
- `jsx-no-new-object-as-prop` — New object passed as a prop.
- `jsx-no-new-array-as-prop` — New array passed as a prop.
- `jsx-no-new-function-as-prop` — New function passed as a prop.
- `no-inline-prop-on-memo-component` — Inline prop defeats `memo()`.
- `rerender-dependencies` — Unstable value recreated every render.
- `no-layout-property-animation` — Animating a layout property.
- `no-transition-all` — `transition: all` animates unintended properties.

**Beyond the scan:** Profile before and after. Hunt context fan-out, expensive
selectors, waterfalls, cache misses, image and bundle costs, and work that can
move to a server or transition. Reject premature `useMemo`/`memo` on cold paths:
the optimization can be noise, add dependency hazards, and obscure code.

## 3. Accessibility

This category covers whether keyboard, screen-reader, zoom, and other assistive
technology users can discover and operate the interface. Leverage is highest on
primary navigation, forms, dialogs, and controls used in every session; verify
the semantic and interaction context rather than blindly silencing a rule.

**Hunt for:**

- `alt-text` — Image missing alt text.
- `control-has-associated-label` — Control missing accessible label.
- `click-events-have-key-events` — Click handler missing keyboard handler.
- `no-static-element-interactions` — Interaction on static element.
- `prefer-tag-over-role` — Role used instead of the native HTML tag.
- `no-autofocus` — Autofocus on an element.
- `no-outline-none` — `outline:none` removes the focus ring.
- `no-disabled-zoom` — Zoom disabled on the viewport.

**Beyond the scan:** Test the actual tab order, focus return after dialogs,
keyboard escape and roving focus, live-region announcements, loading and error
states, contrast in real themes, reduced motion, touch target size, and zoom at
200–400%. A valid static label can still be misleading in the product flow.

## 4. Security

This category covers code and configuration that lets attacker-controlled data
become code, authority, secrets, or an unsafe browser action. Leverage is
highest at trust boundaries: client/server transitions, auth, uploads, HTML
sinks, redirects, and privileged mutations. Trace the data, not just the
syntax.

**Hunt for:**

- `no-danger` — Raw HTML injection can run unsafe markup.
- `dangerous-html-sink` — HTML injection sink with dynamic content.
- `jsx-no-script-url` — `javascript:` URL in JSX.
- `jsx-no-target-blank` — Unsafe `target="_blank"` link for a declared legacy browser or Electron target.
- `no-eval` — `eval()` runs untrusted code strings.
- `no-secrets-in-client-code` — Secret in client code.
- `auth-token-in-web-storage` — Auth token in web storage.
- `untrusted-redirect-following` — Server fetch follows redirects for
  caller-shaped URL.

**Beyond the scan:** Verify authorization server-side, tenant isolation, CSRF
and origin checks, CSP and cookie flags, upload/content-type handling, rate
limits, dependency trust, and logging redaction. A sanitizer at one sink does
not make an untrusted value safe at another; follow it to its source and
privileged effect.

## 5. Maintainability & architecture

This category covers structures that make changes risky, conventions unclear,
and ownership or rendering behavior hard to reason about. Leverage means
repeated cost across a team or a component's centrality—not a preference for
abstraction or a low-risk style nit.

**Hunt for:**

- `no-giant-component` — Large component is hard to read and change.
- `no-nested-component-definition` — Component defined inside another component.
- `no-many-boolean-props` — Boolean prop combinations are hard to test.
- `prefer-module-scope-static-value` — Static value rebuilt every render.
- `prefer-module-scope-pure-function` — Pure function rebuilt every render.
- `no-event-handler` — Event logic handled in an effect.
- `no-mirror-prop-effect` — Prop mirrored into state via effect.
- `design-no-vague-button-label` — Vague button label.

**Beyond the scan:** Examine ownership boundaries, public component APIs,
context design, dependency direction, test seams, duplicated domain logic, and
whether abstractions communicate intent. Hunt missing error/Suspense boundaries,
overloaded providers, optimistic UI opportunities, and premature memoization.
Do not split a component or add a hook just to satisfy a metric.

## Working rule

The scan supplies evidence; the senior audit supplies leverage and context.
For every rule-backed plan, fetch the canonical prompt, quote the current code,
and inline the exact target recipe. For every missed opportunity, label it
separately from a diagnostic finding and state what runtime or product evidence
would confirm its value.

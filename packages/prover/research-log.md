# React prover research log

## 2026-07-28: initial proof kernel

### Objective

Build an exhaustive, whole-application React prover. The terminal theorem is:

```text
For every execution permitted by the modeled React runtime and every declared external contract,
the application preserves the React safety invariants.
```

A proof build has three outcomes:

- `proved`
- `refuted`
- `incomplete`

`incomplete` is a failed proof. Partial coverage must never be presented as application correctness.

### Product boundary

Job: a React developer needs deterministic evidence that an application obeys React semantics;
today they combine compiler diagnostics, lint rules, tests, and manual review.

Change: add a private `@react-doctor/prover` package that owns a proof report and fixture corpus.
Do not add a CLI flag, score input, or JSON report field until the proof model survives real-project
evaluation.

Reuse:

- React Doctor already contains closure capture, scope, path-coverage, cleanup, and cross-file
  dependency analyses.
- Those implementations are coupled to the oxlint ESTree rule runtime. The prover reuses their
  contracts and regression ideas, but owns a TypeScript project model and proof verdict rather than
  importing private rule internals.
- `truffler` searches for `prove react semantic graph`, `effect closure captured dependency`,
  `render purity mutation alias`, and `typescript program source project` found no existing
  application prover API.

Promotion metric: percentage of real applications for which every React-relevant region is either
proved or represented by an explicit contract. Do not promote a public command based only on
fixture pass rate.

Compatibility: private package, no current user-facing default, no score change, no report-schema
change, and no changeset.

Kill criterion: do not promote the package if two research iterations fail to produce source-level
counterexamples with materially lower false-positive rates than the existing rule suite, or if
closed-world coverage remains too low for representative applications.

### Evidence reviewed

#### React specification surface

- [Rules of React](https://react.dev/reference/rules) defines purity, immutable props/state/hook
  inputs, React-owned component invocation, and hook call restrictions.
- [useEffect](https://react.dev/reference/react/useEffect) defines reactive dependencies and the
  setup, cleanup, rerun, unmount, and Strict Mode stress-test lifecycle.
- The HTML Standard defines timers as active handles removed by
  [`clearTimeout`/`clearInterval`](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-cleartimeout)
  and animation-frame callbacks as handles removed by
  [`cancelAnimationFrame`](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-cancelanimationframe).
  These are ownership transitions, not merely paired API names.
- [Lifecycle of Reactive Effects](https://react.dev/learn/lifecycle-of-reactive-effects) frames
  each Effect as an independent synchronization process whose setup and cleanup may repeat.
- [StrictMode](https://react.dev/reference/react/StrictMode) deliberately runs an extra
  setup-cleanup-setup cycle in development. Async ownership must therefore survive immediate
  invalidation even when a dependency tuple is empty.
- The same `useEffect` reference defines an infinite cycle as an effect state update whose resulting
  render changes one of that effect's dependencies. Dependency comparison uses `Object.is`;
  omitting the tuple reruns after every commit, while `[]` bounds setup to mount lifecycle cycles.
- [rules-of-hooks](https://react.dev/reference/eslint-plugin-react-hooks/lints/rules-of-hooks)
  states that hook order must be identical across renders.
- [purity](https://react.dev/reference/eslint-plugin-react-hooks/lints/purity) supplies canonical
  non-idempotent render examples including `Math.random()` and `Date.now()`.
- [useEffectEvent](https://react.dev/reference/react/useEffectEvent) defines Effect Events as local
  effect logic that reads the latest committed props and state. They may only be used by Effects or
  other Effect Events, must not escape through components or Hooks, must not appear in dependency
  tuples, and intentionally receive a new identity on every render.
- [useContext](https://react.dev/reference/react/useContext) defines context lookup by the closest
  matching provider above the consumer. A provider returned by the same component does not affect
  that component's own read, and provider/consumer context objects must be exactly identical.
- [createContext](https://react.dev/reference/react/createContext) defines the default value as a
  static fallback used only when no matching provider exists above the consumer.
- [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) requires
  `subscribe` to register React's callback and return cleanup, repeated `getSnapshot` calls to
  remain `Object.is`-stable until the store changes, and `getServerSnapshot` to return the same
  initial data during server rendering and client hydration.

#### React Compiler

- `/home/aidenybai/Developer/react/compiler/packages/babel-plugin-react-compiler/docs/passes/README.md`
  defines HIR as a control-flow graph in SSA form.
- `/home/aidenybai/Developer/react/compiler/packages/babel-plugin-react-compiler/src/Entrypoint/Pipeline.ts`
  exposes the sequence from HIR lowering through mutation/alias effects and reactive-place
  inference.
- `/home/aidenybai/Developer/react/compiler/packages/babel-plugin-react-compiler/src/Entrypoint/Options.ts`
  exposes `debugLogIRs`, which can support a pinned feasibility adapter.
- The durable integration must be a versioned semantic snapshot, not retained mutable HIR objects
  or parsed debug strings.

#### Existing React Doctor semantics

- `packages/oxlint-plugin-react-doctor/src/plugin/semantic/control-flow-graph.ts`
- `packages/oxlint-plugin-react-doctor/src/plugin/semantic/closure-captures.ts`
- `packages/oxlint-plugin-react-doctor/src/plugin/semantic/scope-analysis.ts`
- `packages/oxlint-plugin-react-doctor/src/plugin/utils/collect-returned-cleanup-functions.ts`
- `packages/oxlint-plugin-react-doctor/src/plugin/utils/do-nodes-cover-every-path-from-function-entry.ts`

The current CFG answers targeted guaranteed-execution questions. It is not an SSA or lifecycle
model and must not become the whole-app proof substrate.

#### Proof-system influences

- [FreeRange](https://github.com/chenglou/freerange) uses the official TypeScript API, lowers a
  constrained subset, propagates abstract values through control flow, and separates `requires`,
  `assumes`, `proves`, and `unsupported`. The prover adopts the same rule that unsupported syntax
  is a proof failure, never an implicit pass.
- [Making Referential Stability a Type](https://www.jovidecroock.com/blog/referential-stability-types/)
  distinguishes stability across unrelated renders from immutability or permanent identity.
  A future `Stable<Value>` contract should be phantom evidence with explicit invalidation, not a
  claim that React can never discard a memoized value. User casts cannot manufacture proof.
- [Foldkit](https://foldkit.dev/) separates immutable model updates, commands, subscriptions, and
  managed resource lifetimes. Its useful React-prover contribution is the explicit transition and
  ownership boundary, not a replacement UI architecture.
- Pretext's prepare/layout split and browser-calibrated oracle reinforce a broader method: keep a
  small deterministic semantic core, then validate selected extracted facts against the real
  runtime without confusing an oracle with a proof.

#### Realistic examples

- `/home/aidenybai/Developer/react-bench-internal/tasks/fix-react-coreui-coreui-react-470`
  contains a CoreUI listener-leak task. Its verifier checks that rerenders do not accumulate
  listeners and unmount removes listeners with the same callback identity and registration
  options.
- The `coreui-listener-leak` fixture preserves the essential failure: setup and cleanup contain
  textually identical inline callbacks that are different function identities.
- The Playwright runtime oracle demonstrates the leak after unmount and the symmetric cleanup
  behavior in Chromium.
- `/home/aidenybai/Developer/react-bench-internal/tasks/fix-react-rdh-hacker0x01-react-datepicker-calendar`
  contains an imperative month-list loop whose original key was derived from the loop index. Its
  repair derives identity from the represented year and month. The `datepicker-loop-index-key`
  fixture preserves the original loop-and-push shape rather than reducing it to `array.map`.
- A second Playwright oracle types local state into one list item, reverses the list, and shows the
  state moving to the wrong item under index keys while semantic keys preserve the state owner.
- React issue [#34818](https://github.com/facebook/react/issues/34818) is a realistic stale-value
  failure crossing `memo`, context, and `useEffectEvent`. The Playwright corpus reproduces the bug
  against pinned `react@19.2.5`: the memoized consumer renders the updated context, but the Effect
  Event still observes the old value. Static proofs for that topology therefore remain incomplete
  even though the source obeys the documented API contract.
- `/home/aidenybai/Developer/react-bench-internal/tasks/write-react-xr843-fojin-775/tests/harness/src/react-i18next-mock.ts`
  implements a language store with `useSyncExternalStore`: a module snapshot, listener `Set`,
  symmetric cleanup, and notification after every language write. The `proved-external-store`
  fixture preserves that protocol.
- The saturated opencode React port uses browser-media callbacks, version stores, toast stores, and
  object-method session stores with `useSyncExternalStore`; its media-query hook supplies distinct
  subscribe, client snapshot, and server snapshot callbacks. The callback-prop fixtures preserve
  the adapter-component variant where those three functions cross a render edge before reaching
  React.
- `/home/aidenybai/Developer/react-bench-internal/tasks/write-react-docusaurus-tabs-11733`
  requires every tab consumer to bind to its nearest Tabs provider while nested tab sets remain
  isolated. The context fixtures preserve cross-file aliases, nested overrides, default fallback,
  and distinct context-object identity. Playwright confirms both nearest-provider isolation and
  the default-value result when a structurally identical but distinct context is consumed.
- React Bench tasks `write-react-glific-glific-frontend-3981`,
  `write-react-eren23-openflipbook-72`, `write-react-tracecathq-tracecat-2879`, and
  `fix-react-rdh-sofn-xyz-mailing-settings` all contain async work whose completion can outlive the
  Effect instance that started it. They motivate an ownership theorem rather than a special-case
  fetch warning.
- `write-react-eren23-openflipbook-72` invokes an optional `onLocalize` callback from a local event
  handler, then tracks both synchronous throws and Promise settlement against an AbortController.
  `write-react-tombelieber-claude-view-70` routes a `respond` callback through `runRespond` and
  several memoized handlers before passing those handlers to child cards. These are realistic
  evidence that callable values need argument, prop, return, and async-lifetime flow rather than
  name-based handler detection.
- `fix-react-igordanchenko-yet-another-react-lightbox-slideshowcontext` combines a custom
  `useEventCallback` wrapper with subscription callbacks. It is the boundary case for the next
  layer: a source-level wrapper can be summarized, while an imported wrapper needs an explicit
  library proof contract.
- `write-react-radix-context-menu-controlled-open` defines `whenTouchOrPen`, a plain function that
  returns an event closure and conditionally invokes its captured handler. The returned-handler
  fixture preserves that higher-order shape.
- `write-react-obbyworld-obby-206` returns a `useCallback` closure directly from a custom Hook, and
  `write-react-cloudscape-design-components-4612` changes a returned ref getter to a stable
  `useCallback`. Together they separate source-level returned closure flow from the stronger
  temporal theorem required for ref-backed callback freshness.
- `migrate-react-opencode-solid-to-react-components` implements `useDefaultServerKey` with three
  control-flow exits that all return a cleanup closure. The branch-cleanup fixture preserves this
  realistic Effect shape and exercises the same structured return summary as callback factories.
- `migrate-react-opencode-solid-to-react-timeline-rendering` implements `renderTimelineRow` as a
  switch over the finite `row._tag` discriminant, with each case returning a distinct JSX shape.
  `migrate-react-opencode-solid-to-react-dialogs-settings` uses the same pattern for an
  `Action["type"]` reducer, while `migrate-react-opencode-solid-to-react-components` has a
  default-covered updater-state switch. These examples establish both useful switch proof modes:
  checked literal-union coverage and a syntactic default.
- `migrate-react-opencode-solid-to-react-home-layout-sidebar` parses deep links with a value return
  from `try` and an empty return from `catch`; the saturated port's `readStoredLocale` has the same
  storage/JSON fallback shape. The global-sync queue also uses a `return` in `finally` deliberately
  to override earlier exits when paused. Conversely, prompt submission catches, rolls back, and
  rethrows. Together these require distinct normal, returned, and thrown completion facts rather
  than treating every abrupt exit as equivalent.
- The saturated opencode port's `cachePrune` uses `for (;;)` with two conditional returns and a
  cache-size descent argument, while its health check and global-sync queue use `while (true)` with
  conditional exits. Those loops are not terminal on their first iteration; proving them requires
  a ranking function or an external timeout/cancellation theorem, so they remain incomplete.
  Event-bus notification also iterates fresh spread snapshots such as `[...listeners]`; a spread
  source needs an iterator contract and is deliberately not treated like a fixed fresh literal.
- The same port's toast, file-tree, view-cache, child-store, and event-bus implementations invoke
  callback-valued `listener` iteration bindings. This motivates an SSA join for the binding itself,
  not only a loop-exit summary. For a `const` identifier over a nonempty fresh literal, the prover
  now joins every element's callable abstract value before resolving `return listener` or
  `listener()`.
- The port also contains pervasive tuple iteration such as `for (const [key, item] of entries)` in
  `utils/server-scope.ts`, `for (const [, node] of nodes)` in line-comment annotations, and nested
  object iteration in generated layout data. The callable lattice now represents array indexes as
  properties and projects a finite literal join through nested object/tuple binding paths. Binding
  defaults, rest elements, computed keys, mutable declarations, and opaque or spread iterables
  still fail closed.
- React Bench sources also contain the ordinary wrapper shape everywhere: the opencode file tree
  uses `onClick={() => props.onFileClick?.(node)}`, its list component invokes
  `props.onSelect?.(item, index)` from local handlers, and `solid-dnd.tsx` adapts drag event props
  through inline closures. A direct prop edge is therefore insufficient. Event proof now resolves
  callback props captured by local and transitively called wrapper handlers back through every
  project render site, then records the eventual source callback call in the event phase.
- React's [passing props](https://react.dev/learn/passing-props-to-a-component) guide explicitly
  teaches whole-object forwarding with `<Avatar {...props} />`. TypeScript's
  [JSX handbook](https://www.typescriptlang.org/docs/handbook/jsx) type-checks spread operands
  against the target attribute type. The React Bench Radix context-menu task repeatedly removes a
  scope prop into a parameter rest binding and forwards the remaining object into a primitive.
  Those are proof-relevant edges, not decorative syntax.
- JSX property sources are ordered. A later explicit callback replaces a callback from an earlier
  spread, while a later spread can replace an explicit callback. The callback graph now computes
  one effective source per property and render site. Whole component-props parameters, parameter
  rest bindings, finite non-escaping local `const` object literals, and intrinsic event spreads are
  modeled. Shorthand object properties resolve through TypeScript's shorthand value symbol rather
  than the property declaration symbol. The shared write collector treats direct assignment,
  property/element assignment, increments, loop targets, and `delete` as writes. String/number
  index signatures, unconstrained type parameters, getters, mutated or escaping objects,
  unresolved nested prop objects, and object-literal spread merges still fail closed. A Playwright
  oracle confirms both precedence directions in React 19.2.5.
- React's [`useRef`](https://react.dev/reference/react/useRef) contract says the initial value is
  ignored after the first render, the ref object is stable, and render-phase reads or writes are
  generally forbidden. [`useLayoutEffect`](https://react.dev/reference/react/useLayoutEffect)
  runs after commit but before repaint, whereas [`useEffect`](https://react.dev/reference/react/useEffect)
  may run after the browser paints. React's own Effect Event implementation updates its callback
  payload in the before-mutation or mutation phase
  ([hooks](https://github.com/facebook/react/blob/9ceb1e7d9e20bd0302cf6ab31b038c5ec673178d/packages/react-reconciler/src/ReactFiberHooks.js),
  [commit](https://github.com/facebook/react/blob/9ceb1e7d9e20bd0302cf6ab31b038c5ec673178d/packages/react-reconciler/src/ReactFiberCommitWork.js)),
  which is a stronger primitive than a passive userland ref update.
- Real libraries implement several distinct userland protocols. Yet Another React Lightbox uses a
  client layout-effect alias and `useCallback`; MUI uses an enhanced layout effect and a stable
  wrapper ref; Radix uses passive `useEffect` plus `useMemo`
  ([Lightbox source](https://github.com/igordanchenko/yet-another-react-lightbox/blob/189830b19c0ed95370a485433f754b64aa09df04/src/hooks/useEventCallback.ts),
  [MUI source](https://github.com/mui/material-ui/blob/7fb01101f45fb72fdbeb3d826984030583e71ea9/packages/mui-utils/src/useEventCallback/useEventCallback.ts),
  [Radix source](https://github.com/radix-ui/primitives/blob/e1646bd74289e9de2ef8506204adec33c820876f/packages/react/use-callback-ref/src/use-callback-ref.tsx)).
  The prover does not trust those names. It checks the ref declaration, the sole `.current` write,
  dependency coverage, non-escape, wrapper return flow, and the concrete React execution phase.
  A Chromium oracle updates a callback and programmatically clicks during the same component's
  later layout effect: the layout-synchronized protocol observes revision 1, while the passive
  protocol still invokes revision 0.
- `/home/aidenybai/Developer/react-bench-internal/tasks/fix-react-formidablelabs-victory-victory-animation`
  guards delayed animation work by generation and clears the exact timeout handle; its unmount
  verifier requires the animation not to complete after ownership ends.
  `/home/aidenybai/Developer/react-bench-internal/tasks/write-react-tombelieber-claude-view-70`
  supplies the ordinary interval setup/cleanup lifecycle. In contrast,
  `/home/aidenybai/Developer/react-bench-internal/tasks/fix-react-floating-ui-floating-ui-2914`
  schedules a timeout from an event and
  `/home/aidenybai/Developer/react-bench-internal/tasks/write-react-radix-context-menu-controlled-open`
  stores long-press timeout ownership in a ref across event handlers. Those event-owned protocols
  must remain incomplete until the graph models their state machine.

### Current proof model

The package creates one `ts.Program` rooted at the requested application `tsconfig.json`. Parent
config discovery is forbidden. Every TypeScript error becomes project evidence and makes the proof
incomplete. Strict mode is required, and `any`, unchecked assertions, non-null assertions,
suppression comments, and JavaScript sources invalidate the proof boundary.

Every report now carries a versioned `ReactSemanticGraph`. The graph is deliberately independent
of TypeScript AST node classes and records stable source-based IDs for units, custom-hook and
builtin-hook calls, cross-module JSX render edges, and effect dependency, capture, callback, and
cleanup facts. Context definitions, provider instances, consumer reads, and the provider stack
active at each render edge are also explicit graph facts. Async task facts link `await` and Promise
continuations to their owning Effect and record state writes plus guarded, unguarded, or unknown
ownership. The graph also records every source-resolved project helper reachable from
render, event, memo, reducer, Effect setup, Effect cleanup, Effect Event, and external-store
callbacks, together with its root callback, execution phase, and conditional reachability. When a
helper is reachable by both conditional and unconditional paths, the graph retains the stronger
unconditional fact. Effect resource and state-transition obligations traverse the same call graph,
so a helper or object method cannot hide listener acquisition, disposal, or a state write. Proof
obligations and graph extraction share the symbol-resolved collectors. A React Compiler adapter can
therefore replace individual fact producers without changing the report contract or proof
consumers.

The graph records the call edges that justify helper reachability. Direct source calls,
source callbacks invoked through formal parameters or captured factory parameters, object-property
invocations, and callbacks passed to known synchronous iteration methods are distinct facts with
source and target function IDs, execution phase, conditional reachability, and the relevant
parameter, argument, or property path. Callable arguments can be forwarded through several source
helpers. A callable parameter that is stored or passed to an opaque/async registration boundary
makes `boundary-coverage` unknown instead of inheriting the caller's phase.

Callable values now form a finite abstract-value lattice. A value contains possible source
functions, captured callable bindings, named object properties, conditionality, and a completeness
bit. The evaluator resolves aliases, object literals, object arguments, local property reads,
destructuring, `useCallback`, and source factories with expression or exhaustive structured branch
returns. Property projection inherits the containing object's completeness, and a destructuring
default retains its known fallback target without claiming that the fallback is always selected.
Returned closures retain the factory environment, allowing a Radix-style handler adapter
or a custom Hook returning `useCallback` to carry its source callback into the eventual React event
phase. A shared return summary proves sequential early returns and nested exhaustive `if/else`
paths while marking each alternative target conditional. It also proves switches only when every
clause terminates without fallthrough and coverage comes from a `default` clause or the TypeScript
checker can enumerate a finite literal union matched by the cases. Exception summaries preserve
normal, returned, and explicitly thrown completions: catch branches are always considered
reachable, caught throws are discharged, rethrows escape, and a `finally` return overrides prior
returns while a normally completing `finally` preserves them. Loop summaries prove literal-false
zero-iteration paths, bodies that terminate on their first entered iteration, one-pass
`do...while (false)`, and finite fresh array literals without spreads. An unranked repeating body,
`break`/`continue`, spread or opaque iterables, grouped or fallthrough switch clauses,
non-exhaustive switches, unresolved callable arguments, and mutable callable properties remain
explicit failed proofs. Layout-synchronized callable refs are the narrow exception: the evaluator
joins their initializer and sole effect-written value and carries that target through
`ref.current()` only when the source protocol is complete. A `const` binding iterating a nonempty fresh
literal is additionally bound to the join of its callable elements. Identifier, object, tuple, and
nested object/tuple paths can therefore carry returned or directly invoked loop callbacks into the
phase graph. Defaults, rest elements, computed keys, mutable declarations, and incomplete
containers reject completeness.

Render-purity mutation ownership is evaluated relative to each reachable helper, not only the root
component. Rebinding a helper-local variable is unobservable and therefore allowed. Mutating a
parameter, captured value, or local alias whose initializer is not a fresh array, object, or
instance remains an observable input mutation. The mutable-iteration fixture keeps purity proved
while callable flow is unknown; the aliased-prop fixture independently guards the external-alias
counterexample.

Phase-aware proof follows callback props through project component render edges. An intrinsic event
attribute or a callback-prop invocation from Effect setup or cleanup creates a required channel;
destructured props, renamed bindings, object-parameter property reads, prop-name changes across
several components, and local or transitive wrappers are resolved backward to every source
callback. Captured prop bindings are injected into the wrapper's callable environment, so
subsequent calls retain the requesting phase. The graph records each intrinsic event binding,
every required component prop edge with its phase, and the wrapper-to-source call. A computed
expression, missing render site, imported component, or cycle leaves the channel incomplete.
Finite typed spreads are accepted only for source-resolved whole-props, parameter-rest, or
non-escaping local `const` object values. JSX sources are folded left to right, and only the last
source of each property contributes callbacks. The independent checker rejects complete channels
without a source callback in the same phase. A callback prop invocation is discharged only when a
complete prop channel and a call fact in that phase agree at the exact source location.

Effect callback props require an additional transition guard. A source callback that writes its
own component state can rerender that source component, create a fresh callback identity, change
the child Effect dependency, and schedule the Effect again. Callback facts therefore record direct
and project-helper state writes. The current model fails this case closed pending an
identity-stability and cross-component rerender fixpoint proof; a source callback with no state
writes can be proved in Effect setup or cleanup.

Callable refs have a separate temporal certificate. A complete fact requires one local `const`
`useRef` initialized from the same callback symbol written to `.current`, exactly one simple write
inside `useLayoutEffect`, dependency coverage or an omitted dependency tuple, no escape or
non-call read, and at least one concrete event-phase invocation. Generic `useCallback` and
`useMemo` wrappers both preserve the factory environment into the event graph. Passive
`useEffect`, multiple writes, render access, unresolved aliases, imported effect wrappers, and
non-event invocation channels remain `unknown`. The independent checker requires a complete fact
to name the layout update and an event callback whose graph contains the corresponding
`ref.current` call edge.

Platform schedulers inside Effects have a first-class lifetime certificate. Timer, interval,
animation-frame, idle-callback, immediate, and microtask registrations are symbol-checked against
platform declaration files so project functions that merely share those names are not trusted.
Each fact links the registration to its owning Effect and setup callback, resolves the registered
function into the deferred execution phase, propagates its reachable project calls, and records
the exact cancellation locations. Completeness currently requires an immutable local `const`
handle, unconditional registration, a source-resolved synchronous callback, and every possible
Effect cleanup return to begin with cancellation of that exact handle. Conditional cancellation,
an earlier cleanup return, mutable or property handles, microtasks, nested scheduling, `await`, and
Promise continuations fail closed. Schedulers outside Effects are rejected by boundary coverage
until an event-lifetime or external owner protocol exists.

`useSyncExternalStore` arguments use the same project callback lattice but terminate in three
distinct protocol channels: subscription lifetime, client render snapshot, and server-render
snapshot. The graph stores callback sets and completeness independently for all three and
links each callback-prop flow to its certified JSX render fact.
External-store consistency resolves the source functions from those certified callback IDs before
checking symmetric cleanup, cached snapshot identity, store-write notification, and hydration
agreement. When separate JSX branches supply different store adapters, callbacks are grouped by
render ID and each protocol variant is checked against its own subscription registry. The
independent checker requires every cross-unit callback ID to be justified by a complete
phase-matched prop flow whose render ID names a real render edge with the same owner and target.
For conditional expressions whose condition is a source-resolved identifier, the callable lattice
adds the condition symbol and branch polarity to every target. Those guards participate in target
identity, survive aliases and component-prop forwarding, and are serialized as guarded callback
alternatives. The external-store proof correlates channels only when every guarded channel exposes
the same finite assignment partition; a singleton unguarded callback may act as a
variant-independent source. Different condition symbols, mixed guarded and unguarded joins,
duplicate assignments within one expression, and opaque conditions remain incomplete. Reversing
callback choices under the same guard does not hide a defect: it creates the real crossed protocol
variants, which are checked and refuted when snapshot writes notify the wrong registry.
At ordinary call-return boundaries, callee-local guards are removed. Identifier arguments are
instead substituted into scalar parameter guards, including composed `!` polarity through nested
source calls. The substitution requires a declaration-backed symbol with no assignment,
increment/decrement, or loop-binding writes in its source file. This proves conditional callback
factories when every channel receives the same caller guard, keeps different caller guards
incomplete, and rejects a guard written between JSX attributes. Other scalar expressions and
property-access conditions remain incomplete.

That guard exposed three earlier overclaims: the ignore-flag, AbortController, and Promise-chain
fixtures prove ownership of their post-suspension state writes, but each invokes a loader callback
supplied through component props. They are now incomplete application proofs with a separately
proved async-ownership obligation. A valid local lifetime proof cannot stand in for an external
function-effect contract.

Callbacks carry an explicit execution phase: render, server render, deferred callback, user event,
reducer state transition, effect setup, effect cleanup, Effect Event, or external-store
subscription. Effects link directly to their setup and cleanup callback IDs. Effect Events record
their latest-value callback and intentionally unstable identity. This prevents later lifecycle
rules from applying render constraints to event code or treating cleanup and non-reactive effect
logic as ordinary nested syntax.

Component and custom-hook entry functions are explicit render callbacks. Source-resolved calls and
synchronous iteration callbacks such as `map`, `filter`, and `reduce` inherit that render phase.
The event collector searches those reachable render functions, so an event handler returned from a
list callback is represented without treating the event body itself as render code. Callback IDs
include their owning React unit because one module-level function can participate in multiple
component lifecycles.

Effect Event ownership is checked transitively through project helpers. Cleanup callbacks count as
part of the owning Effect lifecycle, while a helper reachable from both Effect logic and a JSX
event remains invalid because one represented execution phase can invoke it outside the Effect.
Named `useMemo` and `useState` factories are resolved before render-purity analysis, closing a gap
where an impure project helper could previously hide behind a callback identifier. The pinned
React Compiler still requires an inline `useMemo` factory, so such source can be statically refuted
by an obligation even while the compiler facts independently remain incomplete.

React Compiler facts are collected through its public `logger.debugLogIRs` option at the
`InferReactivePlaces` phase. The compiler mutates one HIR object throughout the pipeline, so the
adapter normalizes facts synchronously during the callback. It records basic blocks,
predecessors/successors, terminals, instruction value kinds, lvalue effects, and reactive-place
flags. Compilation uses React Compiler's `infer` mode, so ordinary store and domain functions are
not incorrectly treated as components. Compiler skips and errors for inferred React functions
become project evidence and prevent a `proved` result. A compiler fork is therefore unnecessary
for CFG extraction today; a fork would only be justified if the logger contract disappears or
required facts are never exposed at any named phase.

The prototype uses Babel 8 to drive the React Compiler plugin because the repository's
no-trust-downgrade policy rejects Babel 7's unattested `semver@6.3.1` dependency. That makes the
private package's current development/runtime floor Node 22.18. This is an explicit prototype
constraint, not a proposed React Doctor CLI requirement.

Discovered React units currently include:

- Uppercase, default-exported, and `memo`/`forwardRef`-wrapped function components, including
  components that return `null`
- Custom hooks named with the `use` convention
- Symbol-resolved `Component` and `PureComponent` classes with conservative construction,
  lifecycle, state-transition, and state-ownership certificates

Each discovered unit receives these obligations:

| Claim                         | Current evidence                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `async-effect-ownership`      | Post-`await` and Promise-continuation commits, cleanup invalidation, abort guards           |
| `callable-ref-freshness`      | Initial value, exclusive effect write, commit timing, non-escape, concrete event channels   |
| `class-construction`          | State initialization, field purity, superclass ordering, repeat-safe construction           |
| `class-state-transitions`     | State ownership, updater purity, lifecycle phase, bounded update convergence                |
| `hook-order`                  | Conditional, looped, nested, and post-early-return hook positions                           |
| `hook-ownership`              | Module, helper, method, and anonymous-callback hook calls without a valid React owner       |
| `hook-state-transitions`      | Setter identity, callback ownership, direct values, replay-safe functional updaters         |
| `context-topology`            | Exact object identity, defaults, provider values, nested overrides, render/hook propagation |
| `render-purity`               | State writes, input mutation, known non-idempotence, transitive local helpers, opaque calls |
| `effect-dependencies`         | Symbol-resolved reactive captures versus inline dependency tuples                           |
| `effect-cleanup`              | Transitive listener/resource acquisition, identity symmetry, and conditional helper paths   |
| `effect-state-updates`        | Transitive writes, mount bounds, local-rerender stability, and unknown fixpoints            |
| `effect-event-usage`          | Local Effect ownership, non-escape, dependency exclusion, intentionally unstable identity   |
| `external-store-consistency`  | Stable snapshots, symmetric subscriptions, write notification, hydration agreement          |
| `action-state`                | Reducer Action identity, dispatcher ownership, Form/Transition Action execution roots       |
| `form-actions`                | Intrinsic form/submitter semantics, callback identity, form association, Action phase       |
| `form-status`                 | Parent-form ancestry, same-component exclusion, mixed render paths, composed uncertainty    |
| `memo-dependencies`           | `useMemo` and `useCallback` captures versus inline dependency tuples                        |
| `optimistic-state`            | Reducer/updater purity, setter identity, render exclusion, Form/Transition Action ownership |
| `reconciliation-identity`     | Missing, duplicate, index-derived, and unconstrained dynamic list keys                      |
| `reducer-purity`              | Reducer and reducer-initializer transition purity                                           |
| `ref-access`                  | Render-phase access to refs created by `useRef`                                             |
| `scheduled-callback-lifetime` | Effect ownership, deferred callback resolution, exact handles, guaranteed cancellation      |
| `transition-actions`          | Starter identity, Action ownership/phase, synchrony, direct controlled-input state          |
| `component-identity`          | Component definitions created during another render                                         |
| `component-invocation`        | Source-resolved component functions called outside reconciliation                           |
| `boundary-coverage`           | Opaque modules, dynamic code, unsupported hooks, and unmodeled event callbacks              |

Application status is derived globally:

```text
any violated obligation              => refuted
otherwise any unknown/project error  => incomplete
otherwise                            => proved
```

### Fixture corpus

Proved:

- `proved-chat`
- `proved-local-graph`
- `proved-timer`
- `proved-custom-hook`
- `proved-cfg`
- `proved-memo`
- `proved-reducer`
- `proved-context`
- `proved-context-topology`
- `proved-context-identity`
- `proved-wrapped-component`
- `proved-null-component`
- `proved-default-component`
- `proved-aliased-hook`
- `proved-static-list-keys`
- `proved-mount-state-update`
- `proved-external-store`
- `proved-external-store-callback-props`
- `proved-external-store-callback-prop-spread`
- `proved-external-store-conditional-props`
- `proved-external-store-conditional-factory`
- `proved-external-store-render-branch-props`
- `proved-effect-event`
- `event-handler-boundary`
- `proved-helper-effect-cleanup`
- `proved-conditional-helper-effect-cleanup`
- `proved-shared-event-handler`
- `proved-event-callback-parameter`
- `proved-event-prop-flow`
- `proved-forwarded-event-prop`
- `proved-event-prop-spread`
- `proved-rest-event-prop-spread`
- `proved-intrinsic-event-prop-spread`
- `proved-jsx-spread-trailing-explicit-event`
- `proved-jsx-spread-trailing-spread-event`
- `proved-effect-callback-prop`
- `proved-cleanup-callback-prop`
- `proved-mixed-phase-callback-prop`
- `proved-event-prop-wrapper`
- `proved-transitive-event-prop-wrapper`
- `proved-returned-event-handler`
- `proved-object-callback-flow`
- `proved-returned-use-callback-hook`
- `proved-local-object-callback`
- `proved-conditional-handler-factory`
- `proved-switch-handler-factory`
- `proved-try-catch-handler-factory`
- `proved-finally-overrides-handler`
- `proved-while-handler-factory`
- `proved-for-of-handler-factory`
- `proved-for-of-invoked-handlers`
- `proved-for-of-object-binding-handler`
- `proved-for-of-tuple-binding-handler`
- `proved-for-of-nested-binding-handler`
- `proved-helper-local-rebinding`
- `proved-branch-effect-cleanup`
- `proved-layout-ref-backed-event-callback`
- `proved-layout-ref-backed-memo-event-callback`
- `proved-window-timeout`
- `proved-animation-frame`
- `proved-aliased-window-timeout`
- `proved-shadowed-timeout`
- `class-component`
- `proved-pure-class-render`
- `proved-class-listener`
- `proved-class-timeout`

Refuted:

- `conditional-hook`
- `stale-effect`
- `impure-render`
- `cleanup-mismatch`
- `coreui-listener-leak`
- `nested-component`
- `direct-component-call`
- `render-ref-access`
- `state-update-in-render`
- `prop-mutation`
- `helper-aliased-prop-mutation`
- `transitive-impure-helper`
- `timer-leak`
- `impure-reducer`
- `aliased-stale-effect`
- `use-in-try`
- `missing-list-key`
- `duplicate-list-key`
- `effect-self-cycle`
- `fresh-external-store-snapshot`
- `fresh-external-store-callback-prop-snapshot`
- `silent-external-store-write`
- `silent-external-store-render-branch-props`
- `mismatched-server-snapshot`
- `mismatched-external-store-callback-prop-server-snapshot`
- `mismatched-external-store-conditional-props`
- `mismatched-external-store-conditional-factory`
- `external-store-cleanup-mismatch`
- `effect-event-dependency`
- `effect-event-render-call`
- `effect-event-prop-escape`
- `effect-event-hook-escape`
- `memo-callback`
- `invalid-hook-helper`
- `module-hook-call`
- `anonymous-hook-callback`
- `context-provider-missing-value`
- `async-effect-stale-write`
- `async-effect-promise-chain`
- `helper-effect-listener-leak`
- `method-effect-listener-leak`
- `named-memo-impure-helper`
- `effect-event-shared-helper`
- `render-callback-parameter-impurity`
- `callback-parameter-effect-listener-leak`
- `render-returned-callback-impurity`
- `object-callback-effect-listener-leak`
- `branch-returned-render-impurity`
- `switch-returned-render-impurity`
- `try-catch-returned-render-impurity`
- `finally-returned-render-impurity`
- `while-returned-render-impurity`
- `for-of-returned-render-impurity`
- `for-of-invoked-render-impurity`
- `for-of-destructured-render-impurity`
- `refuted-layout-ref-missing-dependency`
- `refuted-timer-partial-cleanup`
- `class-render-impurity`
- `class-listener-leak`
- `class-listener-capture-mismatch`
- `class-timeout-leak`

Incomplete:

- `opaque-render-call`
- `effect-state-update`
- `unsafe-types`
- `path-dependent-cleanup`
- `conditional-use`
- `index-list-key`
- `datepicker-loop-index-key`
- `compiler-bailout`
- `effect-event-memo-context`
- `effect-event-opaque-registration`
- `external-context`
- `async-effect-opaque-guard`
- `async-effect-opaque-continuation`
- `async-effect-post-await-mutation`
- `async-effect-path-dependent-invalidation`
- `helper-effect-state-update`
- `external-store-helper-boundary`
- `incomplete-external-store-callback-prop-conditional-join`
- `incomplete-external-store-conditional-factory`
- `incomplete-external-store-mutated-conditional-props`
- `mapped-event-handler`
- `callback-parameter-opaque-registration`
- `incomplete-jsx-spread-leading-explicit-event`
- `incomplete-jsx-spread-open-ended-event`
- `incomplete-jsx-spread-mutated-object`
- `incomplete-effect-callback-prop-state-cycle`
- `incomplete-defaulted-event-prop-wrapper`
- `incomplete-computed-event-prop-wrapper`
- `incomplete-local-object-callback-spread`
- `incomplete-async-effect-ignore-contract`
- `incomplete-async-effect-abort-contract`
- `incomplete-async-effect-promise-ignore-contract`
- `incomplete-object-callback-spread`
- `incomplete-partial-handler-factory`
- `incomplete-switch-fallthrough-handler-factory`
- `incomplete-switch-uncovered-handler-factory`
- `incomplete-try-catch-handler-factory`
- `incomplete-while-handler-factory`
- `incomplete-for-of-spread-handler-factory`
- `incomplete-for-of-mutable-handler`
- `incomplete-for-of-defaulted-handler`
- `incomplete-for-of-rest-binding-handler`
- `incomplete-for-of-computed-binding-handler`
- `incomplete-ref-backed-event-callback`
- `incomplete-layout-ref-escaped-event-callback`
- `incomplete-layout-ref-multiple-write-event-callback`
- `incomplete-mutable-object-callback`
- `incomplete-event-timeout`
- `incomplete-mutable-timer-handle`
- `incomplete-conditional-timer-cancellation`
- `incomplete-early-return-timer-cleanup`
- `incomplete-timer-async-continuation`
- `incomplete-timer-floating-promise`
- `incomplete-effect-microtask`
- `incomplete-nested-timeout`
- missing project configuration

### Soundness ledger

The current package is a proof-kernel scaffold, not yet the terminal exhaustive React proof.
`proved` currently quantifies over the implemented obligations and supported subset.

Known regions that must force `incomplete` until modeled:

- Async work outside directly invoked Effect-local async functions and direct
  `.then`/`.catch`/`.finally` continuations
- Async ownership of non-state external side effects without a checked function summary
- Callback flow through open-ended, nested, escaping, module-owned, mutated, getter-backed, or
  unresolved JSX spread objects; computed/defaulted prop expressions; mutated/computed object
  fields; logical aliases crossing opaque registries; grouped switch cases; fallthrough clauses;
  or non-finite switch discriminants
- Callable factories with unranked repeating loops, `break`/`continue`, iterable spreads, or
  iterator values that lack a checked finiteness and mutation contract; mutable, defaulted, rest,
  and computed iteration bindings also lack an SSA write summary
- Implicit synchronous exceptions from calls and property operations without checked throw
  contracts; catch branches are over-approximated, but uncaught expression throws are not yet a
  whole-project obligation
- Passive, multiply written, escaping, imported-wrapper, or non-event callable-ref protocols
- Event-owned, ref-owned, custom, and opaque schedulers; scheduler callbacks that create nested,
  awaited, or Promise-continuation work; and exception paths between acquisition and cleanup
- Phase-polymorphic callbacks crossing opaque library or Promise registration contracts
- Context propagation through opaque library components, portals, and externally mounted exports
- Effect Event registration APIs beyond directly modeled timers, browser listeners, subscriptions,
  and emitter `on`/`once` contracts
- Mutable-object external-store snapshots requiring cache summaries, selectors, or third-party
  store contracts
- Async Transition ordering, deferred values, optimistic state, form Actions, and transition state
  flow beyond direct local `useState` controls
- Suspense and abandoned render behavior
- Reconciliation outside direct arrays, map callbacks, and imperative `for`-loop list construction
- Component tree position and state preservation outside represented list identities
- Server Components, client boundaries, hydration, and serialization
- Class constructors, derived state, snapshots, error boundaries, refs, `shouldComponentUpdate`,
  commit callbacks, helper-mediated state writes, state-to-instance convergence, and
  state-transition fixpoints outside direct mount/update ownership and prop-history guards
- Effect transition fixpoints beyond mount-bounded writes and unconditional boolean/fresh-reference
  self-cycles
- Library hooks without semantic summaries

Before accepting a proof, the coverage scanner must also reject React calls outside discovered
components and hooks, including hooks hidden in incorrectly named helper functions.

### Next architecture

1. Add callable SSA joins for ranked loops, mutable/defaulted/rest/computed iteration bindings,
   switch fallthrough and grouped cases, property writes, open-ended/nested JSX and object spreads,
   and checked library contracts, including synchronous throw summaries, Promise continuations,
   and user-defined registration APIs.
2. Replace syntax-level hook and path checks with SSA CFG obligations and checked function
   summaries.
3. Introduce a formal lifecycle machine for render, commit, effect setup, cleanup, event,
   suspension, interruption, and unmount.
4. Add reconciliation state for component type, key, position, hook slots, refs, and effect
   instances.
5. Extend the independent structural report checker with source-derived block invariants and
   richer lifecycle transition certificates.
6. Evaluate against React Bench workspaces and open-source applications. Every new unsupported
   construct becomes explicit corpus coverage, never an implicit pass.

### Test stack

Current checkpoint: 324 TypeScript fixture projects, 527 static tests, and 40 Chromium runtime
oracles.

- Vite Plus supplies package build and Vitest-compatible static tests.
- TypeScript fixture projects exercise real project construction and cross-file symbols.
- Playwright runs selected lifecycle counterexamples in Chromium.
- Runtime oracles validate fixture behavior only. They are not proof certificates and cannot turn
  `incomplete` into `proved`.
- The external-store oracle routes subscribe and snapshot functions through an adapter component,
  reproduces React's cached-snapshot invariant for a fresh object, and confirms the stable
  cached-object control. A second oracle switches between two JSX render branches and confirms that
  updates from the inactive store no longer affect the mounted reader. A third performs the same
  switch through ternaries in one JSX render site, exercising the guard-correlated protocol.
- Effect Event oracles contrast latest-value reads with an ordinary stale closure, prove identity
  changes across renders, and reproduce the pinned-runtime `memo` plus context defect from React
  issue #34818.
- Context oracles confirm exact context-object identity, static default fallback, parent
  inheritance, and nearest nested-provider isolation.
- The async ownership oracle races a slow superseded request against a fast current request. The
  unguarded completion overwrites current state; cleanup invalidation preserves the current owner.
- The JSX spread oracle confirms React's ordered property-copy semantics in both directions:
  trailing explicit callbacks replace spread callbacks, and trailing spread callbacks replace
  explicit callbacks.
- The callable-ref oracle performs an update and a programmatic click in one commit. The
  layout-synchronized ref observes the new callback; the passive ref exposes the previous callback
  before its Effect runs.
- The scheduler-lifetime oracle unmounts before a timeout expires. Exact cleanup cancellation
  keeps the post-unmount hit count at zero, while the uncanceled control fires once after unmount.
- The observer-lifetime oracle mutates the document after unmount. `disconnect()` suppresses
  delivery, while the intentionally leaked observer still receives the mutation.
- Class lifecycle oracles run under root Strict Mode. Exact listener removal survives the synthetic
  mount/unmount/remount sequence, while omitted teardown remains observable after final unmount.
  Exact timeout cancellation suppresses both timer generations; omitted cancellation fires both.
- The class state-transition oracle confirms that a previous-props guard converges after one state
  write and that an unguarded `componentDidUpdate` write reaches React's maximum-update-depth
  failure.
- The Hook state-transition oracle confirms that one event commits one state increment while root
  Strict Mode invokes the functional updater twice to expose accidental impurity.

## Effect resource lifetime certificates

### Product brief

Job: A React maintainer wants a deterministic answer that an Effect cannot retain a browser
resource or receive callbacks after replacement/unmount; text matching and ordinary lint cannot
establish identity or path coverage.

Change: Add internal, versioned resource facts to the private proof graph. Each fact links one
platform acquisition to its Effect setup, deferred callback graph, exact disposal calls, and a
fail-closed completeness bit.

Reuse: The implementation extends the existing Effect, callback reachability, scheduler lifetime,
and report-checker machinery. Broad `truffler` searches for resource lifetime, listener identity,
observer disposal, and guaranteed cleanup found no equivalent symbol.

Compat: The package remains private at `0.0.0`; graph schema 17 and report schema 11 make stale
certificates explicitly unsupported. No React Doctor JSON surface, telemetry, action input, score,
or published package changes.

Kill: Remove a protocol if realistic-corpus review finds any false `proved` result. Precision may
stay incomplete, but a certificate may never rely on spelling alone.

### Platform semantics

- The [DOM Standard](https://dom.spec.whatwg.org/) defines listener identity for registration and
  removal by event type, callback, and capture. `passive`, `once`, and `signal` are not part of the
  removal match, so comparing complete option-object text is both unsound and imprecise.
- An Effect still owns a `once` listener until it fires. `once: true` therefore does not discharge
  unmount cleanup.
- `MutationObserver`, `ResizeObserver`, and `IntersectionObserver` become active through
  `observe()`, not construction alone. A lifetime fact is emitted only for an activated observer,
  and exact-object `disconnect()` is its modeled disposal.
- The [WebSocket Standard](https://websockets.spec.whatwg.org/) makes `close()` initiate a closing
  handshake rather than synchronously erase every possible callback. WebSocket certification
  remains unsupported instead of treating a `.close()` spelling as proof.
- The [server-sent events specification](https://html.spec.whatwg.org/dev/server-sent-events.html)
  similarly requires a dedicated EventSource protocol before `close()` can become proof evidence.

### Realistic corpus evidence

React Bench cases motivating the listener protocol include:

- `fix-react-coreui-coreui-react-470`: stable targets, capture symmetry, resize and visibility
  listeners, and transition cancellation.
- `fix-react-rdh-catho-quantum-autocomplete`: window click and keydown listener ownership.
- `fix-react-jumperexchange-jumper-exchange-2917`: multiple video event registrations.
- `write-react-trycompai-comp-3248`: document mousemove and mouseup pairs.
- `write-react-azouaoui-med-react-pro-sidebar-267`: media-query change listeners.

Observer cases include `write-react-cloudscape-design-components-4631` for `MutationObserver` and
`write-react-treely-boemly-277` for `ResizeObserver`. The Victory animation case uses a custom
`timer.subscribe`; it is evidence that a generic `.subscribe()` name must not be granted browser
resource semantics without a checked library contract.

### Current proof boundary

The certificate recognizes TypeScript declarations from the platform libraries, immutable
callback/target identity, static event type and capture, exact `AbortController` signal ownership,
platform-value provenance, every returned cleanup alternative, and entry-dominating direct or
helper disposal. Dynamic or accessor-backed capture, ref/prop/structural targets, mutable targets,
opaque disposer helpers, async or thenable callbacks, and path-correlated acquisition/cleanup
remain incomplete. Conditional acquisition is proved when exact disposal is unconditional on
every cleanup alternative.

Added corpus:

- proved: `proved-listener-capture-semantics`, `proved-abort-signal-listener`,
  `proved-mutation-observer`, `proved-observer-constructor-only`, and
  `proved-conditional-helper-effect-cleanup`
- refuted: `abort-signal-listener-leak` and `mutation-observer-leak`
- incomplete: `incomplete-dynamic-listener-capture`,
  `incomplete-accessor-listener-capture`, `incomplete-async-listener-callback`,
  `incomplete-ref-event-target`, and `incomplete-structural-event-target`
- declaration guard: `shadowed-event-target`

## Class render and mount/unmount certificates

### React semantics

- The official [`Component` reference](https://react.dev/reference/react/Component) requires
  `componentDidMount` setup to be mirrored by `componentWillUnmount` cleanup. It also defines
  `render` as pure and warns that unguarded `componentDidUpdate` state changes can loop.
- [`StrictMode`](https://react.dev/reference/react/StrictMode) performs an extra development
  setup/cleanup cycle when enabled at the root. The runtime oracles therefore test two lifecycle
  generations rather than treating one production mount as sufficient evidence.
- `render` may be called and discarded, so class render uses the same render-phase purity and
  callback-reachability obligations as a function component. Lifecycle methods are separate
  commit-phase callback roots.

### Proof boundary

React inheritance is resolved through TypeScript symbols and only canonical React `Component` or
`PureComponent` declarations create class units. A complete class certificate currently permits a
pure ordinary `render`, direct ordinary `componentDidMount`, `componentDidUpdate`, and
`componentWillUnmount` methods, stable callback methods, and primitive scheduler-handle properties
whose sole write is the certified registration assignment.

Mount/unmount listener facts reuse the DOM identity certificate. Timer facts require an exact
property symbol, one registration write, an entry-dominating matching cancellation, a synchronous
deferred callback, and reciprocal links among the class lifecycle, mount callback, scheduler, and
unmount evidence. Missing disposal or cancellation is a concrete refutation. Reassignment, helper
indirection not represented by the lifecycle summary, and unsupported members force
`incomplete`.

The React Bench checkout contained no checked-in `componentDidMount`,
`componentWillUnmount`, or `componentDidUpdate` TypeScript/JavaScript sources at this checkpoint;
it is evidence that modern hook code dominates that corpus, not evidence that class behavior can
be ignored. Adversarial class shapes were instead seeded from React Doctor's existing class
lifecycle rule corpus and checked against the official React semantics above.

Added corpus:

- proved: `class-component`, `proved-pure-class-render`, `proved-class-listener`,
  `proved-class-timeout`, and the empty-update `incomplete-class-lifecycle` characterization
- refuted: `class-render-impurity`, `class-listener-leak`,
  `class-listener-capture-mismatch`, and `class-timeout-leak`
- incomplete: `incomplete-class-field`, `incomplete-class-helper-lifecycle`,
  `incomplete-class-listener-method-reassigned`, and `incomplete-class-timeout-reassigned`
- declaration guard: `shadowed-component-class`

## Class state-transition certificates

### React semantics

- The official [`Component` reference](https://react.dev/reference/react/Component) defines
  `setState` updater functions as pure queued calculations and warns that calling `setState` in
  `componentDidUpdate` must be guarded or it can create an infinite loop.
- An object update shallow-merges state and schedules another render. A `null` updater is a no-op.
  `PureComponent` may skip an update, so an unguarded object update on `PureComponent` is unknown
  rather than a claimed guaranteed cycle.
- A previous-props inequality guard over the same top-level property becomes false after the
  state-only update because props did not change. This is the first bounded update invariant.
  Conjunctions need one such conjunct; disjunctions require every alternative to have the
  invariant. Nested property paths remain unknown because a mutable object or getter can change
  without a new top-level prop. Broad number-valued guards also remain unknown because
  `NaN !== NaN` stays true across a state-only update; finite numeric-literal unions exclude that
  counterexample and can be certified.

### Proof boundary

`this.setState` is recognized only through a symbol whose declaration belongs to React's
`Component`; lookalike and overridden methods are not proof evidence. Function updaters reuse the
render-purity analyzer and receive their own `state-transition` callback root. Direct object
updates, pure updater functions, and `null` are modeled. An entry-dominating unguarded object
update in an ordinary `Component` is a concrete refutation. A same-path previous/current props
inequality guard certifies a bounded transition only for the supported top-level reflexive types.

The semantic graph links each state transition to its mount or update callback, optional updater
callback, source guard locations, updater classification, convergence classification, and exact
completeness flag. The independent checker derives the obligation verdict again from those facts
and rejects forged lifecycle links, callback phases, guard evidence, and completeness. Report
schema 14 and graph schema 20 reject stale certificates.

Commit callbacks, destructured previous props, nested mutable paths, number-valued inequalities,
opaque or asynchronous updater work, equality-plus-else guards, state-to-instance convergence,
helper-mediated writes, `shouldComponentUpdate`, and ambiguous `PureComponent` convergence remain
`incomplete`.

Added corpus:

- proved: `proved-class-prop-transition`, `proved-class-compound-prop-transition`,
  `proved-class-number-literal-prop-transition`, and `proved-class-pure-state-updater`
- refuted: `class-update-loop` and `class-impure-state-updater`
- incomplete: `incomplete-pure-component-update`, `incomplete-class-update-callback`,
  `incomplete-class-destructured-prop-transition`,
  `incomplete-class-nested-prop-transition`, `incomplete-class-number-prop-transition`, and
  `incomplete-class-opaque-state-updater`

## Class state-ownership certificates

### React semantics

- The official [`Component` reference](https://react.dev/reference/react/Component) states that
  class state must be an object and must not be mutated directly. State changes after
  construction go through `setState`.
- The same reference makes the construction boundary exact: a constructor is the only method
  where assigning `this.state` directly is valid, and a public `state = { ... }` field is the
  modern equivalent.
- The browser oracle demonstrates the observable failure mode: assigning
  `this.state.count = nextCount` changes the owned object but does not schedule a render, so the
  committed DOM remains stale.

### Proof boundary

The earlier state-transition certificate modeled `setState` calls but could incorrectly prove a
lifecycle containing only `this.state.value = nextValue`, because no React transition call existed
to add to the graph. Class lifecycle collection now emits a state-write fact for assignments,
compound assignments, updates, deletes, `Object.assign`, array mutators, and `Map`/`Set` mutators
in mount, update, unmount, deferred resource/scheduler callback, and state-updater phases.

Mutator calls require both a state-rooted receiver and a TypeScript symbol declared by the
platform collection type. A user-defined persistent method named `push` is not refuted as a
mutation; its unmodeled call keeps the lifecycle incomplete. A state read used only as a primitive
value or computed key remains provable. An object-valued `this.state` path copied into an alias,
argument, return, property, array, or spread is recorded as an unknown reference escape instead of
assuming later writes cannot reach React-owned state.

Each write fact is linked reciprocally to its exact lifecycle callback and records phase, write
kind, ownership status, source completeness, and certificate completeness. The independent
checker derives a forbidden write as a violation, an escaped reference as unknown, rejects forged
phase/owner/completeness facts, and includes every write in the lifecycle completeness equation.
Report schema 15 and graph schema 21 reject stale certificates.

Constructor initialization and public object-valued `state` fields remain unmodeled at this
checkpoint, so they still make the class unit incomplete rather than being confused with
post-construction mutation. Alias writes beyond the proved direct receiver are likewise unknown
until the graph carries a complete state-reference flow.

Added corpus:

- proved: `proved-class-primitive-state-read` and
  `proved-class-state-computed-key-read`
- refuted: `class-direct-state-mutation`, `class-state-mutating-call`,
  `class-state-mutation-forms`, `class-unmount-state-mutation`, and
  `class-deferred-state-mutation`
- incomplete: `incomplete-class-state-alias`, `incomplete-class-conditional-state-alias`, and
  `incomplete-class-custom-push`
- runtime: `class-state-ownership-oracle.spec.ts`

### Product brief: internal class state-ownership facts

Job: Prover consumers need a trustworthy answer when class code bypasses React's state scheduler;
previously they received a false proof or had to inspect lifecycle code manually.

Change: Extend the existing class lifecycle and `class-state-transitions` obligation with the
smallest certificate fact that distinguishes forbidden direct writes from unresolved state
reference escape.

Reuse: Truffler searches for class state mutation, initialization, assignment, and symbol helpers
found no duplicate prover implementation. The change reuses the existing lifecycle callbacks,
TypeScript symbol resolution, platform declaration identity, transition obligation, and
independent checker rather than adding another public claim.

Metric: This is a private `0.0.0` proof-kernel package with no CLI telemetry path. Its deterministic
acceptance metric is 100% separation of the direct-mutation fixtures from the primitive-read,
computed-key, and user-defined persistent-method controls.

Compat: No React Doctor CLI, score, config, Action, or JSON report changes. The private prover
report moves to schema 15 and its semantic graph to schema 21; no Changeset is warranted before
the package has a published contract.

Kill: If `classStateWrites` produces no verdict distinct from generic lifecycle incompleteness in
the real-world evaluation corpus across two proof-schema releases, fold the facts back into the
transition representation while retaining the direct-mutation refutations.

## Class construction certificates

### React semantics

- The official [`Component` reference](https://react.dev/reference/react/Component) defines class
  state as an object, identifies direct constructor assignment and a public `state` field as the
  two initialization forms, forbids `setState` in the constructor, and requires `super(props)`
  before every other statement.
- The same reference forbids constructor side effects and subscriptions. Root
  [`StrictMode`](https://react.dev/reference/react/StrictMode) calls the constructor twice in
  development and discards one instance, so construction must be safe when evaluated more than
  once. Server rendering also executes construction before render.
- A missing initializer is a concrete failure when `render` or a React lifecycle reads
  `this.state`: React's base instance begins with no application state. A read confined to an
  unmodeled custom method is not automatically reachable, so that case remains incomplete rather
  than becoming a speculative refutation.

### Proof boundary

Every class component now owns exactly one `class-construction` graph fact in the
`class-construction` execution phase. The fact records the constructor and initializer locations,
public-field versus constructor-assignment provenance, whether state is required by guaranteed or
conditional execution, typed issue evidence, source completeness, and exact certificate
completeness. Its ID is linked reciprocally from the class lifecycle.

The first complete subset includes:

- fresh object-literal state with nested literal, array, object, function, conditional, unary,
  binary, template, constructor-parameter, and `this.props` values;
- every statically named, non-static instance field initializer under the same expression-purity
  model;
- pure immutable constructor locals used by the state object;
- a first-statement `super()` for a zero-parameter constructor or symbol-identical
  `super(properties)` for an explicit properties parameter;
- canonical `this.method = this.method.bind(this)` when `bind` resolves to the platform
  declaration;
- classes that do not need application state.

Known time, randomness, logging, browser storage, network, timer, and scheduling operations are
construction violations. Scalar or null state, constructor `setState`, a missing required
initializer, and a non-leading or mismatched superclass call are also refutations. Opaque calls,
external identifier values, object spreads, dynamic property semantics, nontrivial constructor
control flow, duplicate state sources, and unresolved statements fail closed. This is intentionally
an abstract expression proof rather than trusting the TypeScript state generic: TypeScript permits
`Component<Properties, number>`, but React's runtime contract still requires object state.

The independent checker re-derives construction status from issue statuses, rejects duplicate or
invalid issue kinds, enforces initialization-kind/location and state-demand coherence, checks the
construction phase and class owner, verifies one construction per class and reciprocal lifecycle
ownership, and derives `sourceComplete` and `complete` exactly. Report schema 16 and graph schema
22 reject stale certificates.

The Chromium oracle mounts constructor-assigned and public-field state under root Strict Mode.
React 19.2.5 evaluates both initialization paths twice and commits the second instance, confirming
that a construction-time observable operation is duplicated even though one instance is discarded.

Added corpus:

- proved: `proved-class-state-field`, `proved-class-field-from-props`,
  `proved-class-constructor-state`, and `proved-class-constructor-binding`
- refuted: `refuted-class-invalid-state`, `refuted-class-missing-state`,
  `refuted-class-missing-updater-state`,
  `refuted-class-constructor-side-effect`, `refuted-class-field-side-effect`,
  `refuted-class-constructor-subscription`, `refuted-class-constructor-set-state`, and
  `refuted-class-constructor-order`
- incomplete: `incomplete-class-opaque-state-initializer`,
  `incomplete-class-multiple-state-initializers`, and
  `incomplete-class-conditional-state-initializer`, plus
  `incomplete-class-custom-subscription-lookalike` as the platform-symbol control and
  `incomplete-class-accessor-field` as the unsupported-field-syntax boundary
- runtime: `class-construction-oracle.spec.ts`

### Product brief: internal class construction facts

Job: Prover consumers need to know that a class reaches its first render with valid state and that
React may safely repeat construction; previously every real constructor or object-valued state
field was generically incomplete, while some uninitialized state reads were incorrectly proved.

Change: Add one private construction claim and one versioned construction fact per class, then
link it into the existing lifecycle certificate.

Reuse: Truffler searches for constructor state initialization, field purity, superclass ordering,
and class object literals found no construction-proof abstraction. The implementation reuses the
class lifecycle owner, source locations, TypeScript symbols, platform-declaration identity,
existing render/state analyses, and independent report checker. The shared `this.state` path
predicate was moved into one utility and reused by post-construction state ownership.

Metric: The private package has no CLI telemetry path. Its deterministic acceptance metric is
complete separation of the proved, refuted, and incomplete construction fixtures, plus a Chromium
oracle that observes exactly two constructor and field-initializer evaluations in root Strict Mode.

Compat: No React Doctor CLI, score, config, Action, or JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 16 and its semantic graph to schema 22. No
Changeset is warranted before publication.

Kill: If the construction fact cannot distinguish a concrete invalid initialization from an opaque
factory without false `proved` results across two proof-schema releases, remove the dedicated claim
and keep class applications incomplete until a stronger constructor CFG is available.

## Hook state-transition certificates

### React semantics

- The official [`useState` reference](https://react.dev/reference/react/useState) defines a
  functional setter argument as an updater queued by React. The updater receives pending state,
  must be pure, and returns the next state.
- The same reference states that root Strict Mode may invoke an updater twice in development to
  find accidental impurities while ignoring one result. Updater side effects can therefore happen
  twice even when React commits only one state transition.
- A non-function setter argument is a direct next-state value. The setter identity is stable, so a
  dependency-array reference is not an escaped callback.

### Proof boundary

The new `hook-state-transitions` obligation is driven by TypeScript symbols from the second tuple
element of canonical `useState` calls. It does not trust `set` naming conventions, and it does not
reinterpret the second result of `useReducer` as a state updater. Each setter call records its state
and setter names, source location, every represented execution-root callback, optional updater
callback, updater classification, and exact source/completeness flags.

Direct non-callable values are complete when the call belongs to an existing callback graph.
Resolved synchronous functions reuse the render-purity proof and execute in their own
`state-transition` callback graph. Observable writes, browser storage, logging, time, randomness,
network access, and other known effects refute updater purity. Unknown or callable union values,
asynchronous or generator updaters, and bodies without project source remain unknown.

Execution ownership is inherited from the semantic graph rather than inferred again: direct
render, intrinsic and forwarded event, Effect setup/cleanup, scheduled, memoized, and reachable
helper functions point back to their already certified root callbacks. A setter reference passed
outside a direct call is a `setter-escape` fact unless it is only a Hook dependency. Escaped setters
and calls with no represented root fail closed.

The TypeScript standard-library symbols for `Map` and `Set` reads and mutators refine the shared
purity proof. Reading `has`/`get` is pure; mutating a freshly constructed local collection is pure;
mutating prior state or another protected input is a violation. User-defined methods with the same
names receive no platform contract.

The independent checker re-derives the claim verdict, validates non-class ownership, execution
callback ownership, the updater callback's `state-transition` phase, updater/status coherence, and
the exact source/completeness equations. Report schema 17 and graph schema 23 reject stale or
forged certificates.

This claim proves transition ownership and updater purity, not application-specific next-state
correctness. Queue ordering across multiple updates, function-valued state wrappers, render-phase
convergence, setter flow through arbitrary libraries, transitions, optimistic state, Actions,
Suspense interruption, and cross-component state-machine invariants remain explicit future proof
work.

The React Bench checkout supplied realistic shapes for the corpus: event toggles in the gallery and
sidebar harnesses, Effect-owned request counters, and the viewer's immutable `Set` replacement
pattern. The proof fixture keeps that `Set` pattern instead of reducing the milestone to scalar
arithmetic.

Added corpus:

- proved: `proved-hook-functional-updater`, `proved-hook-direct-state-value`,
  `proved-effect-functional-updater`, and `proved-state-setter-lookalikes`
- refuted: `refuted-impure-hook-state-updater`
- incomplete: `incomplete-opaque-hook-state-updater`,
  `incomplete-hook-state-setter-escape`, and `incomplete-hook-setter-in-reducer`
- runtime: `hook-state-transition-oracle.spec.ts`

### Product brief: internal Hook state-transition facts

Job: Prover consumers need to know whether React may safely replay a functional state updater and
whether every represented setter invocation remains inside the modeled callback graph.

Change: Add one private Hook state-transition claim and a versioned fact for each direct setter call
or setter escape.

Reuse: Truffler searches for Hook state transitions, `useState` setter calls, functional updater
purity, setter symbols, and Hook bindings found no existing transition certificate. The
implementation reuses `collectHookBindings`, callback reachability, TypeScript symbol resolution,
render purity, execution phases, and the independent checker. Class and Hook updaters now share one
updater-function purity entry point.

Metric: The private package has no CLI telemetry path. Its deterministic acceptance metric is
complete separation of pure event/Effect updaters, direct values, an impure updater, an opaque
updater, a setter escape, and the `useReducer`/name-lookalike controls, plus a Chromium oracle that
observes two updater evaluations and one committed increment.

Compat: No React Doctor CLI, score, config, Action, or JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 17 and its semantic graph to schema 23. No
Changeset is warranted before publication.

Kill: If execution-root matching or updater classification cannot separate the React Bench
controls without false `proved` results across two proof-schema releases, remove the dedicated
claim and keep `useState` applications incomplete until callback SSA provides the missing proof.

## Transition Action certificates

### React semantics

- The official [`startTransition` reference](https://react.dev/reference/react/startTransition)
  says React calls the Action immediately and marks state updates scheduled synchronously during
  that call as non-blocking Transitions.
- The same reference says timer-owned updates are outside the Transition, post-`await` setters
  currently require another `startTransition`, Transition renders are interruptible, and
  Transition updates cannot control text inputs.
- The official [`useTransition` reference](https://react.dev/reference/react/useTransition)
  defines the second tuple value as the Action starter and keeps `isPending` true until its Actions
  complete. It also records request completion ordering as an unsolved concern for custom async
  Actions.

### Proof boundary

The new `transition-actions` obligation recognizes global `startTransition` by React import symbol,
including aliases and namespace access, and recognizes Hook starters only from the second binding
of a canonical direct `useTransition` tuple. It does not trust a local function named
`startTransition`. Dependency-array references to the stable Hook starter are not escapes; any
other starter reference outside its direct call is an explicit `starter-escape` fact.

Each direct call records its owner, starter kind, source location, represented invoking callback
roots, optional Action callback, direct controlled-state evidence, and exact source/completeness
flags. A resolved Action gets a dedicated `transition-action` callback and reachable helper graph.
This lets a nested post-`await` `startTransition` use the outer Action as its execution root and lets
existing Hook state-transition facts identify their actual Transition Action owner.

The first complete subset requires a source-resolved Action whose full reachable source graph is
synchronous: no async function, `await`, thenable call, Promise continuation, or platform
scheduler. Its invocation must be owned by an event, Effect setup/cleanup, Effect Event, deferred
callback, external-store subscription, class mount/update, or another Transition Action. Render,
server-render, constructor, reducer/updater, unmount, and unresolved roots do not certify an Action.

For direct local `useState` updates, immutable `const` aliases retain their originating state
symbols through expressions and object construction. An intrinsic `input`, `textarea`, or `select`
`value`/`checked` dependency on updated state is a concrete violation. State forwarded through a
component prop, custom-Hook return, or form-control spread is unknown because the graph does not
yet have scalar prop/state SSA across those boundaries. This avoids claiming that a renamed or
wrapped controlled value is safe.

Async or scheduled Actions, opaque callback values, escaped starters, indirect `useTransition`
tuple access, invalid origin phases, and transitive control flow fail closed. A nested synchronous
Action after `await` can be individually complete while the enclosing async Action and application
remain incomplete. The current fact proves Action ownership and the direct local urgency subset,
not request ordering, async context, `useDeferredValue`, Server Actions, Suspense
fallback preservation, or whole-application transition state machines. Form Actions and
`useOptimistic` have separate certificates below, and `useActionState` has the Action State
certificate after them.

The independent checker re-derives the obligation verdict, validates starter and Action statuses,
owner and callback phases, unique execution roots, callback/status coherence, controlled and
unknown state-control evidence, and the exact source/completeness equations. Report schema 18 and
graph schema 24 reject stale or forged certificates.

React Bench supplied the realistic shapes: titlebar and tabs navigation wrap several synchronous
store/router operations; tab removal clones or filters collection state; dialog helpers wrap
context actions; and nested navigation can start another Transition. The proved corpus keeps the
immutable tab filter and reachable event helper rather than reducing the certificate to a direct
scalar setter.

Added corpus:

- proved: `proved-transition-tabs`, `proved-use-transition-action`, and
  `proved-transition-lookalike`
- refuted: `refuted-transition-controlled-input` and
  `refuted-transition-derived-controlled-input`
- incomplete: `incomplete-async-transition-action`, `incomplete-opaque-transition-action`,
  `incomplete-transition-starter-escape`, `incomplete-transition-control-prop`, and
  `incomplete-use-transition-tuple`
- runtime: `transition-action-oracle.spec.ts`

The Chromium oracle runs under root Strict Mode. It observes one async Action invocation, an
intermediate pending render, and a final nested post-`await` Transition commit. This validates the
runtime distinction while leaving the async static certificate incomplete.

### Product brief: internal Transition Action facts

Job: Prover consumers need to distinguish a synchronous, owned non-blocking update from an opaque,
escaped, delayed, or input-controlling Transition; previously `useTransition` was blanket
unsupported and global `startTransition` had no execution-phase certificate.

Change: Add one private Transition Action claim and one versioned fact per direct Action call or
starter escape.

Reuse: Truffler searches for Transition Actions, `startTransition`, `useTransition` bindings,
controlled input state, async Action boundaries, and execution callback roots found no dedicated
certificate. The implementation reuses React API symbol resolution, Hook tuple bindings, callback
reachability, synchronous deferred-callback analysis, source locations, state setter symbols, and
the independent checker. The Hook dependency-reference predicate was extracted and shared with
state setters.

Metric: The private package has no CLI telemetry path. Its deterministic acceptance metric is
complete separation of both React starters, a user lookalike, direct and derived controlled state,
async and opaque Actions, starter escape, transitive control uncertainty, and tuple indirection,
plus a Chromium oracle for pending and nested post-`await` behavior.

Compat: No React Doctor CLI, score, config, Action, or JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 18 and its semantic graph to schema 24. No
Changeset is warranted before publication.

Kill: If Action origin or state-control evidence produces a false `proved` result across two proof
schema releases, remove the complete Transition status and keep Actions incomplete until scalar
prop SSA and the lifecycle machine can carry the missing evidence.

## Form Action and optimistic state certificates

### React semantics

- The official [`<form>` reference](https://react.dev/reference/react-dom/components/form) defines
  a function-valued `action` as a React Action. React supplies `FormData`, resets uncontrolled
  fields after success, and manages async submission through a Transition.
- The same reference permits a submit-capable `button` or `input` to override the form Action with
  `formAction`. That behavior depends on submitter type and association with a form, not merely the
  presence of a callable JSX prop.
- The official [`useOptimistic` reference](https://react.dev/reference/react/useOptimistic)
  requires its reducer to be pure and its setter to run inside an Action or Transition. A setter
  call during render is an error; a call outside an Action can briefly show and then revert the
  optimistic value.
- Without a reducer, a callable setter argument is a state updater and must be replay-safe. With a
  reducer, the same callable value is an Action payload and must not be confused with an updater.
- An ordinary async `startTransition` callback is not enough to prove post-`await` ownership.
  React's Transition context limitation still requires a nested Transition. A Form Action has its
  own managed async Action lifetime.

### Form Action boundary

The `form-actions` obligation recognizes callable `action` and `formAction` only on intrinsic JSX.
It respects effective JSX precedence, resolves direct expressions and immutable finite spreads,
and follows reachable helper rendering and project callback flow. Each resolution creates one or
more dedicated `form-action` callbacks and records the intrinsic property, control kind, callback
set, callback-resolution flag, and exact source/completeness flags.

The complete subset includes function Actions on intrinsic forms and `formAction` on statically
nested submit-capable buttons and inputs. A statically wrong tag or submitter type is a concrete
violation. Dynamic button types, explicit `form="id"` association, submitters composed through
another component, open spreads, and unresolved callback props remain opaque. This distinction is
important: component composition may establish a valid runtime form owner, so absence of a local
JSX form ancestor cannot be called a violation.

A Form Action fact is source-complete only when callback resolution is complete, at least one
phase-correct callback is represented, and the control status is not opaque. It is complete only
when that source is complete and the control is resolved. The checker re-derives these equations,
validates property/control coherence, rejects duplicate or invalid callbacks, and re-derives the
per-unit obligation verdict.

### Optimistic state boundary

The `optimistic-state` obligation recognizes only a canonical React `useOptimistic` call assigned
to a direct tuple pattern. Either tuple binding may be unused, so reducer purity is still checked
when code reads only the optimistic value. The optimistic value joins the existing render-state
symbol set, while its setter is deliberately excluded from ordinary `useState` transition facts.

Every reducer gets a dedicated `optimistic-reducer` callback and the shared updater-purity
analysis. Every setter call records the linked optimistic state, execution callback roots, optional
`optimistic-updater` callback, updater classification, and Action classification. With a reducer,
the setter argument is an Action payload even if its type is callable. Without a reducer, a
callable argument is analyzed as an updater; object values that merely contain callable
properties remain direct values.

Action ownership is conjunctive. Every represented execution root must be either a Form Action or
a Transition Action with its own complete synchronous certificate. A render root is a concrete
render violation. Any ordinary event, Effect, scheduler, or other non-Action root is a concrete
outside-Action violation. A root in an incomplete async Transition remains unknown rather than
being incorrectly promoted or refuted. Reusing one function as both a Form Action and an ordinary
event handler is therefore refuted because React can invoke the optimistic setter outside the
Action path.

Optimistic state is complete only when the reducer is absent or proved pure. An update is complete
only when its linked state exists, its Action origin is known and exclusive, its setter has not
escaped, and its direct value or updater is proved replay-safe. The independent checker recomputes
reducer/updater callback requirements, linked-state ownership, Action status from callback phases
and complete Transition certificates, source flags, completeness, and the obligation verdict.

Added corpus:

- proved: `proved-optimistic-form`, `proved-form-action-submitter`,
  `proved-helper-spread-form-action`, and `proved-optimistic-transition-updater`
- refuted: `refuted-optimistic-outside-action`, `refuted-optimistic-render-update`,
  `refuted-impure-optimistic-reducer`, `refuted-impure-optimistic-updater`,
  `refuted-mixed-optimistic-action-roots`, and `refuted-unsupported-form-action-control`
- incomplete: `incomplete-dynamic-form-action-control`,
  `incomplete-composed-form-action-submitter`, `incomplete-form-action-prop`,
  `incomplete-optimistic-setter-escape`, and `incomplete-optimistic-async-transition`
- runtime: `optimistic-form-action-oracle.spec.ts`

The Chromium oracle runs under root Strict Mode. It submits an async Form Action, observes the
optimistic todo while the Action is pending, records one Action invocation, and then observes the
confirmed todo replacing the pending value. The oracle calibrates the fixture against the pinned
React runtime; it does not upgrade the static proof.

### Product brief: internal Form Action and optimistic facts

Job: Prover consumers need to know whether optimistic state is pure, replay-safe, and owned by a
real React Action, rather than merely seeing a `useOptimistic` name or callable form prop.

Change: Add two private claims, three execution phases, versioned Form Action/state/update facts,
and independent checker equations.

Reuse: Truffler searches found no dedicated certificate. The implementation reuses canonical React
symbol resolution, Hook tuple bindings, JSX precedence and immutable spread analysis, component
callback flow, execution-root matching, updater purity, render-state tracking, and the report
checker. Hook and optimistic functional updates now share one state-update classifier, while
shallow callable-state detection preserves function-containing object values as direct values.

Metric: The private package has no CLI telemetry path. Its deterministic acceptance metric is
complete separation of direct and spread Form Actions, valid and unresolved submitter association,
pure and impure reducers/updaters, reducer Action payloads, render/event/Form/Transition/mixed
origins, setter escape, and async Transition uncertainty, plus a Chromium pending/reconciliation
oracle.

Compat: No React Doctor CLI, score, config, Action, or published JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 19 and its semantic graph to schema 25. No
Changeset is warranted before publication.

Kill: If form association or Action-root composition produces a false `proved` result across two
proof-schema releases, remove the affected complete status and keep that surface incomplete until
the lifecycle graph can represent the missing topology.

## Action State certificates

### React semantics

- The official [`useActionState` reference](https://react.dev/reference/react/useActionState)
  defines a three-value tuple containing current state, a stable dispatcher, and pending state.
- The reducer Action receives previous state before its payload, may be async, may perform side
  effects, and is not double-invoked by Strict Mode. Multiple dispatches are queued in order.
- React requires the dispatcher to run inside an Action. A direct function-valued `action` or
  `formAction` prop supplies that context; manual dispatch requires `startTransition`. Render
  dispatch is forbidden, and ordinary callback dispatch loses pending Action semantics.

### Proof boundary

The `action-state` obligation recognizes only a canonical React `useActionState` call assigned to
a direct tuple pattern. It identifies the state and dispatcher by TypeScript symbol and resolves a
project reducer Action from the first Hook argument. The reducer gets a dedicated
`action-state-reducer` callback and execution phase. Unlike `useReducer` and `useOptimistic`
reducers, it is intentionally not checked for purity because React defines side effects as valid
Action State behavior.

Every direct dispatcher call, direct intrinsic `action` or `formAction` reference, and other
dispatcher reference becomes a versioned dispatch fact. Direct Action props reuse the existing
intrinsic form-control proof and link its Form Action callback set to the Action State reducer.
Manual calls collect every represented execution root. A dispatch is complete only when its
linked reducer is source-resolved and its origin is exclusively a Form Action, an Action State
reducer, or a complete synchronous Transition Action.

Render dispatch and an ordinary event, Effect, scheduler, or other non-Action root are concrete
violations. An escaped dispatcher, unresolved reducer prop, custom Action component, missing
execution root, or dispatch inside an incomplete async Transition remains unknown. This first
certificate proves reducer identity and dispatch Action ownership. It does not yet prove reducer
return-type semantics beyond TypeScript, progressive-enhancement permalink identity, Server
Function serialization, error-boundary behavior, cancellation, or queue-level application
invariants.

The independent checker recomputes the obligation verdict, validates linked state and reducer
callbacks, derives direct Action-prop ownership from the matching Form Action fact, derives manual
dispatch status from callback phases and complete Transition certificates, and checks exact
source/completeness equations. Form and optimistic certificates also accept the dedicated Action
State reducer phase as a real Action root. Report schema 20 and graph schema 26 reject stale or
forged certificates.

React Bench did not contain broad native React 19 Action State usage, so the realistic corpus is
grounded in the official checkout, ordered-cart, form, optimistic-update, and manual-Transition
shapes rather than fabricating prevalence. The benchmark’s existing form and interaction tasks
still informed the multi-button form and collection-state payloads.

Added corpus:

- proved: `proved-action-state-form` and `proved-action-state-transition`
- refuted: `refuted-action-state-outside-action` and
  `refuted-action-state-render-dispatch`
- incomplete: `incomplete-action-state-dispatcher-escape`,
  `incomplete-action-state-reducer-prop`, and `incomplete-action-state-async-transition`
- runtime: `action-state-oracle.spec.ts`

The Chromium oracle runs under root Strict Mode, submits two values while the first async reducer
Action is pending, observes the pending state, confirms exactly two reducer invocations, and
observes the ordered `first|second` result. It calibrates React's queue and Strict Mode behavior
without upgrading any static proof.

### Product brief: internal Action State facts

Job: Prover consumers need to distinguish a dispatcher that participates in React's ordered
Action State queue from the same stable function invoked during render or an ordinary event.

Change: Add one private claim, one reducer execution phase, versioned state and dispatch facts,
direct Form Action integration, and independent checker equations.

Reuse: Truffler searches for Action State dispatch, Hook dispatcher bindings, Action execution
roots, and reducer Actions found no existing certificate. The implementation reuses canonical
React symbol resolution, Hook tuple collection, Form and Transition Action facts, callback
reachability, execution-root matching, source locations, and the independent checker.

Metric: The deterministic acceptance metric separates direct Form Action, nested Form Action,
synchronous Transition, ordinary event, render, escaped, opaque-reducer, and async-Transition
cases, plus a Chromium oracle for pending state, ordered queuing, and Strict Mode invocation count.

Compat: No React Doctor CLI, score, config, Action, or published JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 20 and its semantic graph to schema 26. No
Changeset is warranted before publication.

Kill: If dispatcher origin or direct Action-prop association produces a false `proved` result
across two proof-schema releases, remove the complete dispatch status and keep Action State
incomplete until callback SSA or the lifecycle machine carries the missing evidence.

## Form Status topology certificates

### React semantics

- The official [`useFormStatus` reference](https://react.dev/reference/react-dom/hooks/useFormStatus)
  requires the Hook to run in a component rendered inside a parent `<form>`.
- A form returned by the same component is not a parent form. In that documented pitfall,
  `pending` never becomes true. A component that can render both below and outside a form therefore
  has a concrete invalid execution path rather than an merely opaque one.
- The pending status carries the parent form's `FormData`, declared method, and callable Action.
  With no active submission or no parent form, the idle status has null data and Action.
- React DOM implements the Hook through the host-transition status dispatcher. Its source identity
  is therefore `react-dom` `useFormStatus`, not an arbitrary custom Hook with the same spelling.

### Real-project evidence

React Bench did not contain native React DOM `useFormStatus` usage. A broader source search found
the canonical production shape in Next.js:

- [`examples/next-forms/app/add-form.tsx`](https://github.com/vercel/next.js/blob/cf1e001f40b311f5a4f19775ec9ea4f1d8bdece9/examples/next-forms/app/add-form.tsx)
  and
  [`delete-form.tsx`](https://github.com/vercel/next.js/blob/cf1e001f40b311f5a4f19775ec9ea4f1d8bdece9/examples/next-forms/app/delete-form.tsx)
  put a dedicated pending button below an Action State form.
- [`examples/with-turso/app/form.tsx`](https://github.com/vercel/next.js/blob/cf1e001f40b311f5a4f19775ec9ea4f1d8bdece9/examples/with-turso/app/form.tsx)
  uses the same separate-submit-component topology around a database mutation.
- Next's forms guide explicitly says the loading indicator must be a separate component. Next also
  rejects `useFormStatus` in a Server Component module, evidence that future framework proofs need
  a client/server module-boundary fact in addition to the parent-form theorem.

The fixture corpus uses those separate submit-control and Action form shapes, plus component and
custom-Hook propagation, a shared button under two forms, the official same-component pitfall, a
detached consumer, mixed valid/invalid render sites, and a composed form shell whose `children`
placement is not yet modeled.

### Proof boundary

The `form-status` obligation recognizes only a symbol-resolved `useFormStatus` imported from the
React DOM runtime. Every intrinsic form receives a semantic identity. Every project component
render records the lexically active intrinsic form stack and whether an intervening component can
change the nearest-form topology.

Form sources propagate to rendered components and called custom Hooks until a fixed point:

- a direct intrinsic form ancestor supplies its nearest form identity;
- a render with no local form inherits the caller's parent form;
- a component-composed child with no guaranteed outer form supplies an unknown source rather than
  an outside-form counterexample;
- every exported closed component root starts outside a form, while an unreferenced local
  component remains unknown because an unmodeled render callback may own its placement;
- multiple render sites join every possible source form;
- one known outside-form path is enough to refute the obligation.

This proves parent-form presence and identity for the supported closed render subset. It does not
yet model arbitrary `children`/slot ReactNode flow, portals that create another root, framework
Server/Client Component boundaries, JSX returned from synchronous render callbacks or helpers,
renderer-specific host-transition providers, or form association outside the React parent tree.
Those cases remain incomplete rather than borrowing DOM ancestry or source nesting as proof.

The independent checker separately recomputes the fixed point from semantic render and custom-Hook
edges. It requires exactly one topology fact for every canonical Hook call, validates every active
and source form identity and owner, and re-derives the outside-form flag, source completeness,
topology status, claim verdict, and final completeness. Report schema 21 and graph schema 27 reject
stale certificates.

Added corpus:

- proved: `proved-form-status-direct`, `proved-form-status-transitive`, and
  `proved-form-status-multiple-forms`
- refuted: `refuted-form-status-outside-form`, `refuted-form-status-same-component`,
  `refuted-form-status-mixed-placement`, and `refuted-form-status-exported-child`
- incomplete: `incomplete-form-status-composed-form` and
  `incomplete-form-status-render-callback`
- runtime: `form-status-oracle.spec.ts`

The Chromium oracle runs under root Strict Mode, starts an async function-valued Form Action, and
observes that the descendant status exposes pending state, submitted data, the Action identity,
and the default method while the same-component status remains idle. React 19.2.5 reports the
default declared method as `get` in the pending status even though function-valued form Actions use
POST submission semantics. That calibrated distinction is retained in the oracle instead of
conflating the status field with transport behavior.

### Product brief: internal Form Status facts

Job: Prover consumers need to know that a pending indicator is attached to the form it claims to
observe, including every render path, rather than merely seeing a `useFormStatus` call.

Change: Add one private claim, intrinsic form identities, render-path form ancestry, versioned Form
Status facts, and independent checker equations.

Reuse: Truffler searches for form ancestry, render topology, and nearest-provider propagation found
no existing Form Status certificate. The implementation extends the existing component-render and
custom-Hook graph and deliberately mirrors the proven context-topology fixed-point shape without
sharing producer equations with the checker.

Metric: The deterministic acceptance metric separates direct, transitive, multi-form, detached,
same-component, exported-child, mixed-placement, and composed-child cases, plus a Chromium oracle
for pending, data, method, Action identity, and Strict Mode invocation count.

Compat: No React Doctor CLI, score, config, Action, or published JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 21 and its semantic graph to schema 27. No
Changeset is warranted before publication.

Kill: If lexical render topology produces a false `proved` result in a component-composed or
renderer-specific form tree, remove the complete source status and keep Form Status incomplete
until ReactNode slot flow or a renderer contract carries the missing ancestry.

## ReactNode slot-flow certificates

### Semantic correction

JSX syntax constructs React element values. It does not by itself establish that the represented
component is rendered. In `<Shell><Child /></Shell>`, the caller creates the `Child` element and
passes it as `Shell`'s `children`; `Shell` controls whether, where, and how often that value enters
the React tree. Treating the lexical nesting as an immediate caller-to-child render edge is
unsound for context, Form Status, execution multiplicity, and any future lifecycle theorem.

The official React material makes the distinction explicit:

- [Passing Props to a Component](https://react.dev/learn/passing-props-to-a-component) defines
  nested JSX as the `children` prop and describes wrapper components as leaving a hole for their
  caller.
- [`Children`](https://react.dev/reference/react/Children) defines `children` as opaque and warns
  that traversal does not render or descend through a component's returned JSX.
- [`createPortal`](https://react.dev/reference/react-dom/createPortal) changes physical DOM
  placement while retaining React-tree context and event propagation.
- [`cloneElement`](https://react.dev/reference/react/cloneElement) and arbitrary child
  transformations are documented as fragile, so they need an explicit value-flow model rather
  than a transparent-wrapper assumption.

This certificate therefore separates three render facts:

- `direct`: the JSX value reaches the component's returned ReactNode through a supported transparent
  expression path;
- `slot-input`: the JSX value is supplied to a component prop or crosses an unresolved source-value
  boundary;
- `slot`: one effective project-local placement of that input, linked back to its source and
  container render.

### Closed subset and fail-closed boundary

The complete subset follows destructured, object-parameter, or string-literal computed props
through direct `children` and named JSX attributes, including transitive local wrappers, portals,
and multiple placements. Each forwarding hop retains its component owner and lexically active
context-provider/form frames. Effective topology is ordered from outer placement frames to the
source-local frame, so the nearest source provider or form remains nearest after insertion.

Source and placement completeness are separate:

- `sourceComplete` proves that the JSX element reaches the slot without an alias, object container,
  unsupported call, spread, property access, or other value transformation;
- `placementComplete` proves that every use of the receiving prop reaches a terminal JSX or portal
  placement through project-local channels;
- `complete` is exactly their conjunction.

External components, receiver aliases, `Children.map`, unresolved calls, JSX spread slots, source
aliases, cycles, property mutation, callback boundaries, and unknown named values stay incomplete.
A channel may have both known effective placements and an unknown use; the known renders remain in
the graph, while the unknown source is propagated into context and Form Status fixed points. This
preserves useful evidence without turning partial reachability into a proof.

React Bench supplied realistic shapes rather than a synthetic UI calculus:

- `viewer/src/components/trial-nav.tsx` uses both direct `children` and a named `content: ReactNode`
  slot.
- `viewer/src/components/ui/tooltip.tsx` combines a named slot with `asChild` and a portal, showing
  why wrapper identity and physical DOM placement cannot be conflated.
- the migrated OpenCode applications contain many provider shells that forward `props.children`;
  floating-ui list boxes similarly place children under a provider.
- the composition guidance in
  `brain/vercel-composition-patterns/rules/patterns-children-over-render-props.md` favors form and
  layout composition through `children`, making this a core React boundary rather than an exotic
  pattern.

### Certificate checker and corpus

The independent checker recomputes context and form fixed points using effective renders only.
Every slot input must have exactly one slot-flow certificate. It validates unique IDs, reciprocal
source/effective-render links, source/container/prop agreement, exact render sets, source and
placement completeness equations, topology owners, provider/form ownership, and the resulting
`react-node-flow`, context, Form Status, report-summary, and application verdicts. Report schema 22
and graph schema 28 reject stale certificates.

Added or promoted corpus:

- proved: composed, transitive, named, and source-form Form Status slots plus direct and transitive
  context-provider slots;
- refuted: a child placed both under and outside a form;
- incomplete: external wrappers, receiver aliases, `Children.map`, source aliases, JSX spreads,
  dynamic computed slots, whole-props forwarding, non-rendered JSX props, and a dropped child used
  only as a condition;
- forged: a slot-flow completeness mutation rejected by the checker;
- runtime: a Strict Mode Form Action whose status consumer reaches its parent form only through a
  component-owned `children` slot.

The complete package gates now cover 324 TypeScript fixture projects, 527 static tests, and 40
Chromium runtime oracles. The new browser oracle observes pending state, submitted `FormData`, and
Action identity through the slot and confirms one Action invocation. Runtime evidence calibrates
React 19.2.5 behavior but does not upgrade an incomplete static channel.

### Product brief: internal ReactNode flow facts

Job: Prover consumers need to know where component-valued props actually enter the React tree before
trusting context, Form Status, execution, or lifecycle claims.

Change: Add one private `react-node-flow` claim, versioned direct/input/effective render facts,
source and placement completeness, transitive topology frames, and independent checker equations.

Reuse: Truffler searches for ReactNode value flow, JSX child placement, rendered component targets,
and provider/form wrapper topology found no reusable prover symbol. The implementation reuses
TypeScript symbol identity, component-prop extraction, JSX spread utilities, semantic render IDs,
and the existing context/Form Status fixed-point machinery. The shared JSX component-target
resolver was extracted from callback-prop flow instead of duplicated.

Metric: The deterministic acceptance metric separates direct, named, transitive, duplicated,
provider-bearing, source-form, mixed-placement, external, aliased, transformed, and spread cases,
with every emitted certificate accepted by the checker and the forged certificate rejected.

Compat: No React Doctor CLI, score, config, Action, or published JSON report changes. The private
`@react-doctor/prover@0.0.0` report moves to schema 22 and its semantic graph to schema 28. No
Changeset is warranted before publication.

Kill: If a complete slot channel produces a false `proved` topology in two proof-schema releases,
remove complete slot propagation and keep ReactNode inputs unknown until value-level SSA or a
library proof contract carries the missing semantics.

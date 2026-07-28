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
ownership. Schema version 16 also records every source-resolved project helper reachable from
render, event, memo, reducer, Effect setup, Effect cleanup, Effect Event, and external-store
callbacks, together with its root callback, execution phase, and conditional reachability. When a
helper is reachable by both conditional and unconditional paths, the graph retains the stronger
unconditional fact. Effect resource and state-transition obligations traverse the same call graph,
so a helper or object method cannot hide listener acquisition, disposal, or a state write. Proof
obligations and graph extraction share the symbol-resolved collectors. A React Compiler adapter can
therefore replace individual fact producers without changing the report contract or proof
consumers.

Schema version 16 records the call edges that justify helper reachability. Direct source calls,
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
snapshot. Schema version 16 stores callback sets and completeness independently for all three and
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
- Class components, which are discovered but currently force `incomplete`

Each function unit receives these obligations:

| Claim                         | Current evidence                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `async-effect-ownership`      | Post-`await` and Promise-continuation commits, cleanup invalidation, abort guards           |
| `callable-ref-freshness`      | Initial value, exclusive effect write, commit timing, non-escape, concrete event channels   |
| `hook-order`                  | Conditional, looped, nested, and post-early-return hook positions                           |
| `hook-ownership`              | Module, helper, method, and anonymous-callback hook calls without a valid React owner       |
| `context-topology`            | Exact object identity, defaults, provider values, nested overrides, render/hook propagation |
| `render-purity`               | State writes, input mutation, known non-idempotence, transitive local helpers, opaque calls |
| `effect-dependencies`         | Symbol-resolved reactive captures versus inline dependency tuples                           |
| `effect-cleanup`              | Transitive listener/resource acquisition, identity symmetry, and conditional helper paths   |
| `effect-state-updates`        | Transitive writes, mount bounds, local-rerender stability, and unknown fixpoints            |
| `effect-event-usage`          | Local Effect ownership, non-escape, dependency exclusion, intentionally unstable identity   |
| `external-store-consistency`  | Stable snapshots, symmetric subscriptions, write notification, hydration agreement          |
| `memo-dependencies`           | `useMemo` and `useCallback` captures versus inline dependency tuples                        |
| `reconciliation-identity`     | Missing, duplicate, index-derived, and unconstrained dynamic list keys                      |
| `reducer-purity`              | Reducer and reducer-initializer transition purity                                           |
| `ref-access`                  | Render-phase access to refs created by `useRef`                                             |
| `scheduled-callback-lifetime` | Effect ownership, deferred callback resolution, exact handles, guaranteed cancellation      |
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

Incomplete:

- `opaque-render-call`
- `effect-state-update`
- `unsafe-types`
- `path-dependent-cleanup`
- `class-component`
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
- Transitions, deferred values, optimistic state, and Actions
- Suspense and abandoned render behavior
- Reconciliation outside direct arrays, map callbacks, and imperative `for`-loop list construction
- Component tree position and state preservation outside represented list identities
- Server Components, client boundaries, hydration, and serialization
- Class component lifecycle methods
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
   lifecycle transition certificates.
6. Evaluate against React Bench workspaces and open-source applications. Every new unsupported
   construct becomes explicit corpus coverage, never an implicit pass.

### Test stack

Current checkpoint: 205 TypeScript fixture projects, 382 static tests, and 26 Chromium runtime
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

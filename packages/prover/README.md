# React Doctor Prover

`@react-doctor/prover` constructs a whole-project React proof report from a TypeScript program.
It fails closed:

- `proved` means every discovered unit satisfies every implemented obligation.
- `refuted` means at least one obligation has a source-level counterexample.
- `incomplete` means a compiler error, opaque boundary, or unsupported React behavior prevented a proof.

The package is private while the React semantics and proof boundary are under active development.
It does not affect the React Doctor score, CLI, or JSON report.

## API

```ts
import { checkReactProofReport, proveReactApp } from "@react-doctor/prover";

const report = proveReactApp({
  rootDirectory: "/absolute/path/to/app",
});
const certificate = checkReactProofReport(report);
```

The report includes:

- a versioned React semantic graph with component, render, hook, context, effect, Effect Event,
  async-ownership, external-store, reconciliation, identity-stability, and execution-phase
  callback facts, including project helpers reachable from render, event, memo, reducer, Effect,
  Effect Event, and external-store callbacks;
- source-level direct, formal-parameter, and synchronous higher-order function-call edges;
- callable abstract-value flow through expression returns, exhaustive structured branches,
  type-exhaustive or default-covered switches, caught throws, and `finally` return overrides, plus
  termination-proved loop exits and finite iteration-variable joins through nested object and tuple
  bindings, captured factory parameters, local object properties, and object arguments;
- component-prop flow from source callbacks through project render edges into event handlers,
  Effect setup, Effect cleanup, and all three `useSyncExternalStore` callback channels, including
  local and transitive wrappers plus finite JSX spreads of whole props, parameter rest props, and
  non-escaping local `const` callback objects, with each use tied to its exact execution phase and
  JSX render site; JSX sources are resolved in order so later spreads or explicit attributes
  replace earlier callbacks, while finite symbol-identified path guards preserve correlated
  ternary alternatives without relying on source order, including immutable identifier guards
  substituted through source callback factories;
- callable-ref protocol facts that tie a `useRef` initializer, its exclusive effect write, the
  write's commit phase, and every concrete invocation channel to the resolved source callback;
  layout-synchronized, non-escaping refs used only by modeled events can be proved, while passive,
  multiply written, escaping, and unresolved protocols fail closed;
- imperative-handle protocol facts that tie a canonical `useImperativeHandle` factory to a React
  19 `ref` prop or `forwardRef` parameter, every static method in its closed object result, an exact
  project-local `useRef` binding, and each `ref.current.method()` invocation phase; stale reactive
  captures and impure factories are refuted, while spreads, computed methods, opaque handle
  objects, callback refs, shared refs, exports, and unresolved consumers fail closed;
- scheduler lifetime facts that tie a platform timer, animation frame, idle callback, immediate,
  or microtask registration to its owning Effect or class mount, deferred callback set, exact
  handle, and cleanup or unmount cancellation paths; only source-resolved synchronous callbacks
  with entry-dominating cancellation are complete;
- lifecycle resource facts for platform event listeners and activated mutation, resize, and
  intersection observers owned by Effects or class mount/unmount pairs; listener disposal follows
  the DOM's type/callback/capture identity rule or an exact `AbortController`, observers record
  every `observe()` activation, and every cleanup alternative must reach exact-object disposal;
- class construction facts that distinguish public `state` fields, direct constructor assignment,
  duplicate initialization, and absent state; the certificate proves every supported instance-field
  initializer, object-valued state, first-statement `super(props)`, pure constructor locals,
  canonical method binding, and Strict-Mode-safe expressions, while accessor fields, conditional
  control flow, and opaque factories fail closed;
- class lifecycle facts that certify symbol-resolved `Component` and `PureComponent` inheritance,
  pure render callbacks, direct `componentDidMount`/`componentDidUpdate`/
  `componentWillUnmount` ownership transitions, exact stable method identities, immutable
  primitive scheduler-handle fields, React-owned class state, pure `setState` updaters, and
  bounded prop-history update guards; direct state assignments, updates, deletes, and
  platform-resolved mutator calls are explicit forbidden graph facts, while object-valued state
  references that escape the modeled boundary fail closed;
- Hook state-transition facts that identify the exact `useState` setter symbol, distinguish direct
  values from functional updaters, link each call to its represented render, event, Effect, or
  deferred callback root, and give every resolved updater its own `state-transition` callback;
  synchronous pure updaters are certified, observable effects are refuted, and opaque updater
  bodies or escaped setters fail closed without confusing `useReducer` dispatch or similarly named
  functions with state setters;
- reducer-transition facts that identify each canonical `useReducer` tuple, resolve the reducer and
  optional lazy initializer, use TypeScript union types to close exhaustive switch paths, and
  classify every dispatcher reference by its React callback phase; pure total transitions and
  owned non-render calls are certified, fallthrough, throw, impurity, and render/reducer dispatches
  are refuted, while wrappers, unsupported control flow, and escaped dispatchers fail closed;
- lazy-component facts that identify canonical `lazy()` declarations by symbol, require
  module-stable identity and a total thenable loader whose resolved default has a component call or
  construction signature, and trace each JSX use through direct, transitive component, reachable
  render-helper, synchronous-callback, and closed ReactNode-slot paths to symbol-resolved
  `<Suspense>` boundaries; malformed loaders, render-local declarations, and known root paths
  outside Suspense are refuted, while external components, exported lazy aliases, and unresolved
  slots fail closed;
- Error Boundary facts that identify symbol-resolved React class boundaries, require a total pure
  `static getDerivedStateFromError` transition and a render guard which reveals fallback UI, and
  trace root-reachable explicit render throws through direct, helper, transitive component, and
  closed ReactNode-slot paths; uncovered failures and invalid recovery protocols are refuted,
  opaque state or topology remains unknown, and event handlers, server rendering, ordinary async
  callbacks, and errors thrown by a boundary itself stay outside this theorem;
- `use` resource facts that use TypeScript to distinguish thenables from Context values and invalid
  inputs, prove cached identity from module constants or React state with a stable initializer, and
  propagate both pending and rejection paths through direct renders, closed ReactNode slots, and
  custom Hooks; fresh
  render-created Promises, missing Suspense, and missing valid Error Boundaries are refuted, while
  opaque factories, props, and topology fail closed;
- Action State facts that identify canonical `useActionState` tuples, resolve each reducer Action
  without imposing reducer purity, and classify every dispatcher call or escape; a dispatch is
  certified only when every represented root is a Form Action, an Action State reducer, or a
  complete Transition Action, while render and ordinary callback roots are refuted;
- Transition Action facts that identify imported or namespace `startTransition` and the second
  tuple binding from a canonical `useTransition`, connect each source-resolved Action to its
  invoking callback and a dedicated `transition-action` phase, and distinguish synchronous Actions
  from async/deferred, opaque, and escaped boundaries; direct updates to state that controls an
  intrinsic input are refuted, while derived local aliases are followed and component-prop or
  spread control flow fails closed;
- Form Action facts for callable `action` on intrinsic forms and `formAction` on statically nested
  submit buttons and inputs; direct and immutable-spread callback sources follow JSX precedence
  through reachable helpers, while dynamic control types, composed form association, custom
  components, and opaque callback props fail closed;
- Form Status facts that identify canonical `react-dom` `useFormStatus` calls and propagate the
  nearest intrinsic parent form through closed component-render, ReactNode-slot, and custom-Hook
  paths; a detached, same-component, exported consumer, or mixed outside-form path is refuted;
- ReactNode flow facts that distinguish JSX element construction from an effective render,
  certify direct `children` and named-slot placement through transitive project-local
  components, string-literal computed props, and portals, and retain every provider/form topology
  frame along the path; external components, source or receiver aliases, dynamic computed props,
  whole-props spreads, JSX value spreads, non-rendered JSX props, `Children` transforms, cycles,
  and unmodeled callbacks fail closed instead of borrowing lexical JSX ancestry;
- optimistic state facts that identify canonical `useOptimistic` tuples, give reducers and
  no-reducer functional updaters dedicated execution phases, reuse the updater-purity proof, and
  require every setter call to be owned exclusively by Form or Transition Actions; render calls,
  ordinary-event calls, mixed Action/event reuse, and observable reducer or updater effects are
  refuted, while setter escape and unresolved callback flow remain unknown;
- normalized React Compiler CFG, instruction-effect, and reactive-place facts;
- per-unit proof obligations with `proved`, `violated`, or `unknown` results;
- project evidence for type unsoundness, compiler diagnostics, and opaque boundaries.

The project must have a `tsconfig.json` at its root. Project discovery does not walk into parent
directories because that would silently enlarge the proof boundary.

Every production proof is checked before it is returned. The independent checker rejects
unsupported schema versions, duplicate semantic IDs, dangling graph references, missing or
duplicate claim coverage, inconsistent context or async-ownership facts, incorrect summary
counts, helper/root callback phase mismatches, and a global verdict that does not follow from the
obligations. It also rejects function-call edges that cross owners, callback roots, or execution
phases, and flow kinds whose parameter/argument indexes are inconsistent. This is a structural
proof certificate today. Callback-prop channels are also checked for known owners, phase-matched
source callbacks, complete channels with actual sources, and internally consistent guarded
alternatives. Callable refs additionally require a source-complete `useLayoutEffect` update, a
concrete event callback, and a `ref.current` call edge. Scheduler certificates require a real
Effect setup or class mount callback, deferred callback facts, exact cancellation evidence, and
internally consistent completeness. Class lifecycle certificates additionally require one class
owner, phase-correct mount, update, and unmount callbacks, reciprocal resource, scheduler, and
state-write and state-transition links, and a completeness flag derived exactly from every owned
fact. State ownership certificates independently check lifecycle phase, forbidden/unknown
classification, and exact completeness. State transition certificates independently check updater
callback phase, guard evidence, convergence classification, and exact completeness. Broader
source-derived block invariants remain future work. Construction certificates independently check
one fact per class owner, the construction execution phase, initialization kind/location,
state-demand classification, issue/status coherence, reciprocal lifecycle ownership, and exact
source/completeness flags. Resource certificates
additionally require a real Effect setup or class mount, platform-declaration identity, deferred
or Effect Event callback facts, nonempty activation and disposal evidence, and a completeness flag
derived exactly from those facts.
Hook state-transition certificates additionally require a non-class owner, phase-consistent
execution roots, a `state-transition` updater callback for every resolved functional updater, and
source/completeness flags derived from the updater classification. The checker rejects forged
purity, setter-escape, callback ownership, and completeness combinations.
Reducer certificates additionally require phase-correct reducer and initializer callbacks,
type-aware total-return evidence, a symbol-linked state/dispatcher tuple, owned execution roots for
every direct dispatch, non-escape, and exact source/completeness equations. The checker rejects
forged callback, purity, totality, phase, reducer-link, and verdict combinations.
Lazy-component certificates additionally require reciprocal declaration/render links, known
Suspense boundary and render identities, stable declaration and loader-status equations, and
boundary sources independently propagated from every exported render root through effective
component and ReactNode-slot renders. The checker rejects forged loader, topology, outside-boundary,
source, completeness, and claim-verdict combinations.
Error Boundary certificates additionally require reciprocal definition/instance/render links,
phase-correct class ownership, exact recovery-protocol equations, and boundary sources
independently propagated from every exported render root through effective component and
ReactNode-slot renders. The checker rejects forged protocol, topology, outside-boundary, source,
completeness, and claim-verdict combinations.
`use` resource certificates additionally require a canonical non-Context `use` call, a
TypeScript-derived thenable kind, a closed cache-identity origin, independently propagated
Suspense and Error Boundary sources, valid recovery definitions, and the exact conjunction of
type, identity, topology, coverage, and completeness fields. The checker rejects forged resource
kind, identity, source, boundary, status, completeness, and claim-verdict combinations.
Transition Action certificates require a valid non-render execution root, a symbol-identified
starter, a phase-correct Action callback, coherent controlled-state evidence, and exact
source/completeness equations. The checker rejects forged synchronous, controlled-input,
starter-escape, callback, owner, and execution-phase combinations.
Form Action certificates require phase-correct callback facts, a coherent intrinsic prop/control
kind, nonempty complete callback resolution, and exact source/completeness equations. Direct
Action State dispatchers link the form fact to their reducer-Action callback. Action State
certificates independently validate tuple ownership, reducer callback phase, dispatch kind,
Action-prop association, execution roots, linked state, and exact source/completeness equations.
Form Status certificates independently recompute parent-form sources from render and custom-Hook
edges plus effective ReactNode slot renders, require one fact for every canonical Hook call,
validate active-form ownership, and reject forged outside-form, source, topology-status, and
completeness fields. ReactNode certificates require exactly one slot-flow fact per slot input,
separate source-expression and placement completeness, reciprocal effective-render links,
path-owned provider/form facts, unique semantic IDs, and the exact completeness conjunction.
Imperative-handle certificates independently validate factory dependency captures and purity,
closed method sets, exact ref-to-render bindings, ref exclusivity and escape evidence, reciprocal
method and invocation links, caller-owned execution phases, and the final source/completeness
equations.
Optimistic
certificates independently validate tuple ownership, reducer and updater callback phases, derive
Action ownership from every execution root, and reject forged purity, render/event origin, state
binding, escape, and completeness combinations.

## Verification

```sh
nr test
nr test:runtime
nr typecheck
```

The Vite Plus test suite checks static proof results over the fixture corpus. The Playwright suite
is a runtime oracle for selected counterexamples. Runtime observations validate fixtures but never
upgrade an incomplete static proof.

See [research-log.md](./research-log.md) for the soundness ledger and implementation roadmap.

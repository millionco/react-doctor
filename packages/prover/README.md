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
- Transition Action facts that identify imported or namespace `startTransition` and the second
  tuple binding from a canonical `useTransition`, connect each source-resolved Action to its
  invoking callback and a dedicated `transition-action` phase, and distinguish synchronous Actions
  from async/deferred, opaque, and escaped boundaries; direct updates to state that controls an
  intrinsic input are refuted, while derived local aliases are followed and component-prop or
  spread control flow fails closed;
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
Transition Action certificates require a valid non-render execution root, a symbol-identified
starter, a phase-correct Action callback, coherent controlled-state evidence, and exact
source/completeness equations. The checker rejects forged synchronous, controlled-input,
starter-escape, callback, owner, and execution-phase combinations.

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

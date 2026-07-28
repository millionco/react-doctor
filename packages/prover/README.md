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
concrete event callback, and a `ref.current` call edge. Source-derived block invariants and broader
lifecycle transition certificates remain future work.

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

# MobX Rule Research

This document defines a MobX capability foundation and a precision-first lint rule portfolio for
React Doctor. It prioritizes runtime failures, missed reactions, stale UI, and leaks over MobX style
preferences.

Research snapshot: July 19, 2026. The React Doctor baseline is
[`88114a2`](https://github.com/millionco/react-doctor/commit/88114a23321a73a2546fdc9db5902ffc0a0e49db), and the source review used MobX commit
[`825244a`](https://github.com/mobxjs/mobx/commit/825244a92e0005174ec103f88aa6682248b1298e)
and the latest stable release, [`mobx@6.16.1`](https://github.com/mobxjs/mobx/releases/tag/mobx%406.16.1).
Rules that depend on MobX 6 semantics must fail closed for an unknown future major.

## Recommendation

This foundation adds MobX version and binding capabilities, shared exact-import analysis, and the
first three P0 rules. Build observable-provenance and class-analysis layers on top of it before
implementing the remaining P0 rules. A recently reverted disposer prototype supplied useful prior
art, but no dedicated MobX rule was present on the research baseline.

| Priority | Rule                                             | Failure                                                            | Recommendation                    |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------- |
| P0       | `mobx-reaction-disposer-discarded`               | Reactions outlive their owner and leak work or memory              | Restore the precise prototype     |
| P0       | `mobx-no-make-auto-observable-in-inheritance`    | Runtime exception or unsupported annotation inheritance            | Implement first                   |
| P0       | `mobx-no-computed-side-effects`                  | Computed values stall, loop, or mutate while deriving              | Implement first                   |
| P0       | `mobx-async-action-requires-action`              | Observable writes after an async boundary escape the action        | Implement first                   |
| P0       | `mobx-no-observer-wrapped-memo`                  | `observer` throws when given an already memoized component         | Implement first                   |
| P0       | `mobx-make-observable-unconditional`             | Some instances are never annotated or are annotated twice          | Implement first                   |
| P1       | `mobx-legacy-decorator-needs-make-observable`    | Legacy decorators silently do not initialize annotations           | Implement after config detection  |
| P1       | `mobx-initialize-before-make-auto-observable`    | Fields added later are not observable                              | Implement with emit-aware proof   |
| P1       | `mobx-observable-read-needs-observer`            | React renders do not subscribe to observable reads                 | Implement same-file v1            |
| P1       | `mobx-observer-before-inject`                    | `observer` wraps a component that hides the actual observable read | Implement exact `inject` case     |
| P1       | `mobx-reaction-requires-observable`              | A reaction never subscribes and never runs again                   | Implement definite-empty cases    |
| P1       | `mobx-no-invalid-observable-override`            | Subclass construction throws or an override is not annotated       | Implement same-file hierarchies   |
| P1       | `mobx-no-observable-prop-to-untracked-child`     | Deep observable changes never update a non-observer child          | Validate same-file v1             |
| P2       | `mobx-no-stale-observable-snapshot-after-await`  | A deferred callback uses a pre-`await` snapshot                    | Gather more OSS evidence          |
| P2       | `mobx-no-reaction-comparison-value-mutation`     | Structural reactions can loop or compare against corrupted state   | Implement only exact comparer use |
| P2       | `mobx-observer-class-no-should-component-update` | MobX cannot safely compose with custom update suppression          | Implement if class usage warrants |
| P2       | `mobx-enable-static-rendering-for-ssr`           | Server renders retain reaction state                               | Wait for project-wide proof       |
| P2       | `mobx-no-rest-destructure-observable`            | A tracked function subscribes to every property                    | Performance category only         |

## Evidence reviewed

The rule list is based on four evidence layers:

1. Official documentation and current runtime source, especially
   [observable state](https://mobx.js.org/observable-state.html),
   [actions](https://mobx.js.org/actions.html),
   [computeds](https://mobx.js.org/computeds.html),
   [reactivity](https://mobx.js.org/understanding-reactivity.html),
   [React integration](https://mobx.js.org/react-integration.html),
   [subclassing](https://mobx.js.org/subclassing.html), and
   [runtime linting configuration](https://mobx.js.org/configuration.html).
2. The official `eslint-plugin-mobx` implementation and its known precision limits, including
   [`missing-observer`](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/eslint-plugin-mobx/src/missing-observer.js),
   [`unconditional-make-observable`](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/eslint-plugin-mobx/src/unconditional-make-observable.js),
   and
   [`exhaustive-make-observable`](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/eslint-plugin-mobx/src/exhaustive-make-observable.js).
3. MobX issues, pull requests, and discussions that document real failures and false positives.
4. Open-source MobX usage and community-authored MobX skills, used for discovery rather than as
   authority.

The current official ESLint rules are mostly syntax and name based. React Doctor should not copy
that detector shape. Every new rule below requires exact module provenance, immutable bindings, and
a fail-closed path when ownership cannot be proven.

## Shared foundation

### Version capabilities

The main-branch baseline has no MobX project fact or capability. This foundation adds the capability
model below. Reverted foundation commit
[`3018538`](https://github.com/millionco/react-doctor/commit/3018538b7c245461057ca6ce01177b2e0bc28d75) briefly introduced a
`getMobxVersion` helper that preferred `mobx` but fell back to the versions of `mobx-react`,
`mobx-react-lite`, or `mobx-state-tree`, then emitted only a bare `mobx` capability. That shape is
useful for ecosystem detection but unsafe for core-version gates because binding package versions
are independent of MobX core.

Foundation capabilities:

- `mobx` for any supported MobX ecosystem installation.
- `mobx:4`, `mobx:5`, and `mobx:6` from a direct `mobx` dependency only.
- Separate unversioned capabilities for `mobx-react`, `mobx-react-lite`, `mobx-state-tree`, and
  `mobx-react-observer` when a rule depends on that package.
- `mobx-react-binding` when `mobx-react` or `mobx-react-lite` supplies the runtime React observer
  integration. This is the explicit any-of gate for rules that support both official React
  bindings; `Rule.requires` itself intentionally has all-of semantics. The
  `mobx-react-observer` transform remains a separate escape-hatch capability because it does not
  export the runtime APIs those rules inspect.

Mixed workspace ranges should select the oldest supported declared MobX major. Unparseable ranges,
missing direct core dependencies, and future majors should receive only `mobx`, causing
major-sensitive rules to skip.

The latest official release checked during this audit is
[`mobx@6.16.1`](https://github.com/mobxjs/mobx/releases/tag/mobx%406.16.1). Every researched rule is
encoded in `MOBX_RULE_GATES`; a registered `mobx-*` rule must reuse the matching `requires` and
`disabledWhen` values exactly. The registry test rejects a MobX rule that has no contract entry or
weakens its gate. A bare `mobx` capability is never sufficient to enable one of these rules:
`mobx:4` is the supported-version floor and also proves a direct MobX core dependency.

| Rule                                             | Required capabilities                          | Disabled when         |
| ------------------------------------------------ | ---------------------------------------------- | --------------------- |
| `mobx-reaction-disposer-discarded`               | `mobx:4`                                       | —                     |
| `mobx-no-make-auto-observable-in-inheritance`    | `mobx:6`                                       | —                     |
| `mobx-no-computed-side-effects`                  | `mobx:4`                                       | —                     |
| `mobx-async-action-requires-action`              | `mobx:4`                                       | —                     |
| `mobx-no-observer-wrapped-memo`                  | `mobx:4`, `mobx-react-binding`, `react`        | —                     |
| `mobx-make-observable-unconditional`             | `mobx:6`                                       | —                     |
| `mobx-legacy-decorator-needs-make-observable`    | `mobx:6`                                       | —                     |
| `mobx-initialize-before-make-auto-observable`    | `mobx:6`                                       | —                     |
| `mobx-observable-read-needs-observer`            | `mobx:4`, `mobx-react-binding`, `react`        | `mobx-react-observer` |
| `mobx-observer-before-inject`                    | `mobx:4`, `mobx-react`, `react`                | —                     |
| `mobx-reaction-requires-observable`              | `mobx:4`                                       | —                     |
| `mobx-no-invalid-observable-override`            | `mobx:6`                                       | —                     |
| `mobx-no-observable-prop-to-untracked-child`     | `mobx:4`, `mobx-react-binding`, `react`        | —                     |
| `mobx-no-stale-observable-snapshot-after-await`  | `mobx:4`                                       | —                     |
| `mobx-no-reaction-comparison-value-mutation`     | `mobx:4`                                       | —                     |
| `mobx-observer-class-no-should-component-update` | `mobx:4`, `mobx-react`, `react`                | —                     |
| `mobx-enable-static-rendering-for-ssr`           | `mobx:4`, `mobx-react-binding`, `react`, `ssr` | —                     |
| `mobx-no-rest-destructure-observable`            | `mobx:4`, `mobx-react-binding`, `react`        | —                     |
| `mobx-computed-depends-on-non-observable`        | `mobx:4`                                       | —                     |
| `mobx-no-keepalive-computed-without-disposal`    | `mobx:4`                                       | —                     |

`makeObservable`, `makeAutoObservable`, `override`, and the MobX 6 legacy-decorator migration
contract are gated on `mobx:6`. React rules require both React itself and the package family that
exports the API they inspect. `inject` and class-component rules require `mobx-react` specifically;
rules supporting either official observer package use `mobx-react-binding`. The SSR rule additionally
requires an SSR-capable project, and the missing-observer rule turns off when the observer compiler
transform is installed.

### Exact import resolution

Recover the exact import logic from the reverted
[`mobx-reaction-disposer-discarded`](https://github.com/millionco/react-doctor/blob/3018538b7c245461057ca6ce01177b2e0bc28d75/packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/mobx-reaction-disposer-discarded.ts)
prototype and combine it with the current `getImportedName`, `getImportDeclarationForSymbol`,
`getImportedNameFromModule`, `isNamespaceImportFromModule`, and `getStaticPropertyName` utilities.

The resolver should prove:

- Named imports and immutable aliases from `mobx`, `mobx-react`, and `mobx-react-lite`.
- Namespace calls such as `mobx.makeAutoObservable` and `mobxReact.observer`.
- Whether a reference is shadowed or reassigned before use.
- Known React wrappers from exact `react` imports, including `memo` and `forwardRef`.

Do not infer library identity from spellings such as `observer`, `action`, or
`makeAutoObservable`. Cross-file re-exports remain out of scope until React Doctor has a reusable
import-graph abstraction.

### Same-file MobX registry

Build one registry that records only statically proven facts:

- Objects returned by `observable`, `observable.object`, `observable.array`, `observable.map`,
  `observable.set`, and `observable.box`.
- Classes and instances passed to `makeObservable` or `makeAutoObservable`.
- Explicit annotation maps, legacy decorators, and modern decorators.
- Members inferred as observable, computed, action, `autoAction`, or `flow`.
- Values returned by `useLocalObservable`.
- Components wrapped by exact `observer` or rendered within an exact `Observer` callback.
- Same-file class inheritance and the constructor control-flow graph.

Unknown custom annotations, mutable aliases, dynamic property names, imported stores, and custom
wrappers should stop propagation rather than produce a diagnostic.

### Existing coverage and reuse

Do not add duplicates for cases already covered on the baseline:

- `no-create-store-in-render` already recognizes exact `makeAutoObservable` imports and catches
  store construction during component or hook rendering.
- React display-name and same-file memo analysis already recognize `observer` wrappers.

The reverted `mobx-reaction-disposer-discarded` prototype is prior art, not current coverage. It
handled exact `reaction` and `autorun` imports, namespace calls, stored and forwarded disposers,
`disposeOnUnmount`, AbortSignal ownership, module lifetime, and process-lifetime wiring. Its
deliberate exclusion of synchronous `when`, `observe`, and `intercept` should survive restoration.
The GitHub audit found no open MobX PR or remote MobX rule branch to rebase as of the research
snapshot; future MobX rule PRs should target this foundation branch.

## P0 rule contracts

### `mobx-reaction-disposer-discarded`

Report an exact MobX `reaction` or `autorun` whose returned disposer is discarded in owner-scoped
code when the observation callback is proven to depend on state outside that owner or calls an
instance method whose dependencies cannot be bounded statically.

Both APIs create tracked computations that keep observing until disposed. Discarding the disposer
inside a component lifecycle, class instance, request, or other bounded owner lets the reaction
outlive that owner and retain closures, state, and work.

Strong positive:

```ts
class ViewModel {
  constructor() {
    autorun(() => syncTitle(projectStore.title));
  }
}
```

Valid ownership:

```ts
const dispose = reaction(() => store.query, refresh);
return () => dispose();
```

```ts
reaction(() => store.query, refresh, { signal: controller.signal });
```

Detector contract:

- Require exact named or namespace imports of `reaction` and `autorun` from `mobx`.
- Report expression statements and other contexts that consume the result without preserving or
  forwarding disposer ownership.
- Accept storage, return, assignment to an owned field, passing to exact `disposeOnUnmount`, and a
  statically present non-null AbortSignal option.
- Exempt bare module-scope execution, module-invoked bootstrap wiring, and constructors of same-file
  module singletons because their intended lifetime is the process.
- Exempt callbacks whose visible observation reads are entirely rooted at `this`; MobX can garbage
  collect those reactions when the instance owns the observed state. Keep indirect instance method
  calls in scope because their dependencies are not statically bounded.
- Treat imported mutation-shaped calls such as `Storage.set(this.value)` as sinks rather than
  external observable reads, while imported property reads and accessor calls remain external.
- Exclude `when`, whose effect form auto-disposes after it fires, and exclude `observe` and
  `intercept`, whose names collide with unrelated APIs and need their own provenance contract.
- Treat unknown options conservatively when they may contain a signal.

Test seeds include aliased, destructured-namespace, and namespace imports; a shadowed `reaction`; a
disposer stored then invoked on teardown; concise React effect cleanup; callback self-disposal;
AbortSignal through a stable options object; owned-only and external observations; module IIFEs;
request handlers; singleton constructors; and coercion or comparison of the returned disposer.

Evidence:

- [Official reactions disposal guidance](https://mobx.js.org/reactions.html#always-dispose-of-reactions)
- [Official AbortSignal option](https://mobx.js.org/reactions.html#options-)
- [Reverted React Doctor precision prototype](https://github.com/millionco/react-doctor/blob/3018538b7c245461057ca6ce01177b2e0bc28d75/packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/mobx-reaction-disposer-discarded.ts)

Targeted open-source evaluation found and fixed two false-positive classes: concise React effect
callbacks that return the disposer, and callbacks whose reads are provably owned by the same
instance. After those fixes, six MobX-heavy repositories produced one inspected true positive and
no false positives for this rule.

### `mobx-no-make-auto-observable-in-inheritance`

Report `makeAutoObservable(this)` when the containing class extends another class or when the
containing class is itself extended in the same file.

MobX explicitly does not support `makeAutoObservable` with inheritance. Current development builds
throw for a class with a superclass, and the same ambiguity applies when a base constructor runs on
a subclass instance. The supported alternatives are composition or explicit `makeObservable`
annotations.

Strong positive:

```ts
import { makeAutoObservable } from "mobx";

class ChildStore extends BaseStore {
  constructor() {
    super();
    makeAutoObservable(this);
  }
}
```

Valid alternative:

```ts
import { action, makeObservable, observable, override } from "mobx";

class ChildStore extends BaseStore {
  count = 0;

  constructor() {
    super();
    makeObservable(this, { count: observable, reset: override });
  }

  reset() {
    this.count = 0;
  }
}
```

Detector contract:

- Require an exact `makeAutoObservable` import or namespace binding and `mobx:6`.
- Resolve the call to the lexical class constructor and require the first argument to be that
  constructor's `this`.
- Report a syntactic class superclass and a same-file class that is extended later.
- Follow immutable aliases to the MobX function, but not wrapper helpers.
- Do not report `makeObservable`, plain observable objects, interfaces, generic constraints, modern
  decorators, or a locally declared function with the same name.
- Keep cross-file “this base is subclassed elsewhere” analysis out of v1.

Test seeds include anonymous class expressions, namespace imports, aliased imports, a base class
extended before and after its declaration, a shadowed import, `extends null`, and a generic type
whose constraint contains `extends`.

Evidence:

- [Official subclassing limitations](https://mobx.js.org/subclassing.html)
- [`makeAutoObservable` runtime guard](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/mobx/src/api/makeObservable.ts)
- [Discussion #2850: why auto inference cannot support subclassing](https://github.com/mobxjs/mobx/discussions/2850)
- [Real open-source subclass usage](https://github.com/liriliri/tinker/blob/master/plugins/tinker-timer/src/store.ts)

Open question: whether the first release should report only direct subclasses, the highest-confidence
runtime failure, before enabling the same-file “class is subclassed” branch.

### `mobx-no-computed-side-effects`

Report a computed derivation that definitely mutates a proven observable or invokes a same-file
action that definitely mutates one.

Computed values must be pure. A side effect can cause a reaction cycle, violate strict actions, or
leave the computed permanently stale. MobX users have reported production computed values that stop
updating after a nested `runInAction` even though no warning is emitted.

Strong positives:

```ts
class Store {
  count = 0;
  lastTotal = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get total() {
    this.lastTotal = this.count * 2;
    return this.lastTotal;
  }
}
```

```ts
const total = computed(() => {
  runInAction(() => store.refresh());
  return store.count;
});
```

Valid derivation:

```ts
const total = computed(() => store.items.reduce((sum, item) => sum + item.price, 0));
```

Detector contract:

- Recognize exact `computed(() => ...)`, `@computed`, modern computed decorators, explicit
  `makeObservable` computed annotations, and getters inferred by `makeAutoObservable`.
- Track assignments, updates, `delete`, and known mutator methods only when their receiver is a
  proven observable or observable member.
- Report `runInAction`, an `action` callback, or a same-file action call only when its reachable body
  contains a proven observable write.
- Include writes on some conditional paths; purity is violated even if the branch is not always
  taken.
- Do not report mutation of a freshly allocated local collection, logging, metrics, memo caches that
  are proven non-observable, or an unresolved helper call.
- Do not classify a getter as computed unless annotations or `makeAutoObservable` provenance prove
  it.

Test seeds should include indirect same-file action writes, local array sorting, an observable array
sort, a shadowed `computed`, a computed returning a new plain object, and a computed reading an
action without invoking it.

Evidence:

- [Official computed rules](https://mobx.js.org/computeds.html#rules)
- [Issue #1684: computed invokes an action that writes observable state](https://github.com/mobxjs/mobx/issues/1684)
- [Discussion #4544: computed plus `runInAction` silently stalls](https://github.com/mobxjs/mobx/discussions/4544)

Open question: begin with direct writes and exact `runInAction` bodies, then add a bounded same-file
call graph only after measuring false positives.

### `mobx-async-action-requires-action`

Report a direct write to a proven observable after `await` or in a promise continuation when that
write is not inside a fresh action boundary.

An action covers only the current synchronous tick. Code after `await`, and callbacks passed to
`then`, `catch`, or `finally`, run after the original action has ended. With action enforcement,
these writes warn or fail; without it, the update loses the intended transaction boundary.

Strong positive:

```ts
class SettingsStore {
  loaded = false;

  constructor() {
    makeAutoObservable(this);
  }

  async load() {
    const settings = await readSettings();
    this.loaded = settings !== undefined;
  }
}
```

Valid boundaries:

```ts
async load() {
  const settings = await readSettings();
  runInAction(() => {
    this.loaded = settings !== undefined;
  });
}
```

```ts
async resolve() {
  const user = await api.getUser();
  this.addUser(user);
}

addUser(user: User) {
  this.users.set(user.id, user);
}
```

The second example is valid when `addUser` is proven to be an action or a method inferred as an
`autoAction` by the same `makeAutoObservable` instance.

Detector contract:

- Require MobX provenance for the target observable and an async boundary that dominates the write.
- Recognize methods inferred by `makeAutoObservable`, explicit `action` annotations, action
  decorators, and callbacks wrapped by exact `action` imports.
- Treat exact `runInAction` and `action` callback bodies as fresh boundaries.
- Treat calls to a same-file proven action or autoAction as valid. Do not require the caller to wrap
  a second time.
- Treat generator methods annotated or inferred as `flow` as valid across `yield`.
- Cover `try`, `catch`, and `finally` paths after an `await`, plus promise handlers created inside an
  action.
- Do not report reads, writes before the first async boundary, non-observable fields explicitly
  annotated `false`, or unresolved imported objects.
- Skip when the MobX major or annotation ownership is unknown.

Test seeds include two awaits, an early-return branch with no await, an await in only one branch,
destructured `runInAction`, a shadowed wrapper, delegated action calls, delegated non-action calls,
`flow`, promise handlers, and writes in `finally`.

Evidence:

- [Official asynchronous action guidance](https://mobx.js.org/actions.html#asynchronous-actions)
- [Open-source unsafe post-await writes](https://github.com/wjszxli/AiAllSupport/blob/692f24cb4ab64c9e9d09520e9cfc9064a9124765/src/store/setting.ts#L178-L229)
- [Open-source valid `runInAction` boundary](https://github.com/coingrig/coingrig-wallet/blob/0589c28b60370520e57db690c2f59437460ad7e7/src/stores/market.ts#L31-L42)
- [Open-source valid delegated action](https://github.com/spacebarchat/client/blob/360d432d46893c66f84dc3783d2d3d5a1fbf6ad8/src/stores/UserStore.ts#L47-L53)

Open question: whether promise-handler coverage belongs in v1 or should follow the more mechanically
provable post-`await` branch.

### `mobx-no-observer-wrapped-memo`

Report `observer(memo(Component))`, `observer(React.memo(Component))`, and
`observer(observer(Component))` when all wrappers have exact import provenance.

`observer` already applies `memo`. Current `mobx-react-lite` development builds throw when the
component passed to `observer` is already a React memo component. This is a runtime-invalid wrapper
order, not a preference about redundant optimization.

Strong positive:

```tsx
const Profile = observer(memo(ProfileView));
```

Valid combinations:

```tsx
const Profile = memo(observer(ProfileView));
const Input = observer(forwardRef(InputView));
```

The outer `memo` in the first valid example is redundant but supported. `forwardRef` must be applied
before `observer` because `memo` cannot be inserted before `forwardRef`.

Detector contract:

- Resolve `observer` from `mobx-react` or `mobx-react-lite` and `memo` or `forwardRef` from `react`.
- Follow immutable aliases and namespace member calls.
- Report a direct already-memoized argument and a same-file binding whose initializer resolves to
  an exact memo or observer wrapper.
- Allow `memo(observer(...))`, `observer(forwardRef(...))`, and the deprecated but still understood
  `observer(component, { forwardRef: true })` form.
- Do not infer wrapper identity from names, component display names, or imported custom HOCs.

Test seeds include namespace imports, aliases, a memoized binding passed later, double observer,
forwardRef, a shadowed `memo`, production-only compilation, and an unrelated userland `observer`.

Evidence:

- [Official React integration guidance](https://mobx.js.org/react-integration.html#observer)
- [`mobx-react-lite` runtime check and wrapper order](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/mobx-react-lite/src/observer.ts)
- [PR #3282: consolidate forwardRef and observer behavior](https://github.com/mobxjs/mobx/pull/3282)

### `mobx-make-observable-unconditional`

Report `makeObservable(this)` or `makeAutoObservable(this)` when constructor control flow can skip
the call or execute it more than once.

MobX requires annotation setup to be unconditional. Conditional setup creates instances with
different reactive shapes; loops or repeated paths can attempt to annotate the same target twice.

Strong positives:

```ts
constructor(enabled: boolean) {
  if (enabled) makeAutoObservable(this);
}
```

```ts
constructor(items: Item[]) {
  for (const item of items) makeObservable(this, annotationsFor(item));
}
```

Valid setup:

```ts
constructor(enabled: boolean) {
  makeAutoObservable(this, { enabled: false });
  this.enabled = enabled;
}
```

Detector contract:

- Require an exact MobX binding and a containing constructor.
- Build constructor path facts and require exactly one call on every normal construction path.
- Treat conditions, loops, short-circuit expressions, optional calls, callbacks, and nested function
  bodies as conditional or deferred.
- Allow unconditional calls inside a single lexical block or after `super()`.
- Do not report calls targeting another object, factory-created observable objects, or a helper with
  an unresolved implementation.
- If a constructor always throws on a path before setup, that path does not produce an instance and
  need not report.

Test seeds include early throws, early returns, switch exhaustiveness, try/finally, nested callbacks,
logical operators, and a constructor delegating to another constructor through inheritance.

Evidence:

- [Official annotation limitations](https://mobx.js.org/observable-state.html#limitations)
- [Official ESLint implementation](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/eslint-plugin-mobx/src/unconditional-make-observable.js)

Open question: v1 can deliberately cover only visibly conditional syntax, then move to full path
coverage after the project control-flow utility is proven reusable.

## P1 rule contracts

### `mobx-legacy-decorator-needs-make-observable`

Report a class using legacy MobX decorators without an unconditional `makeObservable(this)` in its
constructor.

Legacy TypeScript or Babel decorators only attach annotation metadata; MobX still needs
`makeObservable(this)` to apply it. Modern Stage 3 decorators do not need that call, so a
syntax-only rule is incorrect.

Strong positive in a legacy decorator project:

```ts
class Store {
  @observable count = 0;
  @computed get doubled() {
    return this.count * 2;
  }
}
```

Valid modern decorator form:

```ts
class Store {
  @observable accessor count = 0;
}
```

Detector contract:

- Require exact MobX decorator bindings and project compiler configuration proving legacy decorator
  semantics, such as TypeScript `experimentalDecorators`.
- Require an unconditional `makeObservable(this)` after `super()` in the class constructor.
- Allow inherited setup only where MobX's supported explicit-annotation inheritance model proves it
  applies to this class's own annotations.
- Never report a modern `@observable accessor`, a Stage 3 decorator project, `makeAutoObservable`,
  or a decorator imported from another module.
- Skip when decorator mode cannot be determined.

Evidence:

- [Official decorator setup and migration guide](https://mobx.js.org/enabling-decorators.html)
- [PR #3902: modern action field decorators without `makeObservable`](https://github.com/mobxjs/mobx/pull/3902)
- [Official `missing-make-observable` rule](https://github.com/mobxjs/mobx/tree/825244a92e0005174ec103f88aa6682248b1298e/packages/eslint-plugin-mobx)

Open question: Babel legacy decorator detection needs a project-config resolver before this can be
enabled outside TypeScript projects.

### `mobx-initialize-before-make-auto-observable`

Report a property that is definitely created only after `makeAutoObservable` has inspected its
target.

MobX can annotate only properties that exist when setup runs. Older TypeScript class-field emit,
plain-object mutation, and constructor assignments to undeclared properties can therefore leave a
field non-observable.

Strong positives:

```ts
const store = {};
makeAutoObservable(store);
store.loaded = false;
```

```ts
class Store {
  constructor() {
    makeAutoObservable(this);
    this.loaded = false;
  }
}
```

The class example is reportable only when project emit and the class declaration prove that
`loaded` did not exist before the call.

Valid setup:

```ts
class Store {
  loaded = false;

  constructor() {
    makeAutoObservable(this);
  }
}
```

Detector contract:

- For plain objects, track definite property creation after setup through assignments,
  `Object.assign`, and `defineProperty` with static keys.
- For classes, consult `useDefineForClassFields`, target defaults, field initializers, parameter
  property emit, and constructor assignment order.
- Report only a static property that is proven absent at setup and created later on every relevant
  path.
- Do not report mutation of an already existing observable property, an uninitialized field that
  define semantics create as `undefined`, or a member explicitly excluded with `false`.
- Skip JavaScript transpilation modes and custom transforms whose field emit cannot be established.

Evidence:

- [Official requirement that annotated properties already exist](https://mobx.js.org/observable-state.html#limitations)
- [Issue #3815: constructor assignment after setup does not rerender](https://github.com/mobxjs/mobx/issues/3815)
- [Discussion #2831: initialize properties before annotation](https://github.com/mobxjs/mobx/discussions/2831)

Open question: begin with plain objects and undeclared class properties, then expand only after
adding a shared TypeScript field-emit model.

### `mobx-observable-read-needs-observer`

Report a React component that definitely reads a proven observable during render but has no proven
MobX tracking boundary.

MobX tracks property access inside `observer` renders. Reading an observable in an ordinary React
component produces markup but does not subscribe that component to later changes.

Strong positive:

```tsx
const store = observable({ name: "Ada" });

const Profile = () => <p>{store.name}</p>;
```

Valid tracking boundaries:

```tsx
const Profile = observer(() => <p>{store.name}</p>);
```

```tsx
const Profile = () => <Observer>{() => <p>{store.name}</p>}</Observer>;
```

Detector contract:

- Require a component recognized by existing React component analysis and a same-file proven
  observable read executed during render.
- Recognize exact `observer` wrappers or decorators from both React bindings and exact `Observer`
  render callbacks.
- Treat reads inside event handlers, effects, timers, memo callbacks, or other deferred functions as
  outside the component's render tracking.
- Skip projects with the `mobx-react-observer` Babel or SWC transform unless its configuration can
  prove whether the current file is transformed.
- Do not flag every capitalized function, imported store by naming convention, or components that
  only pass an observable reference without reading a property.
- Cross-file observable provenance and wrapper re-exports remain out of v1.

Test seeds include a local observable, `useLocalObservable`, nested callbacks, `Observer`, wrapper
aliases, automatic observer transform configuration, a component returning another component, and
a normal function whose name is capitalized.

Evidence:

- [Official React observer guidance](https://mobx.js.org/react-integration.html#always-read-observables-inside-observer-components)
- [Official automatic observer transform](https://mobx.js.org/react-integration.html#observer)
- [Issue #3908: official lint rule false positive for `observer(forwardRef(...))`](https://github.com/mobxjs/mobx/issues/3908)
- [PR #3909: fix the forwardRef false positive](https://github.com/mobxjs/mobx/pull/3909)

Open question: measure how much useful same-file coverage exists before investing in cross-file
observable provenance.

### `mobx-observer-before-inject`

Report `observer(inject(...))` from exact `mobx-react` bindings.

`inject` already produces a component wrapper. Applying `observer` outside it means the observer
does not necessarily execute the component that reads observables. Current MobX source warns that
`observer` should be applied before `inject`, making this a high-confidence special case of the
broader “observer should be innermost” guidance.

Strong positive:

```tsx
export const Profile = observer(inject("userStore")(ProfileView));
```

Valid order:

```tsx
export const Profile = inject("userStore")(observer(ProfileView));
```

Detector contract:

- Require exact `observer` and `inject` bindings from `mobx-react`.
- Resolve direct calls, immutable aliases, namespace calls, and a same-file binding initialized by
  `inject` before it is passed to `observer`.
- Do not generalize v1 to every userland HOC.
- Leave `memo` to `mobx-no-observer-wrapped-memo` and allow `forwardRef` in its supported inner
  position.

Evidence:

- [`mobx-react` warning for observer after inject](https://github.com/mobxjs/mobx/blob/825244a92e0005174ec103f88aa6682248b1298e/packages/mobx-react/src/observer.tsx)
- [Official HOC order guidance](https://mobx.js.org/react-integration.html#observer)

### `mobx-reaction-requires-observable`

Report a `reaction` data function or `autorun` body that is proven to read no observable value.

A reaction subscribes only to observable property accesses during its tracked function. A literal,
local constant, or empty callback creates no dependency and will never rerun. MobX exposes
`reactionRequiresObservable` as a runtime lint option for this mistake.

Strong positives:

```ts
reaction(() => 42, refresh);
autorun(() => console.log("started"));
```

Valid reaction:

```ts
reaction(() => store.user.id, refresh);
```

Detector contract:

- Require exact `reaction` or `autorun` provenance.
- Report only when the tracked callback is fully analyzable and every path contains no proven or
  unknown member read that could be observable.
- Literals, immutable local primitives, type operations, and calls to proven pure local helpers do
  not count as observable reads.
- Any unresolved member access, helper call, getter, imported value, or dynamic operation causes
  the rule to skip.
- Do not apply this rule to the effect callback of `reaction` or to `when`.

Evidence:

- [Official reactivity model](https://mobx.js.org/understanding-reactivity.html)
- [Official runtime lint options](https://mobx.js.org/configuration.html#linting-options)
- [Discussion #3964: reaction created before it reads an observable](https://github.com/mobxjs/mobx/discussions/3964)

Open question: the most conservative v1 should cover empty callbacks and primitive expressions only.

### `mobx-no-invalid-observable-override`

Report an unsupported observable member override in a same-file class hierarchy.

MobX annotations make instance fields, including arrow-function actions, non-configurable. A
subclass that redeclares one throws `Cannot redefine property`. Prototype actions, flows, computed
getters, and bound actions can be overridden only through the explicit `override` annotation.

Strong positives:

```ts
class BaseStore {
  save = () => {};

  constructor() {
    makeObservable(this, { save: action });
  }
}

class ChildStore extends BaseStore {
  save = () => {};
}
```

```ts
class ChildStore extends BaseStore {
  save() {}

  constructor() {
    super();
    makeObservable(this, { save: action });
  }
}
```

Valid prototype override:

```ts
class ChildStore extends BaseStore {
  save() {}

  constructor() {
    super();
    makeObservable(this, { save: override });
  }
}
```

Detector contract:

- Build only same-file, statically resolved class hierarchies.
- Record base annotations and whether the member is an instance field, arrow function, prototype
  method, generator, getter, or bound action.
- Report redeclaration of annotated instance fields regardless of child annotation.
- For supported prototype members, report an exact child MobX annotation other than `override` or a
  missing child annotation when setup is otherwise proven.
- Do not mix modern decorators with legacy annotation rules; current Stage 3 inheritance behavior
  must be tested independently.
- Skip computed member names, mixin helpers, cross-file bases, and dynamically generated annotation
  maps.

Evidence:

- [Official subclassing override table](https://mobx.js.org/subclassing.html)
- [Issue #2753: overriding an annotated arrow action throws](https://github.com/mobxjs/mobx/issues/2753)
- [PR #2641: annotation and subclassing rework](https://github.com/mobxjs/mobx/pull/2641)
- [PR #4661: Stage 3 decorator inheritance fix](https://github.com/mobxjs/mobx/pull/4661)

Open question: ship explicit `makeObservable` inheritance first and keep all decorator inheritance
out until fixtures cover compiler/runtime combinations.

### `mobx-no-observable-prop-to-untracked-child`

Report a proven observable object, array, map, or set passed to a same-file child that is proven not
to be an observer and reads its contents during render.

MobX tracks the component that dereferences an observable. Passing only the container reference does
not subscribe an ordinary child to deep changes, so the child can display stale data. The official
guidance is to make the child an observer or convert the value to plain data before crossing into a
non-observer component.

Strong positive:

```tsx
const Parent = observer(() => <UserTable users={store.users} />);

const UserTable = ({ users }: Props) => users.map((user) => <p>{user.name}</p>);
```

Valid boundaries:

```tsx
const UserTable = observer(({ users }: Props) => users.map((user) => <p>{user.name}</p>));
const Parent = observer(() => <ThirdPartyTable data={toJS(store.users)} />);
```

Detector contract:

- Require a same-file child component and same-file observable provenance for the prop expression.
- Prove the parent does not dereference the relevant deep value into plain props before passing it.
- Report only if the child synchronously reads a member, iterates, spreads, or destructures the
  observable prop during render without `observer` or `Observer`.
- Recognize exact `toJS` and plain projection through `map` when the result is freshly allocated and
  contains the values the child uses.
- Skip imported children, render-prop contracts, host elements, custom serialization helpers, and
  automatic observer transforms.

Evidence:

- [Official non-observer component guidance](https://mobx.js.org/react-integration.html#dont-pass-observables-into-components-that-arent-observer)
- [Issue #1768: computed value passed through a non-observer parent does not update](https://github.com/mobxjs/mobx/issues/1768)

Open question: run a targeted open-source evaluation before promotion because component provenance
may leave same-file v1 with limited reach.

## P2 and deferred contracts

### `mobx-no-stale-observable-snapshot-after-await`

Potential contract: inside an async callback, report a local snapshot read from a proven observable
before `await` and consumed after `await` when a direct member read would obtain current state.
Discussion [#4535](https://github.com/mobxjs/mobx/discussions/4535) demonstrates the bug. Do not
implement this as a blanket destructuring ban: destructuring during a synchronous observer render is
tracked and valid. This needs more evidence separating intentional snapshots from stale closures.

### `mobx-no-reaction-comparison-value-mutation`

Potential contract: for an exact `reaction` using `comparer.structural` or the legacy structural
comparison option, report mutation of the effect callback's current-value parameter. That mutation
changes the prior value against which the next result is compared and can create a loop. Issue
[#1135](https://github.com/mobxjs/mobx/issues/1135) is the seed. Skip default identity comparison,
unknown comparers, and mutation of a clone.

### `mobx-observer-class-no-should-component-update`

Potential contract: report `shouldComponentUpdate` on a class proven to be wrapped or decorated with
`observer`. The official `mobx-react` README says observer class components do not support custom
`shouldComponentUpdate`, and extending observer class components is unsupported. Before enabling,
measure current class-component usage and distinguish MobX's own shallow prop comparison from a user
override.

### `mobx-enable-static-rendering-for-ssr`

Potential contract: in an SSR-capable project using MobX React bindings, require one project-wide
`enableStaticRendering(true)` call in a server entry. Official React integration docs warn that
server rendering without it retains reaction state and can cause garbage-collection problems.
Single-file lint cannot prove a project-wide initialization call, and Next.js App Router placement
is still discussed inconsistently, so this should wait for a project index and framework-aware entry
resolution.

Evidence:

- [Official server-rendering requirement](https://mobx.js.org/react-integration.html#tips)
- [Discussion #4539: App Router placement questions](https://github.com/mobxjs/mobx/discussions/4539)

### `mobx-no-rest-destructure-observable`

Potential contract: in a proven tracked function, report object rest destructuring of a proven
observable because it reads every enumerable property and subscribes the derivation to all of them.
The official decorator guide documents this performance trap. It is not a correctness failure and
belongs in the performance category with a low-severity message. Ordinary named destructuring is
not equivalent and must remain valid.

### `mobx-computed-depends-on-non-observable`

The official computed rules advise against dependencies on non-observable values because cache
invalidation cannot see them. PR [#3324](https://github.com/mobxjs/mobx/pull/3324) describes this as
a hard-learned source of stale cache behavior. A detector needs proof that a mutable dependency is
non-observable, changes independently, and affects the result. Global constants and immutable props
are valid, so this should remain deferred until a dataflow contract is narrower than the prose rule.

### `mobx-no-keepalive-computed-without-disposal`

`computed({ keepAlive: true })` and a no-op `autorun` can retain a computed value indefinitely. The
official docs warn about memory leaks, but long-lived root stores legitimately use keep-alive
computeds. Only consider this rule when lifecycle ownership and disposal can be proven; do not ban
the option by syntax.

## Rejected rules

These ideas should not become default React Doctor rules:

- Require `observer` on every capitalized function or class. The official lint rule is intentionally
  opinionated and has documented wrapper false positives. Require a proven observable render read.
- Ban all observable destructuring. Synchronous destructuring inside a tracked render is valid.
- Require disposal of every `reaction`, `autorun`, and `when`. The existing rule already handles
  lifecycle and AbortSignal ownership; synchronous `when` with an effect auto-disposes.
- Ban `memo(observer(...))`. It is supported, only redundant. The invalid order is
  `observer(memo(...))`.
- Require every field in a `makeObservable` map. A plain field can intentionally remain
  non-observable, and the official exhaustive rule's `false` convention is a migration style.
- Require `configure` with all strict runtime lint flags. The official docs say the full strictness
  set can be annoying and may be disabled; `disableErrorBoundaries` is explicitly for debugging.
- Require `autoBind`, ban local observables, ban global stores, enforce one store, or cap store field
  count. These are architecture preferences, not static correctness invariants.
- Ban MobX for server state. Community skills sometimes recommend this, but MobX does not make the
  architecture invalid.
- Assume all async methods are broken. Writes before the first async boundary are inside the action;
  `runInAction`, `action`, `flow`, and delegation to another action are valid.
- Infer MobX from names. A local `observer` or `action` function is not enough evidence.

## Community MobX skill audit

Community skills were useful for discovering recurring advice, but they also show why official
runtime evidence must control rule contracts.

- [TerminalSkills MobX](https://github.com/TerminalSkills/skills/blob/13878c9dd5dc0ffaecbad15dba0fb08a84c07459/skills/mobx/SKILL.md)
  correctly highlights post-`await` `runInAction`, `observer`, computed values, and late
  dereferencing. It does not cover inheritance or computed side effects.
- [agents-inc `web-state-mobx`](https://github.com/agents-inc/skills/blob/79239b4d0e651cbc616769e1e147b34c5a6d1963/src/skills/web-state-mobx/SKILL.md)
  covers most official failure modes, but overstates disposal for `when`, treats a supported outer
  `memo` as invalid, and turns server-state architecture into a prohibition.
- [MatrixAges MobX skill](https://github.com/MatrixAges/polywise/blob/f8d2320f84fe07da327c5e2e690e50061ea4e599/.opencode/skills/mobx/SKILL.md)
  contains an async store example that mutates after `await` without a new action boundary, plus
  project-specific size and dependency-injection rules that should not become general lint.

The repeatable lesson is to encode runtime semantics, not slogans. “Wrap writes after an async
boundary” is precise; “all async actions need `runInAction`” is not. “Observer must see the read” is
precise; “every component needs observer” is not.

## Suggested implementation order

1. Add capability detection so direct MobX majors and React bindings are represented separately.
2. Recover exact MobX import resolution and `mobx-reaction-disposer-discarded` from the reverted
   prototype, adapting them to the current baseline and revalidating every lifecycle exemption.
3. Add a same-file MobX registry for annotations, observable members, actions, computeds, and
   observer components.
4. Implement `mobx-no-make-auto-observable-in-inheritance` and
   `mobx-no-observer-wrapped-memo`; both have small, high-confidence detector surfaces.
5. Implement direct-write v1 of `mobx-no-computed-side-effects` and
   `mobx-async-action-requires-action`, then add bounded same-file action delegation.
6. Implement syntax-first `mobx-make-observable-unconditional`, then upgrade it to path analysis if
   evaluation finds missed branches.
7. Run focused tests, fuzzing, and targeted open-source evaluation before promoting any P1 rule.
8. Keep P2 rules in research until each has an explicit false-positive budget and representative
   open-source positives.

## Validation criteria

A proposed rule should not move from this document to implementation until it has:

- At least one official documentation or runtime-source invariant.
- One issue, discussion, pull request, or real open-source example demonstrating impact when
  practical.
- Exact import and binding provenance.
- Explicit MobX major and React-binding compatibility.
- Strong positive and negative fixtures, including aliases and shadowing.
- A written fail-closed boundary for cross-file data and unknown helpers.
- Focused tests followed by fuzzing and a targeted React Doctor evaluation.

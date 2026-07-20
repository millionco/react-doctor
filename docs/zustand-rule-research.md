# Zustand Rule Research

This document defines the foundation and first rule portfolio for Zustand support in React Doctor.
It prioritizes observable correctness and rendering failures over store-style preferences.

Research snapshot: July 19, 2026. The official source review used Zustand commit
[`beca84e`](https://github.com/pmndrs/zustand/commit/beca84e600e4e250f6b244d22878e72948f331c7).

## Recommendation

Use one shared capability and provenance layer, then build narrow rules on top of it. The first two
rules already have implementation PRs. The next five candidates have strong official evidence and
detectors that can fail closed when store provenance is uncertain.

| Priority | Rule                                             | Failure                                                    | Status                                                                      |
| -------- | ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| P0       | `zustand-no-fresh-selector-result`               | Infinite render loops in Zustand 5                         | Implemented in [#1395](https://github.com/millionco/react-doctor/pull/1395) |
| P0       | `zustand-no-whole-store-destructure`             | Component rerenders for every store update                 | Implemented in [#1398](https://github.com/millionco/react-doctor/pull/1398) |
| P0       | `zustand-no-get-during-initialization`           | `get()` reads `undefined` before initial state exists      | Implement next                                                              |
| P0       | `zustand-no-mutating-state`                      | Subscribers miss changes because references are reused     | Implement next                                                              |
| P1       | `zustand-subscribe-requires-selector-middleware` | Selector-style subscription silently uses the wrong API    | Implement next                                                              |
| P1       | `zustand-no-server-component-store-access`       | Request data leaks or disagrees with hydration             | Implement next, Next.js-gated                                               |
| P1       | `zustand-persist-name-unique`                    | Stores overwrite or hydrate from the same storage slot     | Implement next, same-file v1                                                |
| P2       | `zustand-devtools-middleware-order`              | Middleware erases the `devtools` `setState` type mutation  | Implement after middleware provenance utility                               |
| P2       | `zustand-persist-map-set-serialization`          | `Map` and `Set` contents disappear during JSON persistence | Implement after persist option analysis                                     |
| P2       | `zustand-persist-partialize-needs-merge`         | Shallow hydration removes nested default fields            | Implement only for exact static shapes                                      |
| P2       | `zustand-selector-needs-shallow`                 | Fresh selector results cause avoidable rerenders before v5 | Validate OSS noise before implementation                                    |

## Shared foundation

Every Zustand rule should reuse the same answers to these questions:

- Is `zustand` declared by this package or inherited through a workspace or catalog?
- Which supported major version is safe to assume?
- Does a binding resolve to an exact Zustand import rather than a matching local name?
- Was a bound hook created by `create` or `createWithEqualityFn` in this file?
- Was a vanilla store created by `createStore` in this file?
- Which known middlewares wrap the creator, and in what order?
- Is an alias immutable and unshadowed?

The foundation branch provides `zustand` and `zustand:1` through `zustand:5` capabilities. Mixed
workspaces select the oldest supported declared major. Unparseable ranges and future majors receive
only the unversioned capability, so version-sensitive rules fail closed.

Cross-file store provenance is deliberately out of scope until React Doctor has a reusable import
graph abstraction for rules. A rule should skip an imported `useBearStore` rather than infer its
library from the name.

## Existing coverage and reuse

Do not create duplicate Zustand variants for these cases:

- `no-create-store-in-render` already recognizes Zustand `create` and `createStore` imports and
  catches store factories executed during component or hook rendering.
- The generic effect cleanup rule already catches subscriptions whose unsubscribe function is not
  returned from an effect.
- `redux-useselector-returns-new-collection` and `redux-useselector-inline-derivation` provide
  reusable selector-allocation patterns.
- The state-update correctness work has mutation, alias, and freshness analysis that should be
  extracted or adapted for `zustand-no-mutating-state` rather than reimplemented.

## Rule contracts

### `zustand-no-get-during-initialization`

This rule catches synchronous calls to the creator's `get` parameter while Zustand is still
constructing the initial state.

Zustand's TypeScript guide documents that `get()` returns `undefined` before the initial state has
been installed even though its public type says otherwise. Reading a property from that value can
crash store creation.

Strong positive:

```ts
import { create } from "zustand";

const useStore = create<{ count: number }>()((_set, get) => ({
  count: get().count,
}));
```

Valid deferred read:

```ts
const useStore = create<State>()((_set, get) => ({
  count: 0,
  readCount: () => get().count,
}));
```

Detector contract:

- Prove the creator comes from `create`, `createStore`, or `createWithEqualityFn` through an exact
  Zustand import and immutable same-file aliases.
- Resolve the creator callback's `get` parameter by binding, not by spelling.
- Report calls executed while evaluating the initial-state return value, including object fields,
  spreads, computed keys, synchronous helper IIFEs, and parameter defaults.
- Stop at deferred boundaries such as action functions, event callbacks, effects, timers, and
  promise continuations.
- Do not report `get` from another binding, a userland factory with the same name, or an imported
  custom store hook.
- Support Zustand 1 through 5. Revalidate before enabling for a future major.

Evidence:

- [Advanced TypeScript guide: unsound synchronous `get`](https://zustand.docs.pmnd.rs/learn/guides/advanced-typescript#be-a-little-careful)
- [Zustand vanilla store implementation](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)

### `zustand-no-mutating-state`

This rule catches mutation of a proven Zustand state snapshot when the changed reference is reused
or no notifying `set` operation follows.

Zustand compares replacement state with `Object.is`, shallow-merges ordinary updates, and selectors
normally compare their selected value by identity. Mutating the old object, array, `Map`, or `Set`
can therefore produce no notification or make a selector observe the same reference and skip the
update. Maintainers diagnosed this exact cause in [#244](https://github.com/pmndrs/zustand/issues/244)
and [#1115](https://github.com/pmndrs/zustand/issues/1115).

Strong positives:

```ts
set((state) => {
  state.user.name = name;
  return { user: state.user };
});

const items = store.getState().items;
items.push(item);
store.setState({ items });
```

Valid updates:

```ts
set((state) => ({ user: { ...state.user, name } }));

const nextItems = [...store.getState().items, item];
store.setState({ items: nextItems });
```

```ts
const useStore = create(
  immer((set) => ({
    increment: () => set((state) => void state.count++),
  })),
);
```

Detector contract:

- Resolve `set` callback parameters, `get()` snapshots, and `store.getState()` snapshots only from
  proven same-file Zustand stores.
- Analyze updater state parameters passed to both creator `set(...)` and bound or vanilla
  `store.setState(...)` calls.
- Track direct assignment, update expressions, mutating array methods, and `Map` or `Set` mutators.
- Report when the mutated snapshot or a mutated child reference is returned through `set`, passed
  back to `setState`, or mutated without a notifying update.
- Require the paired `set` parameter or resulting bound store's `setState` to be used before
  treating `get()` mutations without a notifier as reactive-state bugs. A creator with neither
  can deliberately use Zustand as an imperative cache with no subscribers.
- Treat a surrounding `set` updater's returned value as the notifier for `get()` snapshots read
  inside that updater, and abstain whenever replacement freshness cannot be proven.
- Match notifiers to the exact creator or bound store, including same-branch ordering for simple
  `if` statements and aliases introduced inside a branch. Another store or mutually exclusive
  branch cannot publish the mutation.
- Pair creator `get()` snapshots with either its `set` parameter or the resulting bound store's
  `setState`, while keeping `getState` snapshot provenance exact to one store.
- Follow ordered mutable-alias rebindings on the mutation's execution path and accept a clone
  published at the original state path. Ignore mutually exclusive branch rebindings and abstain
  when a conditional rebind cannot be proven to run.
- Compare nested replacement paths from the snapshot root so a direct `get()` or `getState()`
  chain cannot hide reuse inside a nested object update.
- Treat clone-before-mutate as valid when the clone is statically proven fresh.
- Treat mutation inside a creator wrapped by the official `immer` middleware as valid.
- Follow mutations through simple `if`/`else` branches when every branch rejoins before the
  notifying update; fail closed when a branch returns or throws.
- Skip unknown custom middleware, unresolved helper calls, and cross-file stores unless ownership
  and freshness can be proven.
- Reuse existing mutation and fresh-reference analysis. Do not add a second general-purpose walker.

Evidence:

- [Immutable state and merging guide](https://zustand.docs.pmnd.rs/learn/guides/immutable-state-and-merging)
- [`create` API immutable update guidance](https://zustand.docs.pmnd.rs/reference/apis/create)
- [Map and Set usage guide](https://zustand.docs.pmnd.rs/learn/guides/maps-and-sets-usage)
- [Issue #244: mutation prevents rerender](https://github.com/pmndrs/zustand/issues/244)
- [Issue #1115: mutating nested state reuses the selected reference](https://github.com/pmndrs/zustand/issues/1115)

### `zustand-subscribe-requires-selector-middleware`

This rule catches `store.subscribe(selector, listener)` when the proven store creator is not wrapped
by `subscribeWithSelector`.

The vanilla store's base `subscribe` API accepts one listener. The selector overload is installed by
`subscribeWithSelector`. JavaScript, casts, and loose wrapper types can bypass the TypeScript error,
leaving code that looks subscribed to a slice but is not using the selector API.

Strong positive:

```ts
import { createStore } from "zustand/vanilla";

const store = createStore(() => ({ count: 0 }));
store.subscribe((state) => state.count, console.log);
```

Valid subscription:

```ts
const store = createStore(subscribeWithSelector(() => ({ count: 0 })));
store.subscribe((state) => state.count, console.log);
```

Detector contract:

- Prove the receiver is a same-file bound or vanilla Zustand store.
- Report calls with at least two positional arguments unless the creator is wrapped by the exact
  `subscribeWithSelector` import from `zustand/middleware`.
- Follow immutable aliases and nested known middleware composition.
- Allow the base one-listener signature and all overloads on a proven enhanced store.
- Skip computed `subscribe` members, reassigned receivers, custom middleware, imported stores, and
  calls whose creator cannot be resolved.
- Verify historical middleware availability before choosing a major-version floor. The invalid
  base signature itself is version-independent.

Evidence:

- [Zustand README: using `subscribe` with a selector](https://github.com/pmndrs/zustand#using-subscribe-with-selector)
- [`subscribeWithSelector` middleware reference](https://zustand.docs.pmnd.rs/reference/middlewares/subscribe-with-selector)
- [Vanilla store source](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)

### `zustand-no-server-component-store-access`

This rule catches reads, writes, and hook calls against module-lifetime Zustand stores from Next.js
App Router Server Components or server-only modules.

Zustand's Next.js guide requires per-request stores, matching server and client initialization, and
no store reads or writes from React Server Components. A module singleton can be shared by concurrent
requests. The failure is both a correctness problem and a possible cross-request data exposure.

Strong positives:

```tsx
import { useSessionStore } from "./session-store";

export const Account = () => {
  const user = useSessionStore.getState().user;
  return <p>{user.name}</p>;
};
```

```tsx
export const Account = async () => {
  sessionStore.setState({ user: await loadUser() });
  return <Profile />;
};
```

Valid boundary:

```tsx
"use client";

export const Account = () => {
  const user = useSessionStore((state) => state.user);
  return <p>{user.name}</p>;
};
```

Detector contract:

- Require the Next.js capability and a file that is not a Client Component.
- Prove the accessed value is a Zustand store or bound hook. Cross-file proof requires a resolver;
  until then, v1 should cover same-file module stores and exact imported store metadata only.
- Report bound hook calls plus `.getState`, `.setState`, and action calls reached from `getState()`.
- Do not report store type imports, store factory declarations, or client files with a valid top-level
  `"use client"` directive.
- Do not turn this into a blanket prohibition on global Zustand stores in ordinary client-only React
  applications. Zustand intentionally supports that model.
- Consider shipping the easier mutation subset first if reliable cross-file read provenance is not
  available.

Evidence:

- [Official Next.js guide](https://zustand.docs.pmnd.rs/learn/guides/nextjs)
- [Discussion #2740: per-request stores and unsafe server writes](https://github.com/pmndrs/zustand/discussions/2740)
- [Discussion #2200: Server Components and SSR](https://github.com/pmndrs/zustand/discussions/2200)
- [Issue #182: singleton SSR state shared across users](https://github.com/pmndrs/zustand/issues/182)

### `zustand-persist-name-unique`

This rule catches two statically named `persist` stores that use the same storage key.

The persist documentation requires each store name to be unique. A collision makes independent stores
read and overwrite the same serialized value.

Strong positive:

```ts
const useCartStore = create(persist(cartCreator, { name: "app-store" }));
const useProfileStore = create(persist(profileCreator, { name: "app-store" }));
```

Detector contract:

- Resolve exact `persist` imports and statically evaluate string literals and no-substitution
  templates in the `name` option.
- Report later duplicate names among stores in the same file for v1.
- Skip dynamic names and option spreads whose final `name` value cannot be proven.
- A project-wide version belongs in a scan phase with deterministic whole-project collection, not in
  per-file rule state.
- Do not enforce a naming convention. Only collisions are diagnostic.

Evidence:

- [Persist middleware reference](https://zustand.docs.pmnd.rs/reference/middlewares/persist)
- [Persisting store data guide](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data)

### `zustand-devtools-middleware-order`

This rule catches known middleware wrapped outside `devtools`, such as `immer(devtools(creator))`.

Zustand's TypeScript guide recommends applying `devtools` last because it mutates `setState` and adds
a type parameter that an outer middleware can erase. Official examples compose it as
`devtools(persist(immer(creator)))`.

Detector contract:

- Resolve middleware imports from `zustand/middleware` and `zustand/middleware/immer`.
- Find `devtools` inside another known middleware call and report the outermost offending wrapper.
- Allow `devtools` as the outermost known wrapper.
- Skip custom middleware and unresolved aliases instead of guessing whether they preserve the
  `setState` mutation.
- Keep this a type-safety rule. Do not claim every alternative order changes runtime behavior.

Evidence:

- [Advanced TypeScript guide: `devtools` should be last](https://zustand.docs.pmnd.rs/learn/guides/advanced-typescript#using-middlewares)
- [Redux DevTools middleware guide](https://zustand.docs.pmnd.rs/reference/middlewares/devtools)

### `zustand-persist-map-set-serialization`

This rule catches `Map` or `Set` state included in JSON persistence without a proven serializer or
`partialize` exclusion.

JSON storage does not preserve `Map` and `Set` entries. Zustand's persistence guide requires custom
serialization and revival for these collections.

Detector contract:

- Prove a persisted creator initializes a state field with `new Map` or `new Set`.
- Report only when default JSON persistence is used and the field is not statically excluded by
  `partialize`.
- Allow `createJSONStorage` options with a proven `replacer` and `reviver`, and skip arbitrary custom
  storage implementations.
- Skip imported initial state, dynamic option spreads, and values whose persisted shape is unknown.

Evidence:

- [Persisting Map and Set data](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data#how-do-i-use-it-with-map-and-set)
- [Map and Set usage guide](https://zustand.docs.pmnd.rs/learn/guides/maps-and-sets-usage)

### `zustand-persist-partialize-needs-merge`

This rule catches a statically partial nested object returned by `partialize` when persistence still
uses the default shallow merge.

On hydration, the default merge is shallow. Persisting `{ position: { x } }` can replace the entire
default `position` object and lose a newly added or intentionally non-persisted `y` field.

Strong positive:

```ts
persist(creator, {
  name: "position",
  partialize: (state) => ({ position: { x: state.position.x } }),
});
```

Detector contract:

- Require an exact object-returning `partialize` selector with a nested object that contains a strict
  subset of the corresponding statically known initial-state object.
- Report only when no custom `merge` option is present.
- Allow complete nested objects, top-level scalar subsets, and a custom merge function.
- Skip spreads, computed keys, imported creators, and unknown initial shapes.
- Keep v1 deliberately narrow; a broad warning on every nested `partialize` would be noisy.

Evidence:

- [Persisting store data: custom merge for nested objects](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data#persisting-a-state-with-nested-objects)

### `zustand-selector-needs-shallow`

This possible companion to the v5 correctness rule would catch fresh object, array, and allocating
selector results in Zustand 1 through 4 when no equality function is supplied.

Before v5 this pattern generally causes unnecessary rerenders rather than the v5 infinite-loop
failure. It should reuse the selector-result classifier from `zustand-no-fresh-selector-result`, but
it needs a separate performance message and OSS noise study before becoming default-on.

Evidence:

- [Prevent rerenders with `useShallow`](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow)
- [`useShallow` reference and v5 troubleshooting](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow)
- [Issue #2863: v5 maximum update depth and the v4 performance behavior](https://github.com/pmndrs/zustand/issues/2863)
- [PR #2090: add `useShallow`](https://github.com/pmndrs/zustand/pull/2090)

## Implemented rule boundaries

### `zustand-no-fresh-selector-result`

The rule is a Zustand 5 correctness rule. It reports selectors that return fresh objects, arrays,
functions, instances, or known allocating collection transforms. It permits `useShallow`, valid
equality-aware APIs, stable fields, and module-scope fallbacks. It must not be enabled for Zustand 1
through 4 merely by removing the capability gate; those versions need the separate performance
contract above.

The v5 boundary is supported by the [migration guide](https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5),
[issue #2863](https://github.com/pmndrs/zustand/issues/2863), and the maintainers' ongoing
troubleshooting work in [PR #3507](https://github.com/pmndrs/zustand/pull/3507).

### `zustand-no-whole-store-destructure`

The rule reports render-phase calls to a proven bound hook or vanilla `useStore` without a selector.
It supports Zustand 1 through 5 because omitting the selector has selected the complete store since
v1. It skips imported custom hooks and imported stores until cross-file provenance exists.

The behavior and recommendation are documented in the
[Zustand README](https://github.com/pmndrs/zustand#fetching-everything) and reinforced by selector
discussions such as [#2541](https://github.com/pmndrs/zustand/discussions/2541).

## Rejected or deferred ideas

| Idea                                         | Decision | Reason                                                                                   |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Require one store per app or module          | Reject   | Zustand supports multiple stores; this is architecture preference                        |
| Require state fields before actions          | Reject   | Object property order is style, not runtime correctness                                  |
| Require slices after a field-count threshold | Reject   | Arbitrary size threshold and no documented failure                                       |
| Require every action to call `setState`      | Reject   | `set`, middleware, derived actions, and external actions are all valid                   |
| Ban global stores everywhere                 | Reject   | Global client stores are a core Zustand use case; only SSR and RSC boundaries are unsafe |
| Warn on every persisted store in SSR         | Defer    | Hydration strategy is application-specific; require a concrete mismatch witness          |
| Warn on every `set(value, true)`             | Defer    | Replacing the entire state can be intentional, including deleting actions                |
| Require subscription cleanup                 | Reuse    | The existing generic effect cleanup rule already owns this problem                       |
| Ban store creation in components             | Reuse    | `no-create-store-in-render` already covers Zustand factories                             |

## Ecosystem and skill audit

[`eslint-plugin-zustand-rules`](https://github.com/paulschoen/eslint-plugin-zustand-rules) was useful
for discovering mutation and selector themes. Its `no-multiple-stores`, property-order, action-style,
and store-size rules are not suitable for React Doctor because they encode opinions rather than
documented runtime failures. Its detectors are also primarily name-based, while React Doctor rules
should require import and binding provenance.

Community Zustand skills consistently recommend selectors, `useShallow`, immutable updates,
`devtools` as the outermost middleware, and hydration care. They are discovery material rather than
authority:

- [Gentleman-Skills Zustand 5](https://github.com/Gentleman-Programming/Gentleman-Skills/blob/c8036a37893679dc5e942484975405d39689c63b/curated/zustand-5/SKILL.md)
  includes a whole-store destructuring example that conflicts with its own selector guidance.
- [TerminalSkills Zustand](https://github.com/TerminalSkills/skills/blob/13878c9dd5dc0ffaecbad15dba0fb08a84c07459/skills/zustand/SKILL.md)
  gives useful middleware advice but overgeneralizes the global-store prohibition beyond SSR.
- [nklisch Zustand v5](https://github.com/nklisch/skills/blob/18fb71ceccd89b7218b33f0259189ea2d6611c81/.agents/skills/zustand-v5/SKILL.md)
  most closely matches current official guidance.

When a skill conflicts with current Zustand documentation or source, the official behavior wins.

## Suggested implementation order

1. Merge the foundation, then land the two existing selector PRs independently on top of it.
2. Build `zustand-no-get-during-initialization`; it has the strongest correctness signal and the
   smallest control-flow surface.
3. Extract shared mutation and fresh-reference analysis for `zustand-no-mutating-state`.
4. Add a middleware composition resolver, then implement selector subscription and devtools order.
5. Add the Next.js server boundary rule after selecting a reliable cross-file store provenance
   mechanism.
6. Add static persist option analysis, starting with same-file name collisions, then Map or Set
   serialization and exact nested `partialize` shapes.
7. Run RDE and strict fuzzing for every rule before enabling it by default. Drop or narrow any rule
   whose detector cannot distinguish a documented failure from a common valid pattern.

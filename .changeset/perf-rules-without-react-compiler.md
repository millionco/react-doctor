---
"oxlint-plugin-react-doctor": minor
---

Add 7 new performance rules targeting projects that don't use React Compiler. All rules are derived from the 3perf "Unnecessary Renders / Expensive Renders & Effects" catalog and validated against the millionjs/million-lint-benchmark fixtures.

- `redux-useselector-returns-new-collection` — flags `useSelector(state => ({ a: state.a }))` / `[...]` selectors that re-render on every dispatched action because the default `===` equality check always fails on a fresh allocation.
- `redux-useselector-inline-derivation` — flags `useSelector(state => state.users.filter(...))` and other inline `.map` / `.sort` / `.toSorted` / `Object.keys` / `Object.values` / `Object.entries` derivations that allocate on every store update.
- `no-create-context-in-render` — `error`: `createContext(...)` called inside a component or hook silently disconnects every consumer because the Context object identity changes per render.
- `no-create-store-in-render` — `error`: zustand `create` / jotai `atom` / valtio `proxy` / redux `configureStore` / mobx `makeAutoObservable` / nanostores `atom` etc. called inside a component or hook allocates a fresh store on every render.
- `prefer-stable-empty-fallback` — flags `<MemoizedChild prop={value || []} />` and `<MemoizedChild prop={value ?? {}} />`. Closes the carve-out in `jsx-no-new-array-as-prop` for the `x || []` shape when the consumer is a same-file `memo()` component. `disabledBy: ["react-compiler"]`.
- `rerender-lazy-ref-init` — flags `useRef(expensiveCall())`. Mirror of `rerender-lazy-state-init`; `useRef` has no lazy-init arg so the expensive call runs on every render and its result is discarded after the first.
- `no-effect-with-fresh-deps` — `error`: flags `useEffect / useLayoutEffect / useMemo / useCallback` dep arrays containing inline `{...}` / `[...]` / `() => ...` / `new Foo(...)` elements. The `===` comparison always fails on those elements so the hook runs on every render.

Each rule is gated narrowly (import-source for Redux rules, same-file memo registry for `prefer-stable-empty-fallback`, component/hook scope detection for the in-render store/context rules) to keep false positives low.

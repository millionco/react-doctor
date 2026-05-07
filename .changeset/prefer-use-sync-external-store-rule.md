---
"react-doctor": minor
---

feat(react-doctor): add `prefer-use-sync-external-store` rule

New rule (severity: `warn`) flagging the §11 anti-pattern from React's
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#subscribing-to-an-external-store)
guide:

```tsx
const [snapshot, setSnapshot] = useState(getSnapshot());
useEffect(() => {
  const unsubscribe = store.subscribe(() => setSnapshot(getSnapshot()));
  return unsubscribe;
}, []);
```

The hand-rolled subscribe pattern reimplements
[`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
in user space — incorrectly. The hook handles tearing during
concurrent renders and SSR snapshots; the manual pattern doesn't. The
rule suggests:

```tsx
const snapshot = useSyncExternalStore(store.subscribe, getSnapshot);
```

The detector requires a four-vertex AST match before firing, so
real-world false positives are essentially impossible:

1. `useEffect` with empty deps `[]`
2. body declares `const u = X.subscribe(handler)` OR directly invokes
   a subscription method `X.addEventListener(...)`
3. cleanup is a `return` that returns the unsubscribe binding
   directly OR returns a closure that unsubscribes
4. handler is a single `setY(<getter>)` whose `<getter>` is
   structurally equal to the matching `useState`'s initializer

Subscription method names recognized: `subscribe`, `addEventListener`,
`addListener`, `on`, `watch`, `listen`, `sub`. This covers zustand,
Redux vanilla, Valtio, Effector, Jotai store API, RxJS observables,
and the browser `addEventListener` shape (`matchMedia`,
`navigator.onLine`, etc.).

Modern store hooks (`useAtomValue` from Jotai, `useStore` from
zustand v4+, `useSelector` from react-redux v8+) already use
`useSyncExternalStore` under the hood and are not flagged — the rule
only catches code that bypasses the library's hook to roll its own
subscription.

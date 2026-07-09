---
"oxlint-plugin-react-doctor": patch
---

`no-usememo-simple-expression` now flags trivial container-literal memos — `useMemo(() => [x], [x])` / `useMemo(() => ({ a, b }), [a, b])` — but only when the memo result's referential identity is provably unused: the result is discarded, immediately destructured, or only ever read through member access (`items.length`, `items.map(...)`). A memoized container passed as a prop, listed in another hook's deps, returned from a hook, or otherwise escaping keeps its memo, since a stable reference is the legitimate reason to memoize a fresh literal.

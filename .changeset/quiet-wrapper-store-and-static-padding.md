---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Stop `no-impure-state-updater` reporting callbacks handed to a helper that merely runs them (`run(async () => setValue("x"))`). Only a wrapper that forwards its parameter into a React setter's updater slot still counts as an updater.

Stop `nextjs-no-side-effect-in-get-handler` reporting `.set()` on a `Headers` object the helper constructs itself; mutations on stores the helper did not create still report.

Treat a ternary between static values (`hasHeader ? 0 : 16`) as static spacing in `rn-scrollview-dynamic-padding`, and reword its recommendation to name the matching `contentInset` edge and its iOS-only scope.

Accept a Zustand `store.setState(awaitedValue)` re-sync as a cache update in `query-mutation-missing-invalidation`; plain UI-state writes and non-store bindings still report.

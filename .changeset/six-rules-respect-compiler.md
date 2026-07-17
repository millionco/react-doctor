---
"oxlint-plugin-react-doctor": patch
---

Gate six identity-stability rules on `react-compiler`: `no-inline-prop-on-memo-component`, `rendering-hoist-jsx`, `prefer-module-scope-pure-function`, `rn-list-data-mapped`, `rerender-dependencies`, and `no-effect-with-fresh-deps` no longer fire on compiler-enabled projects, where the compiler memoizes the flagged allocations and their add-`useMemo`/`useCallback` advice contradicted `react-compiler-no-manual-memoization`

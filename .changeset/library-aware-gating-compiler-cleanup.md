---
"react-doctor": patch
---

App-only heuristics now stay quiet in published libraries, and React Compiler memoization-cleanup is demoted to a warning.

- `react-hooks-js/static-components` and `no-render-prop-children` no longer fire on files in a published library — a non-`private` `package.json` that declares the publish contract (`name` + `exports`). They still fire in applications (including private monorepo apps that live under `packages/` or declare a niche internal `exports` map) and in any package without that contract, and an explicit per-rule severity in config always re-enables them.
- `react-compiler-no-manual-memoization` now defaults to `warn` instead of `error` when React Compiler is detected — redundant `useMemo` / `useCallback` / `memo` is correctness-neutral cleanup, so it's hidden from the default report. The external `react-hooks-js/*` compiler rules stay `error` because each marks code the compiler could not optimize (a real perf regression).
- New `buckets` config field: set `{ "buckets": { "compiler-cleanup": "error" } }` to re-enable strict errors for the redundant-memoization rule. A per-rule override still wins over a bucket.

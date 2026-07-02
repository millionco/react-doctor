---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix four false positives found by React Doctor reviewing real, idiomatic React code (the Ink TUI in #979):

- `no-derived-state` no longer flags state accumulators — a `setState` inside an effect whose functional updater computes the new value from its own parameter (`setKeys((previous) => new Set(previous).add(key))`, `setTotal((prev) => prev + count)`, `setItems((prev) => [...prev, item])`). Accumulated history is by definition not derivable from the current props/state. The spread-only object merge (`setForm((prev) => ({ ...prev, field: <derived> }))`) still reports.
- `no-array-index-as-key` no longer flags positional rendering of string characters: `[...str]`, `str.split(...)`, and `Array.from(str)` receivers where the source is provably a string (literal, template, `String()` call, or a binding/prop typed `string` in the same file). Character position is the stable identity there — nothing reorders, filters, or carries per-item state. Data lists still report.
- `prefer-useReducer` now requires an actual co-update signal instead of merely counting `useState` calls: it reports only when the threshold number of distinct setters are called together as sibling statements of one handler/effect block. Independent state updated from separate handlers or separate keyboard-handler branches stays quiet, and the message no longer claims each `useState` "can trigger a separate render" (wrong since React 18 automatic batching) — it now explains the real rationale: state that changes together is easier to keep consistent as a single reducer action.
- `jsx-no-jsx-as-prop` only claims what it can prove: when the receiving component is not resolvable in the current file (imported), the message uses conditional wording ("If this child is memoized, …") instead of asserting a memo bailout that may not exist. Same-file components provably wrapped in `memo()` keep the assertive message; provably plain function components already stayed quiet.

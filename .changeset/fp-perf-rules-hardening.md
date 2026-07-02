---
"oxlint-plugin-react-doctor": patch
---

fix(performance): reduce false positives across performance, js-performance, and bundle-size rules

Hardens the performance rule families so common, legitimate patterns stop
triggering warnings. Validated against 500 distinct OSS repos with the RDE
harness (react-doctor caching disabled).

- **bundle-size** — `no-dynamic-import-path` only treats bundler-analyzable
  relative specifiers (`./`, `../`) as static prefixes (protocol/absolute
  URLs stay flagged); heavy-library rules skip type-only imports;
  `no-undeferred-third-party` ignores `type="module"` and non-executable
  script types.
- **js-performance** — smarter guards for order-dependent async
  (`async-await-in-loop`, `async-parallel`), `.find()` in loops
  (`js-index-maps`: single-field equality, loop-variant receivers — including
  receivers behind a TS cast — and nested-scope bindings), property-access and
  `localStorage` caching, `filter(Boolean)` chains, `Intl`/`RegExp` memo and
  hoist patterns, direction-aware `Math.min`/`Math.max` hints, small literal
  `includes`, and `[...x].sort()` when `x` is a fresh, otherwise-unreferenced
  array or iterator.
- **`no-json-parse-stringify-clone`** — exempts clones inside `snapshot*`
  helpers, and no longer flags `JSON.parse(JSON.stringify(x, replacer))` when
  the replacer is an inline function or array (it transforms the output, so
  `structuredClone` is not an equivalent rewrite).
- **performance / React** — memo inline-prop skips custom comparators and
  `ref`/`key`; hoist-JSX respects render-local components; the hydration rule
  ignores time/random inside nested handlers; loading-state, derived-hook, and
  memo-before-return rules only fire when the suggested refactor would help.

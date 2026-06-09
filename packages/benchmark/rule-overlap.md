# Rule overlap & ownership

SlopBench scores slop from multiple scanners. To avoid **double-counting** the
same defect, every slop signal has exactly one owner. This table is the single
source of truth: when adding a check, confirm React Doctor does not already
cover it — if it does, **defer** and (optionally) route its rule id into a finer
dimension instead of re-implementing detection.

## Ownership by dimension

| Dimension           | Owner            | How |
| ------------------- | ---------------- | --- |
| `react-correctness` | React Doctor     | categories **Security**, **Bugs** |
| `react-performance` | React Doctor     | category **Performance** (minus the rules rerouted below) |
| `accessibility`     | React Doctor     | category **Accessibility** |
| `maintainability`   | React Doctor + deslop heuristic | category **Maintainability** (incl. the `ln`/deslop dead-code plugin) + `deslop/nested-ternary` |
| `bundle`            | React Doctor (rerouted) | specific Performance-category rule ids → `bundle` |
| `async-waterfall`  | React Doctor (rerouted) | specific Performance-category rule ids → `async-waterfall` |
| `ts-strictness`     | SlopBench TS checks | React Doctor does **not** cover generic TS slop |
| `composition`       | SlopBench Vercel checks | proliferation / render-prop not counted by React Doctor |

## React Doctor rules rerouted to finer dimensions

React Doctor files these under the broad **Performance** category; SlopBench
routes the exact rule ids into dedicated dimensions
(`REACT_DOCTOR_RULE_TO_DIMENSION` in `src/constants.ts`) so the leaderboard can
report them separately. Detection still belongs to React Doctor — we only
relabel the dimension.

- `react-doctor/no-barrel-import` → `bundle`
- `react-doctor/no-full-lodash-import` → `bundle`
- `react-doctor/no-moment` → `bundle`
- `react-doctor/no-undeferred-third-party` → `bundle`
- `react-doctor/prefer-dynamic-import` → `bundle`
- `react-doctor/no-dynamic-import-path` → `bundle`
- `react-doctor/use-lazy-motion` → `bundle`
- `react-doctor/server-sequential-independent-await` → `async-waterfall`
- `react-doctor/tanstack-start-loader-parallel-fetch` → `async-waterfall`

## Vercel rules deliberately DEFERRED to React Doctor (no custom check)

These Vercel best-practices map onto an existing React Doctor rule, so SlopBench
does **not** add a duplicate detector:

| Vercel rule | Covered by React Doctor |
| ----------- | ----------------------- |
| `bundle-barrel-imports` | `react-doctor/no-barrel-import`, `no-full-lodash-import` |
| `bundle-dynamic-imports` | `react-doctor/prefer-dynamic-import`, `no-dynamic-import-path` |
| `async-parallel` / waterfalls | `react-doctor/server-sequential-independent-await` |
| `rerender-no-inline-components` | `react-doctor/no-nested-component-definition`, `no-unstable-nested-components` |
| `rerender-derived-state-no-effect` | React Doctor `state-and-effects` rules |
| `react19-no-forwardref` | `react-doctor/forward-ref-uses-ref`, `no-react19-deprecated-apis` |
| `rendering-*` (img, etc.) | `react-doctor/nextjs-no-img-element`, … |

## Signals SlopBench OWNS (custom checks — React Doctor gap)

TypeScript strictness (`src/checks/ts-*.ts`, dimension `ts-strictness`):

- `ts/no-explicit-any` — explicit `any` annotations
- `ts/no-non-null-assertion` — the `!` operator
- `ts/no-type-assertion` — `as Foo` / `<Foo>x` casts (`as const` exempt)
- `ts/ban-ts-comment` — `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` (scored as error)

Composition (`src/checks/vercel-*.ts`, dimension `composition`):

- `vercel/architecture-boolean-prop-soup` — `*Props` types with ≥ `BOOLEAN_PROP_SOUP_THRESHOLD` boolean flags
- `vercel/patterns-render-prop` — function-valued `render` / `renderX` props

deslop (`src/checks/deslop-*.ts`, dimension `maintainability`):

- `deslop/nested-ternary` — nested conditional expressions (one finding per chain)

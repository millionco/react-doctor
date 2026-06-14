# Performance engineering (React render profiling loop)

Profile and optimize React render performance with **runtime evidence** — the
React DevTools profiler export — never by guessing from code alone. Use this
when the user reports jank, slow interactions, dropped frames, excessive
re-renders, or asks to "make this faster" / "optimize renders".

Same discipline as debug-agent: hypothesize → profile → analyze the export → fix
the top evidence-backed opportunity → re-profile to verify → repeat. A change
that does not show up as fewer or cheaper renders in the export is not a fix.

## Setup (once per app)

The harness ships with React Doctor under the `react-doctor/runtime` subpath. It
drives the real DevTools profiler in-app — no Chrome extension, no manual
record/stop.

1. Install the DevTools backend (an optional peer of `react-doctor`):

```bash
npm i -D react-devtools-inline
```

2. For trustworthy timings, run against React's profiling build (alias
   `react-dom` → `react-dom/profiling` in your bundler) in a dev/non-prod build.
   Dev timings work but are inflated.

3. Inject the harness bootstrap into the app entry, wrapped in cleanup markers
   so it can be removed deterministically later:

```ts
// #region react-doctor perf
import { installReactDevtoolsBackend } from "react-doctor/runtime";
installReactDevtoolsBackend(); // MUST run before React is imported
// #endregion
```

```ts
// after the app has mounted (e.g. end of main.tsx)
// #region react-doctor perf
import { createReactPerfHarness } from "react-doctor/runtime";
createReactPerfHarness(); // exposes window.__REACT_PERF__
// #endregion
```

`installReactDevtoolsBackend()` must execute before any React import — put it at
the very top of the entry, or in a separate module imported first.

### React Native

The same `react-doctor/runtime` import works on React Native — Metro resolves the
`react-native` export condition to the RN-safe build (it connects only the
DevTools backend, never `react-dom`). The harness installs on `global` instead of
`window`, so the defaults need no changes:

```ts
// at the very top of index.js, before "react-native" / your App import
import { installReactDevtoolsBackend } from "react-doctor/runtime";
installReactDevtoolsBackend();
```

```ts
// after the app registers (e.g. after AppRegistry.registerComponent)
import { createReactPerfHarness } from "react-doctor/runtime";
createReactPerfHarness(); // exposes global.__REACT_PERF__
```

Drive it the same way (`global.__REACT_PERF__.start()` / `await stop()`), e.g.
from a dev menu action or an e2e driver. On RN the export's per-commit timings
(`commitData`, `changeDescriptions`) are exact; the component-tree `snapshots`
are reconstructed best-effort from the operation stream (this is experimental
and pending on-device verification), so prefer analyzing render counts /
durations / change reasons over the flamegraph hierarchy.

## The loop

1. **Hypothesize** (3–5): why is it slow? Unstable callback/object props,
   missing `memo`/`useMemo`, a context provider that is too broad, large
   unvirtualized lists, expensive children re-rendering on every parent commit.

2. **Profile.** Drive the scenario, then collect the export:

```js
window.__REACT_PERF__.start();
// drive the interaction: navigate, type, click — the exact repro
const profile = await window.__REACT_PERF__.stop();
```

Drive it via Playwright `page.evaluate(...)` for a repeatable scenario, or have
the user click through. Save `profile` to a file — it is the canonical DevTools
`ProfilingDataExport` (version 5), re-importable into the DevTools Profiler UI
and analyzable directly.

3. **Analyze the export.** Aggregate `dataForRoots[].commitData[]`:
   - per fiber: render count, summed `fiberActualDurations` / `fiberSelfDurations`
   - `changeDescriptions[fiberID]` → _why_ it rendered (which props / state /
     hooks / context changed), plus `isFirstMount` and `didHooksChange`
   - `compiledWithForget` in the snapshots → already optimized by React Compiler

   Rank opportunities: components that render most often, cost the most self
   time, or re-render with no meaningful prop change (memoization candidates).

4. **Fix** the single top evidence-backed opportunity — the smallest change that
   addresses the proven cause.

5. **Verify.** Re-run the _same_ scenario and diff before/after: the target
   component's render count and self/actual duration must drop, and no other
   component may regress. Run the scenario a few times and compare medians (dev
   timings are noisy; StrictMode double-renders on mount).

6. **Iterate** until the budget is met, then **clean up**: delete every
   `// #region react-doctor perf` … `// #endregion` block and grep to confirm
   none remain.

## Notes

- Keep the harness installed across fix attempts; remove it only when done
  (mirrors debug-agent keeping instrumentation until the fix is verified).
- The export omits scheduler `timelineData` for now; the per-commit render data
  above is the signal.
- Never claim a performance win without a before/after export diff.

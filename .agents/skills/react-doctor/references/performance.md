# Performance engineering (runtime-evidence loop)

Find and fix jank with runtime evidence, never code reading alone. The primary signal is the long animation frame (LoAF): a frame longer than 50 ms, captured with `PerformanceObserver` and attributed to the exact script that blocked it (its `sourceURL`, `sourceFunctionName`, and how much of that time was synchronous layout). That attribution is what `performance.now()` and reading code cannot give you. Use this when the user reports jank, dropped frames, janky scroll, slow click or typing response, poor INP, slow LCP, or layout shift, or asks to make something faster.

Same discipline as [debug](./debug.md): hypothesize, capture, analyze the worst frame, fix the top evidence-backed cause, re-capture to verify, repeat. A change that does not make the offending script's frame time drop is not a fix.

## 1. Hypothesize (3 to 5)

Why is it slow, and where? Common React causes: unstable callback or object props, a missing `memo` or `useMemo`, a context provider that is too broad, large unvirtualized lists, expensive children re-rendering on every parent commit, or a sync layout read interleaved with writes (layout thrashing).

## 2. Capture (no app changes)

`browser perf` arms the LoAF, LCP, and CLS observers, loads the page, watches briefly past load, then reports the worst frames first with per-script attribution:

```bash
npx react-doctor browser perf http://localhost:3000   # measures the current page if URL omitted
```

It drives the same Chrome the other `browser` commands do: your real logged-in session when you started Chrome with `--remote-debugging-port=9222`, otherwise a dedicated persistent one. The output leads with the worst frame (duration plus input-blocking time), then each script that ran in it (time, function name, source, and sync-layout time when present), with LCP and CLS for context. LoAF is Chromium-only; on a quiet page it reports no long frames, which is a result, not a failure.

To attribute interaction jank (a slow click, scroll, or keypress), drive the repro between load and the read: `browser open`, then `browser eval` the interaction, then `browser perf` with no URL. Without a URL it does not reload; it reads the long frames already buffered in the timeline, so the jank from your interaction is included.

## 3. Analyze the worst frame first

The output is already sorted worst-first. The script with the largest duration inside the worst frame is your culprit. If a script's sync-layout time is a large share of its duration, that is layout thrashing: sync reads (`offsetHeight`, `getBoundingClientRect`, `scrollTop`, `getComputedStyle`) interleaved with DOM writes. A minified `sourceURL` is meaningless on its own, so resolve it through your sourcemap. Cite the specific script when you conclude:

> CONFIRMED: 128 ms frame, script `app.js` `drawSeries` ran 84 ms with 42 ms sync layout. The chart redraw forces layout inside the scroll handler.

## 4. Zoom into React renders (optional)

When the worst frame's script is your own React bundle and you need per-component render counts and why each rendered, profile React directly. `browser open` injects the real DevTools profiler before the page loads, so there are no app changes, no Chrome extension, and no manual record or stop:

```bash
npx react-doctor browser open http://localhost:3000
```

For trustworthy timings, run against React's profiling build (alias `react-dom` to `react-dom/profiling` in your bundler) in a dev or non-prod build. Dev timings work but are inflated.

The fastest path is `browser profile`: one recording, both lenses. It returns `react` (slowest commits, components that render most/cost the most self time, and the count of unnecessary re-renders — components that re-rendered with nothing they own changed, the memoization candidates) and `cpu` (a Chrome DevTools CPU profile via V8's sampling profiler over CDP, the hottest JS functions ranked by self time):

```bash
npx react-doctor browser profile http://localhost:3000 --interaction 'page.getByText("Next").click()'
# omit the url to profile a page already opened with `browser open`
```

The `react` lens is null on a production React build (it records no profiling data); the `cpu` lens works on any build. For manual control of the React profiler, drive it through `browser eval` (the Playwright `page` is in scope):

```bash
npx react-doctor browser eval 'page.evaluate(() => window.__REACT_PERF__.start())'
# drive the exact repro with more `browser eval`: page.locator("...").click(), page.keyboard.type("...")
npx react-doctor browser eval 'page.evaluate(() => window.__REACT_PERF__.stop())'
```

Reading the raw React export: aggregate `dataForRoots[].commitData[]`: per fiber, render count and summed `fiberActualDurations` and `fiberSelfDurations` (both `[fiberID, ms]` pairs); `changeDescriptions[fiberID]` for why it rendered (which props, state, hooks, or context changed, plus `isFirstMount` and `didHooksChange`). Everything keys by fiber id; map ids to component names with `dataForRoots[].elementNames` (`[fiberID, name]` pairs). Rank by components that render most often, cost the most self time, or re-render with no meaningful prop change (memoization candidates) — which is exactly what `browser profile` computes for you.

## 5. Fix, only with proof

Apply the smallest change that addresses the proven cause. Cross-check it against the baseline rules in [`SKILL.md`](../SKILL.md) (derive don't duplicate, effects, single source of truth). Never fix by wrapping work in `setTimeout`: that defers the work to a later frame, it does not remove it.

## 6. Verify

Re-run the same capture and diff before and after: the offending frame and its script time must drop, and no other frame may regress. For the React profiler, re-run the scenario a few times and compare medians (dev timings are noisy; StrictMode double-renders on mount). Never claim a performance win without before-and-after evidence. The profiler leaves nothing behind in your app to clean up; it lives only in the injected browser session.

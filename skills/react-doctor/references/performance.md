# Performance engineering (runtime-evidence loop)

Find and fix jank with runtime evidence, never code reading alone. The primary signal is the long animation frame (LoAF): a frame longer than 50 ms, captured with `PerformanceObserver` and attributed to the exact script that blocked it (its `sourceURL`, `sourceFunctionName`, and how much of that time was synchronous layout). That attribution is what `performance.now()` and reading code cannot give you. Use this when the user reports jank, dropped frames, janky scroll, slow click or typing response, poor INP, slow LCP, or layout shift, or asks to make something faster.

Same discipline as [debug](./debug.md): hypothesize, capture, analyze the worst frame, fix the top evidence-backed cause, re-capture to verify, repeat. A change that does not make the offending script's frame time drop is not a fix.

## 1. Hypothesize (3 to 5)

Why is it slow, and where? Common React causes: unstable callback or object props, a missing `memo` or `useMemo`, a context provider that is too broad, large unvirtualized lists, expensive children re-rendering on every parent commit, or a sync layout read interleaved with writes (layout thrashing).

## 2. Capture (no app changes)

`browser eval --profile` arms every observer (LoAF/LCP/CLS, the React render profiler, and a V8 CPU profiler), runs the expression you pass while it records, then reports the worst frames first with per-script attribution. Drive a fresh load by passing the navigation, or omit the expression to read the page as it is now without reloading:

```bash
npx react-doctor browser eval 'page.goto("http://localhost:3000")' --profile
npx react-doctor browser eval --profile   # measures the current page, no reload
```

It drives the same Chrome the other `browser` commands do: your real logged-in session when you started Chrome with `--remote-debugging-port=9222`, otherwise a dedicated persistent one — launched headless (pass `--headed` to watch the window), landing on a free port automatically if 9222 is taken, with later commands reattaching to it and `browser close` stopping it when you're done. The performance section ranks frames by input-blocking time — the jank signal — and drops non-blocking ones (a long but non-blocking frame, like the first frame after navigation, is not jank), leading with the most-blocking frame, then each script that ran in it (time, function name, source, and sync-layout time when present), with LCP and CLS for context. LoAF is Chromium-only; on a quiet page it reports no blocking frames, which is a result, not a failure.

It also captures a Chrome DevTools timeline trace over the same window. The perf section rolls it up into the native cost a forced reflow incurs — total/longest **style-recalc**, **layout**, **hit-test**, and **paint** time — which the script-level LoAF rows can't isolate (this is where `getComputedStyle` / `getBoundingClientRect` / `elementsFromPoint` land). The raw trace is written to `react-doctor-trace.json` (override with `--out`); drop it into the DevTools **Performance** panel for the full flame chart.

The `# Memory` section snapshots the page's runtime footprint after the action — JS heap used/total, DOM node count, event listeners, and document/frame counts (the CDP Performance counters). For a leak, re-run on the same page with no reload (`browser eval --profile`) and watch these climb: growing DOM nodes mean detached subtrees retained, growing listeners/heap mean leaked closures, growing documents/frames mean orphaned iframes.

The `# Network` section lists each request with its outcome (status or failure), and — once it has settled — its time and encoded transfer size, with a summary counting failed, slow (>500ms), and heavy (>1MB) requests. Use it to spot a blocking waterfall or an oversized bundle/asset; a cache hit or an unfinished request shows no size/time.

To attribute interaction jank (a slow click, scroll, or keypress), pass the repro as the expression so it runs while recording: `browser open` the page, then `browser eval 'page.getByText("Next").click()' --profile`. The recording covers the action, so its frames, renders, and CPU samples are all included.

## 3. Analyze the worst frame first

The output is already sorted worst-first. The script with the largest duration inside the worst frame is your culprit. If a script's sync-layout time is a large share of its duration, that is layout thrashing: sync reads (`offsetHeight`, `getBoundingClientRect`, `scrollTop`, `getComputedStyle`) interleaved with DOM writes. A minified `sourceURL` is meaningless on its own, so resolve it through your sourcemap. Cite the specific script when you conclude:

> CONFIRMED: 128 ms frame, script `app.js` `drawSeries` ran 84 ms with 42 ms sync layout. The chart redraw forces layout inside the scroll handler.

## 4. Zoom into React renders (optional)

When the worst frame's script is your own React bundle and you need per-component render counts and why each rendered, profile React directly. `browser open` injects the real DevTools profiler before the page loads, so there are no app changes, no Chrome extension, and no manual record or stop — then drive the repro with `browser eval --profile`:

```bash
npx react-doctor browser open http://localhost:3000
npx react-doctor browser eval 'page.getByText("Next").click()' --profile
```

For trustworthy timings, run against React's profiling build (alias `react-dom` to `react-dom/profiling` in your bundler) in a dev or non-prod build. Dev timings work but are inflated.

`browser eval --profile` records one pass with both lenses. The `react` lens reports the slowest commits, the components that render most/cost the most self time, and the count of unnecessary re-renders (components that re-rendered with nothing they own changed — the memoization candidates). The `cpu` lens is a Chrome DevTools CPU profile via V8's sampling profiler over CDP, the hottest JS functions ranked by self time. The `react` lens is null on a production React build (it records no profiling data); the `cpu` lens works on any build. For manual control of the React profiler, drive it through `browser eval` without `--profile` (the Playwright `page` is in scope):

```bash
npx react-doctor browser eval 'page.evaluate(() => window.__REACT_PERF__.start())'
# drive the exact repro with more `browser eval`: page.locator("...").click(), page.keyboard.type("...")
npx react-doctor browser eval 'page.evaluate(() => window.__REACT_PERF__.stop())'
```

Reading the raw React export: aggregate `dataForRoots[].commitData[]`: per fiber, render count and summed `fiberActualDurations` and `fiberSelfDurations` (both `[fiberID, ms]` pairs); `changeDescriptions[fiberID]` for why it rendered (which props, state, hooks, or context changed, plus `isFirstMount` and `didHooksChange`). Everything keys by fiber id; map ids to component names with `dataForRoots[].elementNames` (`[fiberID, name]` pairs). Rank by components that render most often, cost the most self time, or re-render with no meaningful prop change (memoization candidates) — which is exactly what `browser eval --profile` computes for you.

## 5. Fix, only with proof

Apply the smallest change that addresses the proven cause. Cross-check it against the baseline rules in [`SKILL.md`](../SKILL.md) (derive don't duplicate, effects, single source of truth). Never fix by wrapping work in `setTimeout`: that defers the work to a later frame, it does not remove it.

## 6. Verify

Re-run the same capture and diff before and after: the offending frame and its script time must drop, and no other frame may regress. For the React profiler, re-run the scenario a few times and compare medians (dev timings are noisy; StrictMode double-renders on mount). Never claim a performance win without before-and-after evidence. The profiler leaves nothing behind in your app to clean up; it lives only in the injected browser session.

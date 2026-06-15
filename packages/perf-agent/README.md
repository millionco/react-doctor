# @react-doctor/perf-agent

An in-app React performance harness that drives the **React DevTools Profiler
programmatically**, with no Chrome extension and no manual record/stop. It
produces the exact `ProfilingDataExport` (`version: 5`) the DevTools export
button emits, so the output re-imports into the DevTools Profiler UI and feeds
existing profiler-JSON analysis scripts unchanged.

This is the foundation for a **perf loop** modeled on debug-agent: an agent
starts a profile, drives a scenario, stops, reads the export, optimizes, and
re-profiles to verify, all with runtime evidence.

## How the DevTools setup works

The harness reuses the real DevTools backend + a headless frontend `Store`
(via `react-devtools-inline`), connected by a synchronous in-page wall. The
DevTools UI is never rendered; the `Store` collects commit timings and change
descriptions on its own.

1. `installReactDevtoolsBackend(window)`: installs the global hook. **Must run
   before React loads.**
2. `createReactPerfHarness(window)`: connects the headless `Store` and exposes
   `window.__REACT_PERF__`.
3. `window.__REACT_PERF__.start()` → run the scenario → `await
window.__REACT_PERF__.stop()` returns the canonical export.

```ts
// entry-before-react.ts (imported first, before any React import)
import { installReactDevtoolsBackend } from "@react-doctor/perf-agent";
installReactDevtoolsBackend();

// after React has mounted
import { createReactPerfHarness } from "@react-doctor/perf-agent";
createReactPerfHarness();
```

For trustworthy timings, run against React's profiling build
(`react-dom/profiling` via a bundler alias) in a non-prod environment.

## Payload

The export is 1:1 with DevTools. `timelineData` (scheduler/lanes) is omitted for
now, which is valid per the v5 schema (old exported profiles won't contain this
key). It is a follow-up alongside the Long Animation Frames (LoAF) sidecar, the
collector daemon, the Playwright scenario runner, and the agent skill.

import { homedir } from "node:os";
import { join } from "node:path";

// Default Chrome DevTools Protocol endpoint. A user opts their browser in by
// launching Chrome with `--remote-debugging-port=9222`; we attach to that.
export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_CDP_ENDPOINT = `http://127.0.0.1:${DEFAULT_CDP_PORT}`;

// How long to wait for a CDP attach before falling back to launching Chrome.
export const CONNECT_TIMEOUT_MS = 5_000;

export const NAVIGATION_TIMEOUT_MS = 30_000;

// Upper bound on waiting for the page to settle (network quiet + fonts) before
// reading or screenshotting it. Best-effort: a page that never goes idle (long
// polling, analytics) hits this cap and we proceed anyway.
export const SETTLE_TIMEOUT_MS = 10_000;

export const REACT_DOCTOR_CACHE_DIRECTORY = join(homedir(), ".cache", "react-doctor");

// Dedicated Chrome profile for the browser we launch ourselves. Mirrors how
// Chrome DevTools MCP keeps a persistent profile out of the user's real one, so
// our launched instance is reattachable across commands and never touches their
// main browsing data. (Chrome also refuses --remote-debugging-port on the
// default profile, so a dedicated dir is required regardless.)
export const LAUNCHED_CHROME_PROFILE_DIRECTORY = join(
  REACT_DOCTOR_CACHE_DIRECTORY,
  "chrome-profile",
);

// Where we remember the endpoint of the Chrome we launched. The default port may
// be taken by another app, so the launch can land on a free port instead; the
// next command reads this to reattach to that same persistent instance before
// falling back to the well-known default.
export const LAUNCHED_CHROME_ENDPOINT_FILE = join(
  REACT_DOCTOR_CACHE_DIRECTORY,
  "launched-endpoint",
);

export const LAUNCH_READY_TIMEOUT_MS = 20_000;
export const LAUNCH_POLL_INTERVAL_MS = 100;

// After the page settles, keep watching for long animation frames this long so
// post-load jank (hydration, late effects) is captured, not just the load burst.
export const PERFORMANCE_OBSERVE_WINDOW_MS = 1_000;

// Window property the perf recording-start timestamp is stashed under so the
// in-page observer can floor its entries to the current recording window. Lives
// on the document so a navigation during the driven action wipes it — the new
// document then keeps its full load vitals instead of filtering them all out.
export const PERFORMANCE_RECORDING_MARKER = "__REACT_DOCTOR_PERF_SINCE__";

// Failing element selectors kept per accessibility violation — enough to locate
// the problem without dumping every match on a busy page.
export const MAX_VIOLATION_TARGETS = 5;

// Upper bound on an emulated viewport dimension, so a typo can't push an absurd
// device-metrics override into CDP.
export const MAX_VIEWPORT_PX = 10_000;

// Caps on what a profile analysis returns inline, so a long recording stays a
// readable result rather than a dump keyed by thousands of fibers. The summary
// counts still reflect everything recorded.
export const MAX_PROFILE_COMPONENTS = 20;
export const MAX_PROFILE_COMMITS = 10;
export const MAX_COMMIT_COMPONENTS = 8;

// V8 CPU profiler sampling interval, matching Chrome DevTools' default (100us).
export const DEFAULT_CPU_SAMPLING_INTERVAL_US = 100;

// Trace categories for the timeline recording captured alongside the CPU profile.
// `-*` drops everything, then we opt into the DevTools timeline events
// (style/layout/hit-test/paint, with their triggering JS stacks) — but NOT
// `disabled-by-default-v8.cpu_profiler`, which would collide with the Profiler
// domain we already run for the CPU analysis. The result loads in the DevTools
// Performance panel and carries the forced-reflow events we roll up.
export const TIMELINE_TRACE_CATEGORIES = [
  "-*",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "blink.user_timing",
  "latencyInfo",
  "loading",
  "toplevel",
].join(",");

// Default file the raw timeline trace is written to (in the working directory).
export const DEFAULT_TRACE_FILENAME = "react-doctor-trace.json";

// Default file `eval --codegen` writes the generated Playwright spec to.
export const DEFAULT_CODEGEN_FILENAME = "react-doctor.spec.ts";

// Default file `eval --video` writes the screen recording (.webm) to.
export const DEFAULT_VIDEO_FILENAME = "react-doctor.webm";

// Functions returned inline by a CPU profile analysis, ranked by self time.
export const MAX_PROFILE_FUNCTIONS = 20;

// Built React-profiler init script, relative to the bundle that imports it.
// `react-profiler/inject.ts` is esbuilt into this self-contained IIFE at build
// time (see vite.config.ts); the session injects it via `addInitScript`. The
// path stays valid whether `dist/index.js` runs standalone or is re-bundled
// into the CLI, because the build copies the asset next to each output.
export const REACT_PROFILER_INJECT_FILE = "inject/react-profiler.global.js";

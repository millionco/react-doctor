import { homedir } from "node:os";
import { join } from "node:path";

// Default Chrome DevTools Protocol endpoint. A user opts their browser in by
// launching Chrome with `--remote-debugging-port=9222`; we attach to that.
export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_CDP_ENDPOINT = `http://127.0.0.1:${DEFAULT_CDP_PORT}`;

// How long to wait for a CDP attach before falling back to launching Chrome.
export const CONNECT_TIMEOUT_MS = 5_000;

// How long a single page navigation may take before we give up.
export const NAVIGATION_TIMEOUT_MS = 30_000;

// Upper bound on waiting for the page to settle (network quiet + fonts) before
// reading or screenshotting it. Best-effort: a page that never goes idle (long
// polling, analytics) hits this cap and we proceed anyway.
export const SETTLE_TIMEOUT_MS = 10_000;

// Dedicated Chrome profile for the browser we launch ourselves. Mirrors how
// Chrome DevTools MCP keeps a persistent profile out of the user's real one, so
// our launched instance is reattachable across commands and never touches their
// main browsing data. (Chrome also refuses --remote-debugging-port on the
// default profile, so a dedicated dir is required regardless.)
export const LAUNCHED_CHROME_PROFILE_DIRECTORY = join(
  homedir(),
  ".cache",
  "react-doctor",
  "chrome-profile",
);

// How long to wait for a freshly launched Chrome to expose its CDP endpoint,
// and how often to poll for it.
export const LAUNCH_READY_TIMEOUT_MS = 20_000;
export const LAUNCH_POLL_INTERVAL_MS = 100;

// After the page settles, keep watching for long animation frames this long so
// post-load jank (hydration, late effects) is captured, not just the load burst.
export const PERFORMANCE_OBSERVE_WINDOW_MS = 1_000;

// Failing element selectors kept per accessibility violation — enough to locate
// the problem without dumping every match on a busy page.
export const MAX_VIOLATION_TARGETS = 5;

// Upper bound on an emulated viewport dimension, so a typo can't push an absurd
// device-metrics override into CDP.
export const MAX_VIEWPORT_PX = 10_000;

// Built React-profiler init script, relative to the bundle that imports it.
// `react-profiler/inject.ts` is esbuilt into this self-contained IIFE at build
// time (see vite.config.ts); the session injects it via `addInitScript`. The
// path stays valid whether `dist/index.js` runs standalone or is re-bundled
// into the CLI, because the build copies the asset next to each output.
export const REACT_PROFILER_INJECT_FILE = "inject/react-profiler.global.js";

import { createProfilerStore } from "./devtools/create-profiler-store.js";
import { makeReactPerfHarness } from "./devtools/make-harness.js";
import type { ReactPerfHarness } from "./devtools/make-harness.js";
import type { DevtoolsGlobal } from "./types/react-devtools.js";

export type { ReactPerfHarness } from "./devtools/make-harness.js";

/**
 * Web entry. Wires the harness with the DevTools frontend Store and exposes
 * `window.__REACT_PERF__`. `installReactDevtoolsBackend` must already have run
 * before React loaded.
 */
export const createReactPerfHarness = (target: DevtoolsGlobal = globalThis): ReactPerfHarness =>
  makeReactPerfHarness(createProfilerStore, target);

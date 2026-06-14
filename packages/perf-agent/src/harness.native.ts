import { createProfilerStore } from "./devtools/create-profiler-store.native.js";
import { makeReactPerfHarness } from "./devtools/make-harness.js";
import type { ReactPerfHarness } from "./devtools/make-harness.js";
import type { DevtoolsGlobal } from "./types/react-devtools.js";

export type { ReactPerfHarness } from "./devtools/make-harness.js";

/**
 * React Native entry. Wires the harness with the RN-safe backend collector and
 * exposes `global.__REACT_PERF__`. `installReactDevtoolsBackend` must already
 * have run before React loaded.
 */
export const createReactPerfHarness = (target: DevtoolsGlobal = globalThis): ReactPerfHarness =>
  makeReactPerfHarness(createProfilerStore, target);

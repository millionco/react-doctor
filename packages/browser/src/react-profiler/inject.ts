import { createReactPerfHarness } from "./harness.js";

// esbuilt into the IIFE the session injects via `addInitScript`, so it runs at
// document-start — the only moment installing the DevTools hook lets React
// attach to it.
createReactPerfHarness();

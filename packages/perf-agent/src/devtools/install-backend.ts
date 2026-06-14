import { initialize as initializeBackend } from "react-devtools-inline/backend";
import type { DevtoolsGlobal } from "../types/react-devtools.js";

// Track per target, not a single boolean, so installing on a second global
// (e.g. an iframe/worker) still wires that global's hook instead of silently
// skipping it.
const installedTargets = new WeakSet<DevtoolsGlobal>();

/**
 * Installs the DevTools global hook on the target global. MUST run before React
 * is loaded (before any import/script that pulls in React), otherwise React
 * never connects to the hook and no commits are recorded. Defaults to
 * `globalThis` so it works on both web (`window`) and React Native (`global`).
 */
export const installReactDevtoolsBackend = (target: DevtoolsGlobal = globalThis): void => {
  if (installedTargets.has(target)) return;
  initializeBackend(target);
  installedTargets.add(target);
};

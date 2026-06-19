import { initialize as initializeBackend } from "react-devtools-inline/backend";
import type { DevtoolsGlobal } from "../types/react-devtools.js";

// Track per target, not a single boolean, so a second global (iframe/worker)
// still gets its own hook.
const installedTargets = new WeakSet<DevtoolsGlobal>();

// MUST run before React loads, otherwise React never connects to the hook and
// no commits are recorded.
export const installReactDevtoolsBackend = (target: DevtoolsGlobal = globalThis): void => {
  if (installedTargets.has(target)) return;
  initializeBackend(target);
  installedTargets.add(target);
};

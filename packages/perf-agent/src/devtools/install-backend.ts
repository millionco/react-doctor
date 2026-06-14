import { initialize as initializeBackend } from "react-devtools-inline/backend";
import type { DevtoolsGlobal } from "../types/react-devtools.js";

let isBackendInstalled = false;

/**
 * Installs the DevTools global hook on the target global. MUST run before React
 * is loaded (before any import/script that pulls in React), otherwise React
 * never connects to the hook and no commits are recorded. Defaults to
 * `globalThis` so it works on both web (`window`) and React Native (`global`).
 */
export const installReactDevtoolsBackend = (target: DevtoolsGlobal = globalThis): void => {
  if (isBackendInstalled) return;
  initializeBackend(target);
  isBackendInstalled = true;
};

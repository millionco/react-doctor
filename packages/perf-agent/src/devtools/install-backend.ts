import { initialize as initializeBackend } from "react-devtools-inline/backend";

let isBackendInstalled = false;

/**
 * Installs the DevTools global hook on the target window. MUST run before React
 * is loaded (before any import/script that pulls in React), otherwise React
 * never connects to the hook and no commits are recorded.
 */
export const installReactDevtoolsBackend = (targetWindow: Window = window): void => {
  if (isBackendInstalled) return;
  initializeBackend(targetWindow);
  isBackendInstalled = true;
};

// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (Gatsby loading indicator: the module-scope typeof-window throw proves every render read is browser-only)
import { debugLog } from "./debug-log";

if (typeof window === "undefined") {
  throw new Error(
    "Loading indicator should never be imported in code that doesn't target only browsers",
  );
}

export function Indicator() {
  if (!window.___gatsbyDidShowLoadingIndicatorBefore) {
    debugLog(window.location.origin + "/___loading-indicator/disable");
  }
  return <div />;
}

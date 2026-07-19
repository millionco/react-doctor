// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (Gatsby loading indicator: the module throws under a typeof-window check before any global read)
if (typeof window === "undefined") {
  throw new Error(
    "Loading indicator should never be imported in code that doesn't target only browsers",
  );
}

if (typeof window.___didShowBefore === "undefined") {
  window.___didShowBefore = false;
}

export const pageOrigin = window.location.origin;

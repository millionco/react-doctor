// rule: no-impure-call-at-module-scope
// weakness: control-flow
export const requestTime = typeof window === "undefined" ? Date.now() : 0;

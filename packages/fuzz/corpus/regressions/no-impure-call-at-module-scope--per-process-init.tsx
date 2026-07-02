// rule: no-impure-call-at-module-scope
// weakness: name-heuristic
// source: PR #1000 adversarial review (deliberate per-process constants)
const INIT_TIMESTAMP = Date.now();
const moduleLoadTime = performance.now();

export const uptimeMs = () => Date.now() - INIT_TIMESTAMP;
export const sinceLoad = () => performance.now() - moduleLoadTime;

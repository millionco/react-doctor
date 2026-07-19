// rule: no-unguarded-browser-global-at-module-scope
// weakness: framework-gating
// source: PR #1000 deep adversarial audit

window.__REACT_DOCTOR_BOOTSTRAP__ = true;

export {};

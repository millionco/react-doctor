// rule: no-impure-call-at-module-scope
// weakness: alias-guard
const window = {};
export const renderedAt = typeof window !== "undefined" && Date.now();

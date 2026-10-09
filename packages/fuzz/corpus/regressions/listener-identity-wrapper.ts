// rule: effect-listener-cleanup-reference-mismatch
// verdict: safe
export const attach = (event, handler) => document.addEventListener(event, handler);
export const detach = (event, handler) => document.removeEventListener(event, handler);

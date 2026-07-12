// rule: no-eval
// weakness: static-computed-member
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
export const evaluatePayload = (payload) => globalThis["eval"](payload);

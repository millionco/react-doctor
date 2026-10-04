// rule: artifact-env-leak
// verdict: pass
// weakness: name-heuristic
// source: issue #1738
export const publicToken = import.meta.env.VITE_STYTCH_PUBLIC_TOKEN;

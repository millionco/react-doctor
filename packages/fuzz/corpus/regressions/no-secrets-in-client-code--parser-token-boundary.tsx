// rule: no-secrets-in-client-code
// weakness: name-heuristic
// source: react-bench DataStoria MATH_TOKEN_END false positive
// verdict: pass
"use client";

export const MATH_TOKEN_END = "ENDDATSTORIABACKSLASHMATH";

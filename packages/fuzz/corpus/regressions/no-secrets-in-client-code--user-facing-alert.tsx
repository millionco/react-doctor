// rule: no-secrets-in-client-code
// weakness: name-heuristic
// source: react-bench Mailing settings API_KEY_ALERT false positive
// verdict: pass
"use client";

export const API_KEY_ALERT = "Unable to create API key. Try again.";

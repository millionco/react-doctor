// rule: no-secrets-in-client-code
// weakness: public-validator-marker
// source: independent synthetic regression
// verdict: pass
"use client";

export const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";

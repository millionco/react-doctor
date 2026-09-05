// rule: no-hydration-branch-on-browser-global
// weakness: recursion
// source: synthetic native parity regression
// verdict: fail

"use client";

const recurse = () => recurse() || typeof window !== "undefined";

export const Preview = () => (recurse() ? <div /> : <section />);

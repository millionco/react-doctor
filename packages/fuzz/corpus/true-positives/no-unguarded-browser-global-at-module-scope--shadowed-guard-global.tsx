// rule: no-unguarded-browser-global-at-module-scope
// weakness: alias-guard
// source: deep audit of millionco/react-doctor#1000

const window = {};
const canUseDOM = typeof window !== "undefined";
export const userAgent = canUseDOM ? navigator.userAgent : "";

// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

if (shouldAbort) throw new Error("disabled");
export const width = window.innerWidth;

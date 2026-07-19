// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: deep audit of Cursor Bugbot review on millionco/react-doctor#1390

if (typeof localStorage === "undefined" || shouldAbort) throw new Error("disabled");

export const theme = localStorage.getItem("theme");

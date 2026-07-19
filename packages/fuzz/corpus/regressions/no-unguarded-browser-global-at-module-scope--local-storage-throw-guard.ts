// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: Cursor Bugbot review of millionco/react-doctor#1390

if (typeof localStorage === "undefined") throw new Error("browser only");

export const theme = localStorage.getItem("theme");

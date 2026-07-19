// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: deep audit of Cursor Bugbot review on millionco/react-doctor#1390

if (typeof window === "undefined") throw new Error("window required");

export const language = navigator.language;

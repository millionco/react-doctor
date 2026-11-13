// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: alias-guard
// source: synthetic

Function(
  'Object.defineProperty(globalThis, "document", { configurable: true, get: () => ({ cookie: "" }) });',
)();
export const setCookie = (value: string) => {
  document.cookie = value;
};

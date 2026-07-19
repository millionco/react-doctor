// rule: no-unguarded-browser-global-at-module-scope
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export class Viewport {
  static width = window.innerWidth;
  static {
    localStorage.getItem("theme");
  }
}

export const initialLanguage = navigator.language;
if (typeof window === "undefined") throw new Error("browser only");

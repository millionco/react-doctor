// Identifiers whose name advertises a browser-environment check —
// `canUseDOM`, `IS_BROWSER`, `isClient`, `hasWindow` — matched after
// lowercasing and stripping `_`/`$`, so casing conventions and imported
// constants (fbjs/exenv `canUseDOM`) all count. Shared by the browser-global
// SSR rules so a guard defined in another file still suppresses the report.
const NORMALIZED_DOM_GUARD_NAMES = new Set([
  "canusedom",
  "ismounted",
  "mounted",
  "isbrowser",
  "isbrowserenv",
  "isclient",
  "haswindow",
  // `import.meta.env.SSR` (Vite/TanStack Start) and `isServer` flags —
  // the server-side spelling of the same environment check.
  "ssr",
  "isssr",
  "isserver",
]);

export const isDomGuardIdentifierName = (name: string): boolean =>
  NORMALIZED_DOM_GUARD_NAMES.has(name.toLowerCase().replace(/[_$]/g, ""));

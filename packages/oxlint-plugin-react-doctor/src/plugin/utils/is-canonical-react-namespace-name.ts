// Recognises identifier names that conventionally bind to the `react`
// package without an explicit `import * as` resolution step:
//
//   - `React`, `react`               — hand-written named imports
//   - `_react*`, `_React*` prefixes  — esbuild / SWC / tsc transpilation
//     of `import * as React from "react"` and friends
//
// Anything else (`Dispatcher`, `MyTestRenderer`, `_myLib`, `Reactor`,
// `Reactosaurus`, …) must fall through to an import-lookup check
// before the caller treats it as React-flavoured.
export const isCanonicalReactNamespaceName = (namespaceName: string): boolean => {
  if (namespaceName === "React") return true;
  if (namespaceName === "react") return true;
  if (namespaceName.startsWith("_react")) return true;
  if (namespaceName.startsWith("_React")) return true;
  return false;
};

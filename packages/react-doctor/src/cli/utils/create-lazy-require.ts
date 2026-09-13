import { createRequire } from "node:module";

// A dependency that only serves an occasional flow is required on first use
// instead of at startup; `require` of an ESM package is synchronous on the
// supported Node versions, so callers keep synchronous signatures.
export const createLazyRequire = <Module>(
  importMetaUrl: string,
  specifier: string,
): (() => Module) => {
  const requireModule = createRequire(importMetaUrl);
  let cachedModule: Module | null = null;
  return () => (cachedModule ??= requireModule(specifier));
};

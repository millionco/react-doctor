---
"deslop-js": patch
---

Restructure internally: the deslop analysis engine now lives in `@react-doctor/core` (under `src/deslop`, exposed via the `@react-doctor/core/deslop` subpath) and `deslop-js` is a thin facade that re-exports it. `vp pack` still bundles the engine into this package's `dist` (CJS + ESM) alongside the sibling `parse-worker.mjs`, so the published tarball stays self-contained and runtime-dependency-free beyond the existing `oxc-parser`/`oxc-resolver`/`fast-glob`/`minimatch` externals. The public API (`analyze`, `defineConfig`, `isOxcAstNode`, and every exported type) is unchanged.

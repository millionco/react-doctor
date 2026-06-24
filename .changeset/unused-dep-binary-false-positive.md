---
"deslop-js": patch
---

Rework unused-dependency detection to lean on real package metadata instead of hand-maintained whitelists.

- Treat any installed dependency that ships a CLI binary as used. A package that declares a `bin` is routinely invoked outside what a static scan can see (Makefiles, CI, git hooks, ad-hoc `npx`), so it's no longer flagged just because no `package.json` script names the binary. Empty `bin` fields (`""` / `{}`) don't count.
- Drop the hardcoded fallback tables now that the bin/peer scans read real `node_modules` metadata: the binary→package map (`CLI_BINARY_TO_PACKAGE` + the `babel`/`jest`/`remark` fallbacks), the env-wrapper binary set, the static peer-dependency map, and the implicit-companion map. With dependencies installed (the normal scan condition) detection is unchanged — a package's real `bin` and `peerDependencies` cover what the tables used to hardcode.

Trade-off: when scanning **without** `node_modules`, a CLI dependency whose binary name differs from its package name (e.g. `vp` → `vite-plus`) can no longer be resolved from scripts, and a few heuristic peer relationships that aren't declared `peerDependencies` (e.g. `@hookform/resolvers` → `zod`) are no longer inferred. The always-used lists for tooling that can't be detected statically (`typescript`, `eslint`, `@types/*`, `eslint-plugin-*`, …) are unchanged.

---
"react-doctor": patch
---

Cap the `oxlint` dependency to `>=1.66.0 <1.67.0`. oxlint 1.67.0 added an optional peer dependency on `vite-plus`, which in pnpm workspaces that install `vite-plus` at the root forces a second peer-resolution context for the Vite+ toolchain. That split installs a duplicate copy of the Vitest fork (`@voidzero-dev/vite-plus-test`), and test runs fail at collection with `Vitest failed to find the current suite` because hooks register in one copy while suites live in the other (#699). Pinning below 1.67 keeps react-doctor's oxlint free of the `vite-plus` peer edge, so pnpm dedupes the toolchain back to a single instance.

---
"@react-doctor/core": patch
"react-doctor": patch
---

Fix project discovery failing with "No React project found" when the resolved `typescript` package loads as CJS without named ESM exports (e.g. typescript@5.3 under pnpm's isolated layout): import the TypeScript compiler API via its default export, and surface unexpected discovery exceptions as a new `ProjectDiscoveryFailed` error instead of masking them as `ProjectNotFound`. (#1115)

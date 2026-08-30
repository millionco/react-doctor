---
"@react-doctor/core": patch
---

Fix Expo config plugin discovery through TypeScript type annotations. The config plugin collector now properly unwraps `satisfies`, `as`, and other TypeScript type annotations when reading `app.config.ts` files, fixing false positives for scoped package names and local plugin paths when the config object uses `satisfies ExpoConfig`.

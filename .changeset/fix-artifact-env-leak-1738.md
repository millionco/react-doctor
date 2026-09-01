---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

Fix false positives in `artifact-env-leak` rule for vendor library examples and intentionally-public tokens

- Extends comment masking to handle sourcemap JSON, masking comments in `node_modules` sources to prevent false positives from vendor library JSDoc examples (e.g., `@reatom/core` DATABASE_URL documentation)
- Adds `_[A-Z0-9]+_PUBLIC_(TOKEN|KEY|SECRET)` pattern to trusted public env names, exempting intentionally-public tokens like `VITE_STYTCH_PUBLIC_TOKEN` that pair a public-env prefix with `PUBLIC` as a distinct infix
- Pattern requires at least one component between underscore and `PUBLIC` to avoid matching the `PUBLIC` in `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefixes themselves (e.g., `NEXT_PUBLIC_SECRET_TOKEN` still correctly flags)

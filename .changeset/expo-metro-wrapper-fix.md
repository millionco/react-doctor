---
"@react-doctor/core": patch
---

Fix `expo-metro-config` false positive when using local config wrappers

The `expo-metro-config` rule now correctly handles metro configs that delegate to local wrappers (e.g. `./metro-helper.js`) that extend `expo/metro-config`. Previously, the rule only detected direct references to `expo/metro-config` or known third-party wrappers, causing false positives on user-defined helpers and monorepo shared configs - the common pattern for config presets like PostHog, custom Sentry setups, Storybook, and workspace-level metro utilities.

The fix adds a heuristic: if the metro config contains a relative `require()` or ES module `import from` statement, the rule assumes it might be delegating to a wrapper and stays quiet. This trades a small false-negative risk (custom configs with relative imports that don't extend Expo's) for eliminating false positives on every local wrapper.

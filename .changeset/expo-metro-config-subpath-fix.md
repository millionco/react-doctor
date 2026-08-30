---
"@react-doctor/core": patch
---

Fix false positive for @expo/metro-config direct dependency

The `expo-no-redundant-dependency` rule incorrectly flagged `@expo/metro-config` as redundant, suggesting to import from `expo/metro-config` instead. While `expo` does re-export the main entry point, it does NOT re-export subpaths like `babel-transformer`.

Projects that import `@expo/metro-config/babel-transformer` (documented by Expo for extending the Babel transformer) cannot use `expo/metro-config/babel-transformer` as that subpath does not exist. The suggested fix was impossible to follow for subpath imports.

Since the static check cannot distinguish between main entry and subpath usage, and Expo SDK upgrades keep both packages in lockstep, the version drift risk is minimal. This change prevents false positives by no longer flagging `@expo/metro-config` as redundant.

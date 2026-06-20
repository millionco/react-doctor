---
"deslop-js": patch
---

Fix false positives in Expo config plugin detection for package-name plugins and nested expo config

Expo config plugins can be referenced by package name (not just local paths) from app.json / app.config.\*, but the collector only kept plugins that resolved to local file paths. Additionally, the standard Expo config shape nests plugins under an `expo` key, which was never visited.

Fixed by:

- Tracking package-name plugins (like "expo-build-properties" or "expo-camera") alongside file-path plugins
- Descending into nested `expo` object in config objects
- Marking package-name plugins as used dependencies in detectStalePackages

Closes #914

---
"deslop-js": patch
---

Fix false positives in Expo config plugin detection for package-name plugins and nested expo config

Expo config plugins can be referenced by package name (not just local file paths) from `app.json` / `app.config.*`, but the collector dropped any plugin entry that didn't resolve to a local file — so packages referenced only as config plugins were reported as unused. The `app.config.{js,ts}` AST path also only matched a top-level `plugins` property and never descended into the standard `{ expo: { plugins: [...] } }` shape (the JSON `app.json` path already read `expo.plugins`).

Fixed by:

- Tracking package-name plugins (e.g. `@config-plugins/detox`, `@react-native-firebase/app`) alongside local file-path plugins
- Descending into the nested `expo` object in the config-object AST collector
- Marking those package-name plugins as used in `detectStalePackages` (gated on the declared dependency set, so unrelated strings can't suppress real unused deps)

Closes #914

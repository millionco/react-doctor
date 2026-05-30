---
"react-doctor": patch
---

Detect Expo projects independently of the single-valued `framework` hint. Project discovery now surfaces an `expoVersion` signal (the declared `expo` package spec, looked up in the project or any of its workspace packages, or `null`), paralleling `reactVersion`. The `expo` capability is keyed off `expoVersion !== null` rather than `framework === "expo"`, so Expo-specific rules now load on web-rooted monorepos whose `apps/mobile` workspace targets Expo, and on projects that declare both `expo` and a web bundler (where `vite` / `next` previously won framework detection and silently dropped the `expo` capability). The file-level package boundary in `oxlint-plugin-react-doctor` still keeps Expo-only rules quiet on web workspaces.

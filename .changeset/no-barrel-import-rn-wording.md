---
"oxlint-plugin-react-doctor": patch
---

`no-barrel-import` messaging is now framework-aware: files that target React Native / Expo (per the nearest `package.json` platform, native/web file extensions, and the project `framework` setting) say the barrel import "ships extra code in your app bundle & slows startup" instead of the web-only "slows page load" wording. Web projects, web-extension files inside RN monorepos, and projects with an unknown framework keep the existing page-load wording.

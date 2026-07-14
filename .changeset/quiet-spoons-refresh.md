---
"oxlint-plugin-react-doctor": patch
---

Only run `only-export-components` when the file is owned by a proven Fast Refresh integration, including source packages explicitly consumed by workspace Vite and Storybook apps. Strengthen component, route, wrapper, barrel, React element return, portal, default alias, and React DOM root detection to avoid filename and PascalCase-only false positives.

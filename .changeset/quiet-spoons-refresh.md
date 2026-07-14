---
"oxlint-plugin-react-doctor": patch
---

Only run `only-export-components` when the file is owned by a proven Fast Refresh integration, including source packages explicitly consumed by workspace Vite apps, serving Parcel commands, React Vite Storybooks, and Storybook Webpack projects that explicitly enable `reactOptions.fastRefresh`. Strengthen component, route, wrapper, barrel, React element return, portal, default alias, and React DOM root detection to avoid filename and PascalCase-only false positives.

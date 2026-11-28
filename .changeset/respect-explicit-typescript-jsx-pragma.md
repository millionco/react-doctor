---
"oxlint-plugin-react-doctor": patch
---

Respect an explicit automatic JSX runtime pragma in directly configured TypeScript builds.

Keep warnings for unbound `React` tags, including `<React.Fragment>`, when the automatic runtime handles the surrounding JSX.

---
"oxlint-plugin-react-doctor": patch
---

Fix `jsx-no-undef` false positives for identifiers provided via runtime-injected scope (e.g., react-live, Storybook). The rule now honors ESLint-style `/* global X, Y */` or `// global X` comments, allowing files that use JSX identifiers from an injected scope to declare them without triggering the diagnostic.

Fixes #959.

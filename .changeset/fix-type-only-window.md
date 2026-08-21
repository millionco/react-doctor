---
"oxlint-plugin-react-doctor": patch
---

fix(no-unguarded-browser-global-at-module-scope): Ignore TypeScript type-only positions

The rule was incorrectly flagging browser-global names (`window`, `navigator`, etc.) when they appeared as property keys in TypeScript interfaces and type aliases. These are type-only positions that TypeScript erases during compilation, so no runtime reference error occurs.

Fixes #1667

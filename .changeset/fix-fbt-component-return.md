---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix(rn-no-raw-text): suppress diagnostic for components returning only transparent text wrappers

Components whose entire return value is a transparent text wrapper (`<fbt>`, `<fbs>`, or `<Fragment>`) are now classified as text-producing components. This prevents false positives when such components are consumed inside `<Text>` elements.

Fixes #1729

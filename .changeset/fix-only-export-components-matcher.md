---
"oxlint-plugin-react-doctor": patch
---

Fix `only-export-components` false positive for components returning exhaustive matchers. The rule now correctly recognizes React components that return call expressions with JSX nested inside object property functions, such as pattern matchers like `match(state, { loading: () => <div>...</div>, ... })`.

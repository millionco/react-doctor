---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix false positive for local member methods named `.use()`

`rules-of-hooks` no longer reports `Service.use(...)` calls where `Service` is a local (non-React) identifier. The rule now correctly distinguishes between:
- Local service APIs (`Service.use(...)`) - not reported
- React's `use` hook (`React.use(...)`) - still reported when misused

Fixes #1797

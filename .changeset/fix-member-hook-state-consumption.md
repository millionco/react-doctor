---
"oxlint-plugin-react-doctor": patch
---

Fix `rerender-state-only-in-handlers` false positive when state is consumed via member expression hook calls like `styles.useVariants({ state })`. The rule now recognizes both direct identifier calls (`useX`) and member expression calls (`obj.useX`) when tracking custom hook arguments that consume state.

---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in zustand-no-fresh-selector-result for setState updater callbacks

The rule no longer flags callbacks passed to Zustand's imperative store API methods (setState, getState, subscribe, getInitialState). These methods accept updater callbacks or listeners, not selectors, so they should not be subject to the fresh-reference check.

Fixes #1575

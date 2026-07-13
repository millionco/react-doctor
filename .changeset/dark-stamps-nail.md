---
"oxlint-plugin-react-doctor": patch
---

Prevent prefer-use-effect-event from reporting React useCallback values with stable empty dependency arrays or stable React hook values while preserving changing callback diagnostics, including for useCallback and stable hooks destructured from the React namespace.

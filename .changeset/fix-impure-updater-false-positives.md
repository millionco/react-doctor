---
"oxlint-plugin-react-doctor": patch
---

Preserve parameter-provided cleanup callbacks and forwarded callback values as conservative external functions after parameter bindings stopped resolving to their enclosing function. This prevents false positives across shared state and effect analysis.

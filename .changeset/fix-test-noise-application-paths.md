---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Run `test-noise` rules in ambiguous product-named directories such as `tools`, `demo`, and `migrations` when they are below a recognized application source root. Explicit test surfaces and root-level tooling or example directories remain excluded.

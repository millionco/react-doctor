---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Disable react-hooks-js/incompatible-library rule

The react-hooks-js/incompatible-library rule from React Compiler is overly aggressive and flags well-designed, battle-tested libraries like @tanstack/react-virtual, @tanstack/react-table, and similar libraries. These libraries are specifically designed to work with React and don't present the compatibility issues the rule is trying to catch. The remediation guidance can push users away from mature virtualization/data libraries toward fragile, handwritten implementations.

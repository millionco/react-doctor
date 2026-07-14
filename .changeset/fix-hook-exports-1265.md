---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `only-export-components` for exported custom hooks. The rule now correctly allows `use[A-Z]` function exports alongside component exports, matching modern Fast Refresh behavior where hooks are treated as refresh boundaries.

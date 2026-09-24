---
"oxlint-plugin-react-doctor": patch
---

Fix a stack overflow in `no-hydration-branch-on-browser-global` when resolving arguments across files. Track parameters and visited bindings by symbol identity so file-local numeric IDs cannot collide, and preserve cycle tracking across imported helpers.

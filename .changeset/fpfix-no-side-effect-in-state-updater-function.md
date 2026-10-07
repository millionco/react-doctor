---
"oxlint-plugin-react-doctor": patch
---

An updater may copy each state element before a local helper changes those fresh copies. Track that ownership through helper parameters and for-of loops. Keep warnings for shared objects, nested shared fields, replaced elements, and aliases that add shared values.

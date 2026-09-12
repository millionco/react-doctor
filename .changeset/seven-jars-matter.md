---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Retire 33 low-value rule IDs while keeping them registered as silent compatibility entries. Make 26 cleanup, migration, performance, and security-review rules opt-in. Existing rule configurations still load; default scans no longer report these recommendations as defects.

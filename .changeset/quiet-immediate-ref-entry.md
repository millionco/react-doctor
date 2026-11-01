---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid following a contradictory helper branch inside a state updater when an immediate guard reads the same ordinary React ref cell. Keep alternate effects and restore the branch when another updater entry lacks that guard.

---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Recognize guarded loading resets when an effect starts a replacement request while open and a separate effect clears the same loading flag on close. Keep warning when a replacement can leave loading active without reaching its protected cleanup.

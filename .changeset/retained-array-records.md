---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Detect assignments to state records retained by a shallow array copy when every setter feed has a closed literal-record origin and the index comes from the state array's native map callback. Keep opaque feeds, escaped records, replaced indices, new fields, and unproved indices outside this check.

---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

fix(rn-no-raw-text): recognize common text wrapper component names

Adds Button, Chip, Badge, Pill, Tab, and Link to the text component keywords, allowing the rule to properly recognize these common text-rendering wrapper components when they're imported from other files. Also improves the precedence logic so that auto-detection takes priority over the name heuristic for locally-defined components, preventing false negatives.

Fixes #873

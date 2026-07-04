---
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Fix a CI-gate false positive in the baseline delta: pre-existing element-level findings (Accessibility-category rules, plus rules flagged `matchByOccurrence` like `iframe-missing-sandbox`) are now matched by `(file, rule)` occurrence count instead of the flagged line's text, so reformatting the flagged line (reindentation, prettier reflow, collapsing a multi-line JSX element) no longer reports the finding as newly introduced. The flag is resolved at diagnostic creation and carried on the diagnostic as an optional `matchByOccurrence` field (also present in the JSON report). Expression-level rules keep line-text-sensitive matching, and a genuinely new extra occurrence still surfaces.

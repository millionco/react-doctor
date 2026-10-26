---
"oxlint-plugin-react-doctor": patch
---

Fix `unsafe-json-in-html` escape detection for `JSON.stringify().replaceAll("<", "\\u003c")`

The `unsafe-json-in-html` rule now recognizes `.replaceAll("<", "\\u003c")` as a safe escape pattern, equivalent to the global `.replace(/</g, "\\u003c")` form. It still flags runtime replacements like `"\u003c"` or non-global `.replace("<", ...)` calls that can leave raw less-than characters in JSON embedded in HTML/script tags.

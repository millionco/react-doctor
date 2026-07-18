---
"react-doctor": patch
---

Add `comment-on-clean` input to GitHub Action to suppress success comments. When set to `false`, the action will only post PR comments when issues are found, reducing noise. Existing comments are still updated to reflect the latest scan results.

---
"oxlint-plugin-react-doctor": patch
---

Fix confirmed rule false positives by restoring the correct `jsx-key` spread ordering, requiring positive evidence that a spread can override a key, ignoring JSX arrays consumed as non-rendering data, skipping redirect-only Next.js pages in `nextjs-missing-metadata`, allowing multi-suffix env template files, and retiring the obsolete `jsx-no-target-blank` rule.

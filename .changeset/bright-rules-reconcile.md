---
"oxlint-plugin-react-doctor": patch
---

Fix confirmed rule false positives by restoring the correct `jsx-key` spread ordering, requiring positive evidence that a spread can override a key, ignoring JSX arrays consumed as non-rendering data, skipping redirect-only Next.js pages in `nextjs-missing-metadata`, and allowing multi-suffix env template files. Restrict `jsx-no-target-blank` to projects that explicitly target browsers or Electron versions without implicit opener protection.

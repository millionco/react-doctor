---
"oxlint-plugin-react-doctor": patch
---

`nextjs-missing-metadata` no longer flags pages covered by an ancestor layout's `metadata` or `generateMetadata` export. Next.js metadata is inherited down the App Router tree, so a root (or intermediate) `layout.tsx` that defines metadata already gives every page below it a title and description.

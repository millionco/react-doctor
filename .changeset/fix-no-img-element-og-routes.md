---
"oxlint-plugin-react-doctor": patch
---

Fix `nextjs-no-img-element` false positive in Next.js metadata image routes (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`). These files rasterize JSX via `next/og` and cannot use `next/image`. Also fix pre-existing `alt-text` bug where backslash paths on Windows were not normalized before the same metadata-route check.

---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `no-unknown-property`: the `tw` attribute (used by `@vercel/og` / `next/og` for Tailwind CSS styling) is no longer flagged in Next.js metadata image route files (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`).

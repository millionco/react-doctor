---
"oxlint-plugin-react-doctor": patch
---

Fix false positives found on a fresh React 19 / RSC / Next.js 15 corpus:

- `server-sequential-independent-await` no longer flags awaits of Next.js request-scoped APIs (`headers()`, `cookies()`, `draftMode()`, `connection()`, next-intl server helpers) or awaits of already-existing promises such as Next.js 15 `props.params` / `props.searchParams`.
- `server-fetch-without-revalidate` no longer flags the documented `next/og` static-asset fetch (`fetch(new URL(..., import.meta.url))`) or Remix / React Router `app/` route files, where the Next.js data cache never applies.
- `rendering-hydration-mismatch-time` no longer flags time/random values in JSX rasterized by `ImageResponse` / satori (og images never hydrate).
- `nextjs-missing-metadata` no longer flags `"use client"` pages, which cannot export `metadata` / `generateMetadata`.

---
"oxlint-plugin-react-doctor": patch
---

`only-export-components` now recognizes the route/special files of every file-routing framework react-doctor covers and skips them, so the documented "co-export config/metadata next to the default component" shape stops producing false-positive "non-component export" warnings:

- **Next.js** — App Router (`page`, `layout`, `loading`, `error`, `not-found`, `template`, `default`, `global-error`, `route`) and Pages Router (`_app`, `_document`, `_error`) special files, plus metadata image routes (`opengraph-image`, `twitter-image`, `icon`, `apple-icon`, incl. numbered variants), which fixes the `alt` / `size` / `contentType` / `revalidate` exports in `opengraph-image.tsx` ([#776](https://github.com/millionco/react-doctor/issues/776)).
- **Expo Router** — `_layout` and the `+html` / `+not-found` / `+native-intent` reserved files.
- **TanStack Router / Start** — `__root` and `*.lazy` route modules.
- **Remix / React Router** — `root`, `entry.client`, and `entry.server` modules.

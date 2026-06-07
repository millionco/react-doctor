---
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

---
"oxlint-plugin-react-doctor": patch
---

`only-export-components` now treats Expo Router `_layout.tsx` / `_layout.jsx` files as entry points (same as Next.js `layout.tsx`), so co-located helpers alongside a single wrapped default export no longer trigger false-positive "non-component export" warnings (#708).

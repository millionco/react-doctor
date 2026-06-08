---
"@react-doctor/core": patch
---

Add a `no-vulnerable-react-server-components` security check that flags projects running React Server Components on a version with a known advisory — primarily the critical unauthenticated RCE (CVE-2025-55182, CVSS 10.0), and the later high-severity DoS (CVE-2026-23870).

It resolves the concrete installed version of React's RSC runtime and compares it against the patched releases per minor line (19.0 → 19.0.6, 19.1 → 19.1.7, 19.2 → 19.2.6). Frameworks and bundlers that expose `react-server-dom-*` directly (Vite, Parcel, React Router, Waku, RedwoodSDK) are checked by those package versions; Next.js — which vendors its own RSC runtime — is checked by its `next` version and the easiest corrective fix points at a Next.js upgrade (15.5.18 / 16.2.6) rather than a React bump. Pure client-side React apps with no RSC packages and no Next.js are unaffected and stay quiet, and the check never flags off an ambiguous declared range whose lockfile may resolve to a patched version.

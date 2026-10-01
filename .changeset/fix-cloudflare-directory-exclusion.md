---
"@react-doctor/core": patch
"react-doctor": patch
---

Exclude `.cloudflare` build output directory from source file discovery. Cloudflare's `cf` CLI stores compiled Worker bundles and cache state there, mirroring the existing `.wrangler` exclusion.

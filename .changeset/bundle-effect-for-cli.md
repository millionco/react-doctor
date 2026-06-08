---
"react-doctor": patch
---

Bundle Effect into the published CLI so `npx react-doctor@latest` no longer installs Effect's `ini@7` dependency and avoids the Node 22.19 engine warning.

Also remove the repo-local composite action surface and have generated GitHub Actions workflows invoke `npx react-doctor@latest` directly.

---
---

Pin GitHub Actions to commit SHAs in the publish workflow for supply chain security. The workflow holds `id-token: write` for npm OIDC trusted publishing, `contents: write`, and `SENTRY_AUTH_TOKEN`, making it a high-privilege target. Mutable action tags (@v5, @v1) allow upstream compromise to yield npm publish access. All actions are now pinned to full commit SHAs with version comments, and `persist-credentials: false` is set on checkout steps.

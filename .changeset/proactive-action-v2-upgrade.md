---
"react-doctor": patch
---

CI setup now offers a one-time, per-repo prompt to upgrade an existing React Doctor GitHub Actions workflow from `@v1` to `@v2` — accepting opens a PR with the bump, declining is remembered so it never asks again. The generated / "Add to CI" workflow now pins `millionco/react-doctor@v2` and grants `statuses: write`, so the action can publish the score as a commit status (and surface results on pushes to the default branch).

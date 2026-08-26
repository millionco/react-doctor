---
"react-doctor": patch
---

CI hardening: restrict Turbo remote cache to main-branch pushes and document unsigned tag security trade-offs

Fixes two workflow security issues:

1. **Turbo remote cache poisoning vector**: First-party PR branches previously had write access to the Turbo remote cache, enabling cache poisoning attacks where malicious code in a PR could poison cache entries consumed by subsequent main-branch builds. Now `TURBO_TOKEN` and `TURBO_TEAM` are only provided on `push` events to the `main` branch. PRs run with a cold cache (slower but safe).

2. **Unsigned floating-major tag documentation**: The action version bump automation creates unsigned tags (CI has no GPG key), but this wasn't prominently documented. Added clear SECURITY comments in the workflow explaining that `@v2` is unsigned and recommending full commit-SHA pinning for supply-chain-hardened CI. Also updated the workflow template that `ci install` generates to include this security guidance.

These changes affect CI configuration only and don't change any diagnostic behavior.

---
"@react-doctor/core": patch
"@react-doctor/api": patch
"react-doctor": patch
---

Make `require-pnpm-hardening` check opt-in (disabled by default). The check previously ran on every pnpm project and recommended a 7-day `minimumReleaseAge` — stricter than pnpm 11's own 24-hour default — which could delay critical CVE patches, break Dependabot workflows, or require immediate lockfile surgery in existing projects. Teams that want the extra hardening can explicitly enable it via `pnpmHardening: { enabled: true }` in their config.

Fixes #1843.

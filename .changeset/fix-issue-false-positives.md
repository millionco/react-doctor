---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

Fix five false positives reported in security-scan and TanStack Query rules:

- `query-destructure-result` now only flags the `useQuery` family imported from `@tanstack/react-query` / `react-query`, so a same-named `useQuery` from `convex/react`, `@apollo/client`, `urql`, or `wagmi` is left alone (#818).
- `artifact-secret-leak` and `artifact-env-leak` no longer flag server-only build output nested under a mode directory (e.g. `.next/dev/server/chunks/*.js.map`); the server-artifact matcher now allows intermediate path segments before `server/` (#816, #817).
- `webhook-signature-risk` recognizes verification delegated to an imported helper whose name carries a signature/secret/HMAC noun (e.g. `isValidSecret(...)`), so moving the timing-safe comparison into another module no longer trips the rule (#814).
- `repository-secret-file` no longer flags a `.env` (or other secret file) that is git-ignored and therefore not checked in; tracked files and repos without git are still flagged (#813).

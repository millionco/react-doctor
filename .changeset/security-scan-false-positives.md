---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Fix false positives reported in the security and TanStack rules:

- **`query-destructure-result`** (#818): only flags `useQuery`/`useSuspenseQuery`/… when they actually come from a TanStack Query package (`@tanstack/*-query`, legacy `react-query`). A same-named hook imported from elsewhere — notably Convex's `useQuery` from `convex/react`, which returns the data directly — is no longer flagged.
- **`artifact-env-leak` / `artifact-secret-leak`** (#816, #817): no longer treat server-side or dev-mode Next.js output as browser artifacts. `.next/dev/server/**` (dev source maps), any `.next/**/server/**`, `.output/server/**`, and the dev server's `.next/dev/**` output are excluded; production browser bundles (`.next/static`, `dist/assets`, `public/`, …) are still scanned.
- **`repository-secret-file`** / **`key-lifecycle-risk`** (#813): no longer flag a credential/key file that git ignores — a local-only, gitignored `.env` is not "checked into the repository". Findings are dropped only when git definitively reports the path as ignored (the finding stands when there is no repo or git is unavailable).
- **`webhook-signature-risk`** (#814): recognizes a delegated verification helper (a call pairing a verify-ish verb with a security noun, e.g. `isValidSecret(...)`, `verifySignature(...)`, `checkWebhookHmac(...)`) as verification evidence, so an extracted `timingSafeEqual` comparison in another module no longer trips the rule.

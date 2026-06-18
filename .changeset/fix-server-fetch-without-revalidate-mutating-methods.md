---
"oxlint-plugin-react-doctor": patch
---

Fix `server-fetch-without-revalidate` false positive on mutating fetches. Next.js only caches GET requests, so a `fetch(url, { method: "POST" | "PUT" | "PATCH" | "DELETE" })` in a Server Component or route handler can never serve stale cached data — the rule no longer flags it.

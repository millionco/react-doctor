---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Fix #976: Next.js projects using `output: "export"` (static export) no longer receive server-only fix recommendations that are impossible without a request-time server. `server-fetch-without-revalidate` is gated off, `nextjs-no-client-side-redirect` keeps firing but its advice drops the middleware / `getServerSideProps` clause (recommending a render-time or client-side redirect instead), and `no-prevent-default` emits the framework-neutral `<form>` message rather than recommending Server Actions.

This is delivered through a general framework-capability vocabulary that any rule can read at runtime (`nextjs:static-export`, `server-actions`, …) rather than rules hardcoding their own framework lists, so future framework-aware rules adapt the same way.

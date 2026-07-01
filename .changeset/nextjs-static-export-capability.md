---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Fix #976: Next.js projects using `output: "export"` (static export) no longer receive server-only fix recommendations that are impossible without a request-time server. `server-fetch-without-revalidate` is gated off, `nextjs-no-client-side-redirect` keeps firing but its advice drops the middleware / `getServerSideProps` clause (recommending a render-time or client-side redirect instead), and `no-prevent-default` emits the framework-neutral `<form>` message rather than recommending Server Actions. The detection also works when the static export lives in a workspace: a monorepo-root scan whose `apps/web` sets `output: "export"` is now recognized (the config is read next to the manifest that supplies the `next` dependency).

Under the hood this refactors framework gating into one typed capability vocabulary — a `Capability` union both `requires`/`disabledWhen` metadata and the runtime `hasCapability(settings, …)` check compile against, so a misspelled token fails `tsc` instead of silently never matching. Rules own their capability-conditioned prose via a new `recommendationFor(hasCapability)` hook (core no longer rewrites specific rules' advice), and `no-prevent-default`'s hardcoded SPA framework list is replaced by the new `client-only` capability. ESLint-plugin users who suppressed the `<form>` variant via `settings["react-doctor"].framework` should now set `settings["react-doctor"].capabilities: ["client-only"]`.

Project discovery now traverses workspaces once instead of up to ~7 times (one pass collects react/tailwind/zod/framework, React Native awareness, reanimated, expo, flash-list, and next facts), and workspace precedence is sorted-deterministic instead of filesystem readdir order — on multi-workspace repos where several packages could supply the framework or React version signal, the first in sorted walk order now consistently wins.

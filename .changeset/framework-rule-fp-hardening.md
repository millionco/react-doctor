---
"oxlint-plugin-react-doctor": patch
---

Eliminate false positives across the framework rules (nextjs, server, tanstack-query, tanstack-start, jotai, preact, client): redirect-in-try-catch rules now allow the documented rethrow pattern and resolve the real next/navigation import, `server-hoist-static-io` tracks request-derived paths through intermediate bindings, `query-mutation-missing-invalidation` recognizes destructured and tRPC-style (`utils.x.invalidate()`) cache invalidation, `server-no-mutable-module-state` only flags const containers that are actually mutated, and passive-event-listener, image-sizes, anchor, loader-waterfall, navigate-in-render, and children-length checks all gained escape hatches for legitimate patterns. Validated against 500 OSS repositories.

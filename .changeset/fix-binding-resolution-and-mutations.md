---
"oxlint-plugin-react-doctor": patch
---

Fix cache/navigation binding resolution and unsafe mutation parallelization (issue #1810)

- **server-cache-with-object-literal**: Properly resolve React.cache imports through aliases and check all argument positions for fresh objects/arrays. Shadowed or non-React cache functions no longer trigger false positives.

- **nextjs-no-redirect-in-try-catch**: Recognize Next.js `unstable_rethrow(error)` as a valid error forwarding pattern, suppressing the diagnostic when the caught error is correctly rethrown.

- **server-sequential-independent-await** and **async-parallel**: Detect mutating HTTP requests (POST, PUT, PATCH, DELETE) and preserve their ordering, preventing incorrect parallelization suggestions for operations that must run sequentially.

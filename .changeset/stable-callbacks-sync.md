---
"oxlint-plugin-react-doctor": patch
---

Resolve synchronously invoked React `useCallback` bodies in `no-effect-chain` so timer synchronization and state writes receive the same analysis as inline callbacks.

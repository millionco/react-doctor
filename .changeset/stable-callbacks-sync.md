---
"oxlint-plugin-react-doctor": patch
---

Improve `no-effect-chain` precision by following synchronous React `useCallback` bodies for reader reachability and proven timer, storage, HTTP, query-client, DOM, React-ref, and cleanup synchronization. Infer stable-callback state writes only when the reachable graph targets one state value and contains no opaque calls or other observable work. Tighten global namespace and object provenance to direct, non-defaulted bindings, preserve receiver mutation detection through TypeScript wrappers, and keep concise and explicit local-call returns consistent.

---
"oxlint-plugin-react-doctor": patch
---

Recognize TanStack Start's current `.validator()` server-fn method (not just the deprecated `.inputValidator()`) in `tanstack-start-server-fn-validate-input` and `tanstack-start-server-fn-method-order`.

`@tanstack/react-start` renamed the server-function input-validation step from `inputValidator` back to `validator` and now marks `inputValidator` as deprecated. Both rules only matched `inputValidator`, so projects on current TanStack Start that use `.validator()` got a false "missing input validation" diagnostic, and the method-order check ignored a misplaced `.validator()`. Both names are now treated as the same validation step in the chain walker and the method-order sequence, and the rule messages/recommendations point at the canonical `.validator()`.

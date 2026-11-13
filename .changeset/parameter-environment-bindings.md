---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Resolve parameter defaults and computed destructuring keys outside function body declarations. This prevents false ref-mutation warnings and unsafe Math recommendations when a body binding shadows the provider used by a default expression.

Track incoming parameter values copied into same-name body vars when checking helper mutations and escapes. This preserves passive-listener and synchronous-XHR recommendations only when the native method remains unmodified.

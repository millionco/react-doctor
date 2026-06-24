---
"@react-doctor/core": patch
---

Fix crash when disable comments contain Object.prototype keys (constructor, toString, valueOf, etc.)

Resolves REACT-DOCTOR-1Y and fixes #920.

The suppression near-miss detector would crash with `TypeError: bareRuleKey.includes is not a function` when an eslint-disable or oxlint-disable comment contained a token matching an Object.prototype member name. Indexing the LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY lookup map with such a token returned an inherited method (which the `??` fallback let through), so `canonicalizeRuleKey` now guards the lookup with a `typeof` check and only treats the result as an alias when it is a string.

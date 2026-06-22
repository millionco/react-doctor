---
"@react-doctor/core": patch
---

Fix crash when disable comments contain Object.prototype keys (constructor, toString, valueOf, etc.)

Resolves REACT-DOCTOR-1Y and fixes #920.

The suppression near-miss detector would crash with `TypeError: bareRuleKey.includes is not a function` when an eslint-disable or oxlint-disable comment contained a token matching an Object.prototype member name. The LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY lookup map now uses Object.create(null) to be immune to inherited keys, with an additional typeof guard for defense-in-depth.

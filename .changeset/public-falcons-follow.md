---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `effect-needs-cleanup` when subscribing through a logical expression receiver (nullish coalescing `??`, logical OR `||`, or logical AND `&&`). The rule now correctly recognizes cleanup for subscriptions like `(parent ?? navigation).addListener(...)` and aliased logical expressions like `const target = primary || fallback; target.on(...)`.

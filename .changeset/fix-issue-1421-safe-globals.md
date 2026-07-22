---
"oxlint-plugin-react-doctor": patch
---

Fix false positives in loading-reset, promise-handler, effect-cleanup, and class-unmount rules when control flow includes proven-safe global formatting calls such as `Math.round()`, `performance.now()`, and static console methods. Keep dynamic, unknown, and shadowed global lookalikes conservative.

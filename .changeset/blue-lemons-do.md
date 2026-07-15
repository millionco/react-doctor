---
"oxlint-plugin-react-doctor": patch
---

Fix `effect-needs-cleanup` to follow synchronous React ref callback chains so timers and subscriptions reached through multiple ref callbacks are not missed.

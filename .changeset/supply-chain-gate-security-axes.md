---
"react-doctor": patch
---

The Socket supply-chain check now gates on the security axes (supply chain, vulnerability) instead of Socket's `overall` score, and the diagnostic names the exact axis that failed. Socket's `overall` is its lowest axis, so a package with perfect security scores could fail the Security gate purely on quality/maintenance — `@types/bun` was reported as having a "supply-chain score of 48" while socket.dev showed Supply Chain 100 (issue #770). Known-bad packages (`event-stream@3.3.6`, vulnerable `minimist`/`lodash` releases) are still flagged via their vulnerability axis, and the reported number now always matches the axis named on the socket.dev package page.

---
"react-doctor": patch
---

Remove the `--sfw` demo flag (the standalone Socket.dev supply-chain score listing that printed every direct dependency's score and exited).

The Socket.dev supply-chain **check** is unaffected — it still runs during normal full scans (and on diff scans whose `package.json` changed) and its scores still appear in the JSON report. Only the standalone listing is gone, along with its demo-only internals (`collectSupplyChainScores`, the `DependencyScore` type, the monorepo-wide dependency collector, and the score-table renderer).

---
"react-doctor": minor
---

Add an opt-in Socket.dev supply-chain score check. When enabled via `supplyChain.enabled`, every direct dependency in `package.json` is scored against Socket's free, keyless PURL endpoint (the same lookup Socket Firewall's free tier uses) and any dependency whose Socket score falls below `supplyChain.minScore` (default `50`, 0–100 scale) produces a `Security` diagnostic. At the default `severity: "error"` a low score fails the scan at the standard `blocking` gate. The check is fail-open (per-package timeouts / network failures are skipped) and is always skipped in `--diff` / `--staged` mode and in editor scans.

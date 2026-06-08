---
"react-doctor": minor
---

Add a Socket.dev supply-chain score check. Every direct dependency in `package.json` is scored against Socket's free, keyless PURL endpoint (the same lookup Socket Firewall's free tier uses) and any dependency whose Socket score falls below `supplyChain.minScore` (default `50`, 0–100 scale) produces a `Security` diagnostic. At the default `severity: "error"` a low score fails the scan at the standard `blocking` gate. The check runs by default; opt out with `supplyChain: { enabled: false }`. It is fail-open (per-package timeouts / network failures are skipped) and is always skipped in `--diff` / `--staged` mode and in editor scans.

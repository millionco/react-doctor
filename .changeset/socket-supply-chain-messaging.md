---
"react-doctor": patch
---

Clearer Socket supply-chain diagnostics (`socket/low-supply-chain-score`). When Socket returns a concrete alert, the message now names it — e.g. a critical "known malware" alert, the offending file, and a one-line description — instead of only a bare score; when it doesn't (metric-driven dips like CVE-only scores), the message explains what the failing axis means. The help is now axis-aware: remove a package flagged as compromised, upgrade past known vulnerabilities (`npm audit`), or vet-and-raise the threshold — rather than a generic "update or replace". The headline leads with the exact failing axis and collapses the redundant "declared as X, scored at X" phrasing (a range now reads `pkg@floor (lowest version "^x.y.z" allows)`). JSON report shape is unchanged (`schemaVersion: 1`).

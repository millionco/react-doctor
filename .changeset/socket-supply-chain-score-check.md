---
"react-doctor": minor
---

Add a Socket.dev supply-chain score check. Every direct dependency in `package.json` is scored against Socket's free, keyless PURL endpoint (the same lookup Socket Firewall's free tier uses) and any dependency whose Socket score falls below `supplyChain.minScore` (default `50`, 0–100 scale) produces a `Security` diagnostic anchored at the offending `package.json` entry. At the default `severity: "error"` a low score fails the scan at the standard `blocking` gate.

The check runs by default; opt out with `supplyChain: { enabled: false }`. It is fail-open (per-package timeouts / network failures are skipped, never sinking the scan). A plain `--diff` / `--staged` scan skips it like the other whole-project checks, but a diff that edits a `package.json` (including any workspace's in a monorepo) still scores that project's dependencies — so a PR that adds or bumps a dependency is covered. `next` is excluded (its framework-specific risks are already covered by the Next.js / server-components rules).

---
"react-doctor": minor
---

Add `--supply-chain` / `--no-supply-chain` CLI flags to toggle the dependency supply-chain scan, mirroring `--lint`/`--no-lint` and `--dead-code`/`--no-dead-code`. Supply-chain enablement now resolves as a scan option (`InspectOptions.supplyChain`) against `supplyChain.enabled` — the flag wins — so it takes precedence over per-project config on every scan (a workspace module's config can't undo `--no-supply-chain`), and config isn't mutated so `scan.hasCustomConfig` telemetry stays accurate. The enabled state also rides the per-scan wide event as `scan.supplyChain`.

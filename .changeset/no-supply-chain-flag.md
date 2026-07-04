---
"react-doctor": minor
---

Add `--supply-chain` / `--no-supply-chain` CLI flags to toggle the dependency supply-chain scan, mirroring `--lint`/`--no-lint` and `--dead-code`/`--no-dead-code`. `--no-supply-chain` is sugar for `supplyChain: { enabled: false }` in the config: the flag folds into the effective config at load, so every downstream reader (the runtime layer selector, the diff-mode manifest gate, per-project merges) inherits it from one source, and `--supply-chain` wins over a config `enabled: false`. The enabled state also rides the per-scan wide event as `scan.supplyChain`.

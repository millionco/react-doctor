# @react-doctor/fuzz

Adversarial fuzzing harness for React Doctor rules. Private — never published.

It generates seeded random React/TSX programs, applies noise mutations
(deleted/duplicated/swapped slices, unicode and token injection), and runs
every rule in the registry against them with three oracles:

- **crash** — the rule threw while visiting a parseable program
- **slow** — a single file took pathologically long (default 2s)
- **invariant-violation** — a semantics-preserving rewrite (leading/trailing
  comments, trailing unused declaration) changed the diagnostics, meaning the
  rule keys off incidental source shape (AST rules only)

Every case is reproducible from its seed; reproducers for findings are written
to `tmp/fuzz-findings/`.

## Usage

```bash
pnpm fuzz                                  # fuzz all rules (from repo root)
FUZZ_RULE=no-array-index-as-key pnpm fuzz  # one rule (substring match)
FUZZ_ITERATIONS=200 FUZZ_SEED=42 pnpm fuzz # more cases, fixed seed
FUZZ_INVARIANTS=1 pnpm fuzz                # warn on invariant violations
FUZZ_STRICT=1 pnpm fuzz                    # fail on invariant violations too
```

`pnpm test` in this package runs only the always-on harness smoke tests; the
full fuzz run is opt-in via `REACT_DOCTOR_FUZZ=1` (what `pnpm fuzz` sets).

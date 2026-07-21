# @react-doctor/fuzz

Adversarial fuzzing harness for React Doctor rules. Private — never published.

Each iteration builds a program from one of three sources, mutates it, and
runs every rule in the registry against it with three oracles:

Program sources:

- **grammar-generated** — snippet pools distilled from two real-world corpora
  (React/TSX that coding agents actually wrote, mined from Claude Code session
  traces, and 13 production repos from the react-bench corpus). Pools share a
  common lexicon (`state`/`setState`, `items`, `url`, `handle`, …) and include
  multi-statement scenario builders (alias → guard → deref, listener register →
  cleanup, cancellation flags) so statements form the dataflow relationships
  rules key on. Filenames rotate per iteration to exercise path gating
  (test-noise skips, Next.js `app/`/`pages/`, `.client.tsx`, e2e suffixes).
- **pathological shapes** (~12% of iterations) — deep JSX nesting, long
  optional/binary chains, hundreds of siblings, nested ternaries, very wide
  component bodies: probes recursive walkers for stack overflows and
  quadratic scans.
- **corpus files** (opt-in via `FUZZ_CORPUS_DIR`) — real `.tsx`/`.jsx` files
  loaded round-robin across the directory's top-level repos, optionally
  crossed over (AFL-style line-chunk transplant) with a generated program.

Mutations: deleted/duplicated/swapped character slices and whole lines,
unicode/token injection, and a dictionary of rule-trigger tokens
(`useEffect(() => {}`, `.removeEventListener(`, `dangerouslySetInnerHTML`, …)
spliced into random positions to produce half-formed trigger contexts.

Oracles:

- **crash** — the rule threw while visiting a parseable program
- **slow** — a single file took pathologically long (default 2s)
- **invariant-violation** — a semantics-preserving rewrite (leading/trailing
  comments, trailing unused declaration, comments/blank lines spliced
  _between_ top-level sections) changed the diagnostics, meaning the rule
  keys off incidental source shape (AST rules only)

When a program makes a rule FIRE, extra mutated descendants of it are fuzzed
too — a cheap feedback loop that keeps inputs near reporting paths. The run
prints a **fire-coverage** summary (rules that produced ≥1 diagnostic): that
number, not the iteration count, is the harness's health metric — a rule
that never fires is only having its early bails fuzzed.

Each compatible canonical liveness fixture runs first, so the harness reaches
a known reporting path before exploring generated and corpus-derived programs.
Corpus seeds with a `// verdict: pass` or `// verdict: fail` header are also
run deterministically by the smoke suite against the rule named in their
`// rule:` header. Use `pass` for false-positive regressions and `fail` for
confirmed true positives.

Every case is reproducible from its seed; reproducers for findings are written
to `tmp/fuzz-findings/`.

## Usage

```bash
pnpm fuzz                                  # fuzz all rules (from repo root)
FUZZ_RULE=no-array-index-as-key pnpm fuzz  # one rule (substring match)
FUZZ_TAG=design pnpm fuzz                  # every rule with one registry tag
FUZZ_ITERATIONS=200 FUZZ_SEED=42 pnpm fuzz # more cases, fixed seed
FUZZ_INVARIANTS=1 pnpm fuzz                # warn on invariant violations
FUZZ_STRICT=1 pnpm fuzz                    # fail on invariant violations too
FUZZ_CORPUS_DIR=~/corpus-repos pnpm fuzz   # also fuzz real files + crossover
FUZZ_PRINT_SILENT=1 pnpm fuzz              # list rules that never fired
FUZZ_PRINT_STATS=1 pnpm fuzz               # print executed, fired, and parse-skip counts
```

`scripts/measure-coverage.ts` and `scripts/measure-corpus-coverage.ts` (run
with `bun`) report generator/corpus fire-coverage when tuning snippet pools.

## Canonical corpora

Ready-made `FUZZ_CORPUS_DIR` targets — each script works on any machine
(no pre-existing cache required; the RDE repo cache at `~/.cache/rde/repos`
is used as a symlink fast path when present):

- **Pinned corpus sample** — `bun scripts/sync-fuzz-corpus.ts` materializes
  `tmp/corpus-repos/` from `scripts/corpus-repos.json`, a deterministic
  48-repo sample of the react-doctor-evals corpus (blob-filtered clones at
  pinned refs; incremental re-runs). The full 8.4k-repo manifest lives in
  `react-doctor-evals/repos.json` if the sample ever needs regenerating.
- **react-bench RD-health targets** — `bun scripts/build-bench-corpus.ts`
  (env: `REACT_BENCH`, optional `RDE_REPO_CACHE`) copies the benchmark's
  target files — each selected for having ≥6 severe React Doctor
  diagnostics — into `tmp/bench-corpus/`, cloning any missing repo at its
  pinned SHA. Densest seeds available: ~60 files fire ~90+ distinct rules.
- **Any directory of cloned repos** (e.g. the RDE cache itself when
  present: 200 of its files fire ~110 distinct rules).

`pnpm test` in this package runs only the always-on harness smoke tests
(including a generator-health check: 100 seeded programs must parse cleanly);
the full fuzz run is opt-in via `REACT_DOCTOR_FUZZ=1` (what `pnpm fuzz` sets).

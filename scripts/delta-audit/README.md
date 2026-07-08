# Corpus delta audit

Automated regression guard for false-positive sweeps: scans a pinned corpus of
public OSS React repos with the locally built CLI, aggregates per-rule finding
counts, and diffs them against the checked-in `baseline.json`. Catches dead
rules (a rule that used to fire going silent) and FP explosions (a rule's count
blowing up) without anyone manually re-running the tool over repos.

Runs nightly and on `workflow_dispatch` via `.github/workflows/delta-audit.yml`
(not part of PR CI — a full run takes ~1.5 minutes of scanning plus install +
build).

## Files

- `corpus.json` — the corpus: public repos pinned to exact commit SHAs, each
  shallow-cloned at scan time. An optional `subdirectory` scopes the scan when
  the interesting app lives below the repo root (e.g. `bulletproof-react`'s
  root is a docs shell around `apps/*`).
- `run-delta-audit.ts` — the runner (clone, scan, aggregate, compare).
- `baseline.json` — per-repo `ruleCounts` produced by a trusted build.
- `constants.ts` — alert thresholds and timeouts.

## Commands

Build first — the runner uses `packages/react-doctor/dist/cli.js`:

```bash
pnpm build
```

Compare the current build against the baseline (what CI runs; exits non-zero
when a threshold trips):

```bash
node --experimental-strip-types --no-warnings scripts/delta-audit/run-delta-audit.ts \
  --compare scripts/delta-audit/baseline.json
```

Refresh the baseline (run this after an intentional rule change, and commit the
result):

```bash
node --experimental-strip-types --no-warnings scripts/delta-audit/run-delta-audit.ts \
  --out scripts/delta-audit/baseline.json
```

Quick iteration on a subset of the corpus:

```bash
node --experimental-strip-types --no-warnings scripts/delta-audit/run-delta-audit.ts \
  --only alan2207/bulletproof-react,shadcn-ui/taxonomy --out /tmp/results.json
```

## Alert thresholds (`constants.ts`)

- **Dead rule** — a rule with >= 5 findings in the baseline drops to 0.
- **Spike / drop** — a rule's total changes by >= 3x in either direction with
  an absolute delta >= 20.

Single-digit jitter is deliberately below both thresholds: a couple of rules
flake by one count between runs, and clone-time-identical scans occasionally
differ by a finding.

## Changing the corpus

Pin every entry to an exact SHA and verify it exists first:

```bash
git ls-remote https://github.com/<owner>/<repo>.git refs/heads/<default-branch>
```

Prefer repos with a shallow-clone footprint under ~150 MB. After any corpus
change the baseline no longer matches (the compare mode fails fast on a
repo/SHA mismatch) — refresh it with the `--out` command above.

## Scan configuration

Each clone gets a `doctor.config.json` with `adoptExistingLintConfig: false`
so counts measure react-doctor's curated rule set only (corpus repos' own lint
configs would skew counts and can't resolve without `pnpm install`). Scans run
with `--no-score --no-dead-code --no-supply-chain` and
`REACT_DOCTOR_NO_TELEMETRY=1` / `REACT_DOCTOR_NO_CACHE=1` /
`SENTRY_TRACES_SAMPLE_RATE=0`, so nothing needs network access beyond the
clones and supply-chain scores can't drift into the counts. A scan whose lint
pass degrades (surfaced via `skippedChecks` / `skippedCheckReasons`) is
retried once and then fails the run rather than polluting results.

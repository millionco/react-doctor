---
name: rde-eval
description: Run the react-doctor-evals (RDE) harness to test a local rule change against the OSS corpus — locally for fast iteration, or fanned out to the cloud (Vercel Sandbox) for scale. Use after rule tests pass, when checking a new or changed rule for false positives across real repos, or whenever rule-validate's "RDE Rule Validation" step calls for it.
---

# RDE Eval

Test a react-doctor rule change against thousands of OSS repos with the
`react-doctor-evals` (RDE) harness. Two modes:

- **local** — spawn react-doctor as a child process on your laptop. Fast, no
  creds, uses your working tree (incl. uncommitted edits).
- **cloud** — Vercel Sandbox microVMs (4 vCPU / 8 GB). Fan out to 50+ repos in
  parallel. Requires a **pushed** branch.

> **Validating an oxlint lint rule? Use local.** Observed: cloud runs currently
> fire only the **project-level analyzers** (dead-code, supply-chain, security —
> ~15 rules) and **not the oxlint AST rule layer** (the 100+ per-element rules in
> `oxlint-plugin-react-doctor`). A 139-repo cloud run produced 15 distinct rules /
> **0** oxlint hits; the same corpus locally produced 150+ distinct rules / 1000s
> of hits. So for any rule in the oxlint plugin, cloud will report a **misleading
> 0** — run it **local**. Cloud is still valid for dead-code / supply-chain /
> security rules. (Root cause not yet diagnosed — treat as a known limitation.)

`$RD` is your react-doctor checkout — the one with the rule changes, at the
**monorepo root** (the CLI appends `packages/react-doctor/...`). `$EVALS` is the
react-doctor-evals checkout. Run every `node dist/cli.js` command from `$EVALS`.

## Setup (every run)

```sh
export RD=~/projects/million/react-doctor          # checkout with your rule changes (monorepo root)
export EVALS=~/projects/million/react-doctor-evals # the harness
cd $EVALS && git pull && pnpm install && pnpm build   # stale builds break cloud workers
(cd $RD && pnpm build)                                # local mode needs the built bin
```

Cloud mode also needs `$EVALS/.env.local` with **five** vars — the harness won't
boot (or sandbox provisioning 403s) if any is missing:

| var                 | how to get it                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | vercel.com → Account Settings → Tokens (with access to the team). An empty/expired value provisions a `403 invalidToken`. Sanity-check: `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" https://api.vercel.com/v2/user` → `200`. |
| `VERCEL_TEAM_ID`    | `node setup.mjs`, or `orgId` in `$EVALS/.vercel/project.json`.                                                                                                                                                                                             |
| `VERCEL_PROJECT_ID` | `node setup.mjs`, or `projectId` in `$EVALS/.vercel/project.json`. ⚠️ `vercel env pull` does **not** always write this one — copy it from `project.json` if absent.                                                                                        |
| `AXIOM_DATASET`     | Axiom dashboard. **Required even though traces only ship when `NODE_ENV=production`** — the harness reads it at boot, so a missing value is a hard `ConfigError`, not a silent no-op.                                                                      |
| `AXIOM_TOKEN`       | Axiom dashboard → API token.                                                                                                                                                                                                                               |

## Version specs

| spec                                                  | reaches cloud?  | notes                                                                |
| ----------------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| `path:$RD`                                            | NO — local only | your working tree incl. uncommitted edits; `--runner local` only     |
| `git:https://github.com/millionco/react-doctor@<ref>` | yes             | sandbox clones + `turbo run build`s the monorepo; ref must be pushed |
| `npm:<x.y.z>`                                         | yes             | published baseline                                                   |

> `path:` does **not** work with `--pool vercel`: the Vercel worker only
> uploads the evals tree, never the react-doctor checkout. (EVAL.md Flow 1 is
> stale on this.) Rules live in `oxlint-plugin-react-doctor`, a `workspace:*`
> dep of react-doctor, so you can't ship react-doctor alone — `git:` works
> because it builds the whole monorepo in the sandbox. For uncommitted changes
> in the cloud, push a scratch branch and use `git:`.

`--take N` caps repos (default = all of repos.json, ~8.4k — always cap while
iterating). `--dataset small|medium|large` = 50 | 500 | 1000.

## Local fast loop (no push)

```sh
node dist/cli.js run path:$RD --runner local --take 100
node dist/cli.js digest path:$RD --rule <rule>             # all hits for your rule
node dist/cli.js digest path:$RD --json --rule <rule> > hits.json
```

## Cloud loop (fan out)

```sh
# in $RD first: git push -u origin <branch>
B=git:https://github.com/millionco/react-doctor@main
C=git:https://github.com/millionco/react-doctor@<branch>
node dist/cli.js run "$B" --runner worker-pool --pool vercel --take 100
node dist/cli.js run "$C" --runner worker-pool --pool vercel --take 100
node dist/cli.js parity "$B" "$C" --verbose                # +added / -removed by your branch
node dist/cli.js parity "$B" "$C" --json > parity.json     # machine-readable
```

## Force a fresh run (cache)

Results are cached per spec in `$EVALS/.evals/<sanitized-spec>.jsonl`. Re-running
the same spec logs `N repos already processed. continuing…` and **serves the
cache as-is — including repos that previously errored**, so a failed run blocks
its own retry and returns stale/empty results. To force a clean run, delete that
spec's file first:

```sh
# cloud (git: spec) — slashes/colons become dashes
rm "$EVALS/.evals/https---github-com-millionco-react-doctor-<branch>.jsonl"
# local (path: spec) — the absolute path with slashes → dashes
rm "$EVALS/.evals/-Users-...-<your-rd-checkout>.jsonl"
```

Tip: check `wc -l` on the file and confirm entries aren't all `"error"` before
trusting a digest. Pinning a commit SHA (`git:…@<sha>`) instead of a branch name
is also a fresh cache key.

## Read the diff

- `+` = your branch adds a diagnostic; `-` = drops one.
- New rule → every hit is a `+`. On an existing rule: net-negative = less noise
  (good if dropping false positives), net-positive = more findings (good if
  true positives).
- Net 0 with identical files/lines = no functional change (likely message-text
  diffs only).

## Validate hits, then fix

For each hit (or a sample per rule when counts are high):

1. `git clone --depth 1 <url> /tmp/x` at the pinned `ref`.
2. Read `filePath:line:column`; is the pattern really there, and is the rule's
   call correct for that context?
3. Classify true positive / false positive.
4. Add a regression test for every false positive, re-run, confirm it's gone.

Feed the counts (repos scanned, rootDir scans, target diagnostics, false
positives found) into rule-validate's eval table.

## Troubleshooting

- `checks skipped (likely OOM)` — oxlint OOM'd in a sandbox; huge single-project
  repos can hit the 8 GB cap. Skip that repo.
- `CreateSandboxError` / `InstallDepsError: npm install exited 1` — usually a
  stale evals build shipped to the worker. `cd $EVALS && git pull && pnpm install && pnpm build`.
- `ConfigError: Expected string … ["AXIOM_DATASET"]` — `.env.local` is missing
  `AXIOM_DATASET` / `AXIOM_TOKEN`. Set both (required at boot even with tracing off).
- `403 … "invalidToken": true` on sandbox create — `VERCEL_TOKEN` is empty or
  expired. Refresh it; verify with the `curl … /v2/user → 200` check above.
- `Service not found: rde/WorkerPool` — the `run` command's layer stack doesn't
  provide the pool service. `Runner.layerWorkerPool` must
  `Layer.provide(WorkerPool.layer)` (its `Worker` + `WorkerPoolConfig` deps are
  supplied by the command). Without it, `--pool vercel` dies before any scan.
- Whole run crashes mid-way on one repo (e.g. `ENOENT … pnpm-workspace.yaml` →
  schema-decode defect) — a single repo's `PlatformError` must not be fatal. The
  per-repo invoke in `Runner.run` isolates defects with `Effect.catchDefect`
  (fold into `Repository.WithFailure`); otherwise one odd monorepo takes down all
  N scans.
- No Vercel creds — drop `--runner worker-pool --pool vercel`; local is the default.

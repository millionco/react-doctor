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

Cloud mode also needs `$EVALS/.env.local` with `VERCEL_TOKEN`,
`VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` (run `node setup.mjs` once).

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
- No Vercel creds — drop `--runner worker-pool --pool vercel`; local is the default.

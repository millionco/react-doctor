# SlopBench

A benchmark for measuring how good individual models are at **frontend
engineering — and specifically how much React/TypeScript "slop" they produce**.

Unlike correctness-only SWE benchmarks, SlopBench scores **two axes** per task:

1. **Functional correctness** (gate) — hidden behavioral tests, exactly like
   [DeepSWE](https://github.com/datacurve-ai/deep-swe). If the feature does not
   work, the task is failed.
2. **Slop score** (0–100, continuous) — how clean the code the model wrote is,
   measured **offline** by [React Doctor](https://react.doctor) plus a strict
   TypeScript pass, Vercel-derived composition checks, and deslop heuristics.

A model can make the feature work and **still score poorly** for shipping slop
(inline components, array-index keys, `any`, type casts, `@ts-ignore`,
boolean-prop soup, …). The headline **reward** combines them:

```
reward = functional_pass × (slop_score / 100)
```

## Task format

SlopBench uses the [Harbor](https://www.harborframework.com/docs/tasks) task
format (so it runs under [Pier](https://github.com/datacurve-ai/pier) /
Harbor unchanged):

```text
tasks/<id>/
  task.toml          metadata: family, target_dimensions, base commit, image, limits
  instruction.md     the prompt the agent sees (no mention of "slop" / quality)
  seed/              the starting project (committed as the base commit)
  environment/Dockerfile   reproduces the env (FROM slopbench-base)
  tests/
    test.sh          thin wrapper -> `slopbench-grade` (functional gate + slop scan)
    test.patch       hidden tests, applied at grade time
  solution/          reference clean solution (reviewer aid; never used at grading)
  _authoring/        human-readable source for the patches (solved/ + hidden/)
```

The verifier writes `reward.txt` (the composite float) and a rich
`slop-report.json` artifact (per-dimension scores + every violation).

## Quickstart (Pier — swappable harness)

The task format is harness-agnostic. Pier drives `mini-swe-agent` (model-agnostic)
**and** the CLI agents directly — pass `--agent` to switch:

```bash
git clone https://github.com/millionco/react-doctor
uv tool install datacurve-pier

# Build the shared base image once (provides react-doctor + slop-verify + grader)
docker build -t slopbench-base:latest -f packages/benchmark/tasks/_base/Dockerfile .

# Claude Code as the harness
export ANTHROPIC_API_KEY=...
pier run -p packages/benchmark/tasks --agent claude-code --model anthropic/claude-opus-4-7

# Codex
export OPENAI_API_KEY=...
pier run -p packages/benchmark/tasks --agent codex --model openai/gpt-5.5

# Other harnesses Pier drives directly:
pier run -p packages/benchmark/tasks --agent gemini-cli --model google/gemini-2.5-pro
pier run -p packages/benchmark/tasks --agent opencode  --model anthropic/claude-opus-4-7

# Model-agnostic harness (works with any provider)
pier run -p packages/benchmark/tasks --agent mini-swe-agent --model anthropic/claude-opus-4-7
```

Single task or a deterministic subset:

```bash
pier run -p packages/benchmark/tasks/notification-list --agent claude-code
pier run -p packages/benchmark/tasks --agent mini-swe-agent --n-tasks 3 --sample-seed 0
```

## Aggregating results into a scorecard

After a run, turn the per-task reports into one model scorecard:

```bash
node packages/benchmark/scripts/aggregate-results.mjs \
  --logs <pier-logs-dir> --model claude-opus-4-7 \
  --out packages/benchmark/results/claude-opus-4-7.json
```

It reports `functionalPassRate`, `meanSlopScore`, `meanReward`, and per-dimension
means — the shape a (v2) leaderboard renders. A web leaderboard is intentionally
out of scope for v1.

## Slop dimensions

Each violation maps to exactly one dimension (no double-counting — see
[`rule-overlap.md`](./rule-overlap.md)):

| Dimension                                                                    | Owner                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `react-correctness`, `react-performance`, `accessibility`, `maintainability` | React Doctor                                              |
| `bundle`, `async-waterfall`                                                  | React Doctor (specific rules rerouted)                    |
| `ts-strictness`                                                              | SlopBench TS checks (`any`, casts, `!`, `@ts-ignore`)     |
| `composition`                                                                | SlopBench Vercel checks (boolean-prop soup, render props) |

Weights live in [`scoring-profiles/default.json`](./scoring-profiles/default.json)
(mirrored by `src/constants.ts`); the active scoring version is stamped into
every report.

## Authoring a new task

```bash
cd packages/benchmark
# 1. scaffold boilerplate (task.toml, test.sh, Dockerfile, solve.sh)
scripts/scaffold-task.sh my-task produce-clean "ts-strictness" \
  "node --experimental-strip-types --test tests/my-task.test.ts" \
  "My task title" "One-line description"
# 2. author tasks/my-task/seed/, instruction.md,
#    _authoring/solved/** (clean reference) and _authoring/hidden/** (hidden tests)
# 3. generate the patches
scripts/gen-task-patches.sh tasks/my-task
# 4. validate end-to-end WITHOUT Docker (seed -> grade reference solution)
scripts/validate-task.sh tasks/my-task --expect-pass
```

Validate the whole corpus (reference solutions must pass + score reward>0):

```bash
scripts/validate-all.sh
```

Pure-TS tasks use Node's built-in test runner (`node --experimental-strip-types
--test`) and need no dependency install; React tasks use `vitest` +
`react-dom/server` (install happens at image-build time). Both run **air-gapped**
at agent time.

## The verifier CLI

`slop-verify` scores a graded diff directly (used by the grader, handy in dev):

```bash
slop-verify --root <project> --base <git-ref> --json
```

See `slop-verify --help` for all flags (`--profile`, `--functional-pass`,
`--out`, `--fail-under`, …).

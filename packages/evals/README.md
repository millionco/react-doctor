# React Doctor evals

Run a pushed React Doctor revision against 100 selected repositories with Daytona. The evaluator builds one snapshot, creates one sandbox per repository, and writes newline-delimited JSON (NDJSON) results.

Set `DAYTONA_API_KEY`, then run:

```sh
cd packages/evals
nr eval --react-doctor-ref <pushed_commit> > results.ndjson
```

The default [repository corpus](./repositories.json) contains the 100 highest-ranked repositories and 255 project roots. React Bench ranks repositories by recommended React pull requests, candidate count, issue-linked pull requests, and merged pull requests scanned. Matching React Doctor Evals entries retain their pinned revisions and monorepo roots. Deterministically slow roots are excluded.

The evaluator accepts corpus JSON, `owner/name` text files, prior result NDJSON, URLs, and directories. Repeat `--repositories` to combine sources:

```sh
nr eval \
  --repositories ./repositories.json \
  --repositories ./extra-repositories.txt \
  --concurrency 10 \
  --react-doctor-ref <pushed_commit>
```

Text entries use each repository's default branch. Output records replace `HEAD` with the resolved commit hash, so a baseline NDJSON file can pin the candidate run.

Candidate runs reject baseline records that still contain `HEAD`. Evaluation concurrency defaults to 500, while sandbox creation is capped at 20 to avoid overloading Daytona. After the initial pass, the evaluator cleans up resources and retries failed projects at concurrency 50, then 10. Valid partial reports remain in the corpus. Execution failures make the command exit non-zero.

Progress and completion metrics use stderr. Results use stdout. The evaluator deletes every repository sandbox and the build snapshot after the run.

The React Doctor revision must exist in the configured Git repository. Use `--react-doctor-repository` for a fork.

# React Doctor evals

This package runs a pushed React Doctor ref across the combined React Doctor and React Bench corpus with Daytona. It builds React Doctor once, forks that seed sandbox for each repository, scans every project root, and streams versioned NDJSON results.

Set `DAYTONA_API_KEY`, then run:

```sh
cd packages/evals
nr eval -- --react-doctor-ref <pushed-react-doctor-commit> > results.ndjson
```

The default corpus combines pinned projects from the sibling `react-doctor-evals/repos.json` with the repository-mining lists copied from `react-bench-internal/pipeline/generator/data`. It currently contains 30,702 project roots across 25,469 repositories. Duplicate React Bench entries are removed, and a pinned RDE repository takes precedence over a matching default-branch entry. The default concurrency is 500 repository sandboxes.

Pass JSON arrays, React Bench-style `owner/name` text files, result NDJSON, or directories containing `.json` and `.txt` sources. Repeat `--repositories` to combine inputs:

```sh
nr eval -- \
  --repositories ./repositories.json \
  --repositories ./repositories \
  --concurrency 10 \
  --react-doctor-ref <pushed-react-doctor-commit>
```

Text-list repositories start from the remote default branch. The evaluator replaces `HEAD` with the resolved commit SHA in every output record, so a baseline NDJSON file can be used directly as the candidate corpus for an exact comparison.

Each stdout line has `schemaVersion`, resolved repository identity, and either `report` or `error`. Progress and the final completion-rate metric go to stderr. Every fork and the seed sandbox are deleted after the run.

The React Doctor ref must be available from `https://github.com/millionco/react-doctor.git`. Use `--react-doctor-repository` when evaluating another fork.

If fewer than 95% of corpus projects complete in three consecutive full runs, lower the default concurrency.

# React Doctor evals

This package runs a pushed React Doctor ref across the full `react-doctor-evals` corpus with Daytona. It builds React Doctor once, forks that seed sandbox for each pinned repository, scans every project root in the checkout, and streams versioned NDJSON results.

Set `DAYTONA_API_KEY`, then run:

```sh
cd packages/evals
nr eval -- --react-doctor-ref <pushed-react-doctor-commit> > results.ndjson
```

The default corpus is `repos.json` from the sibling `react-doctor-evals` checkout, currently 8,423 project roots. The default concurrency is 500 repository sandboxes. Override either when testing locally:

```sh
nr eval -- \
  --repositories ./repositories.json \
  --concurrency 10 \
  --react-doctor-ref <pushed-react-doctor-commit>
```

Each stdout line has `schemaVersion`, repository identity, and either `report` or `error`. Progress and the final completion-rate metric go to stderr. Every fork and the seed sandbox are deleted after the run.

The React Doctor ref must be available from `https://github.com/millionco/react-doctor.git`. Use `--react-doctor-repository` when evaluating another fork.

If fewer than 95% of corpus projects complete in three consecutive full runs, lower the default concurrency.

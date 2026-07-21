# React Doctor evals

Run a pushed React Doctor revision against 2,000 pinned repositories with Daytona. The evaluator builds one snapshot, scans one representative project root per repository, reuses each sandbox for several repositories, and writes newline-delimited JSON (NDJSON) results. Every rule known to the evaluated revision is enabled at error severity in the requested root and every nested package. Inline disable directives and existing lint configs are ignored so parity runs expose detector changes across the full registry.

Set `DAYTONA_API_KEY`, then run:

```sh
cd packages/evals
nr --silent eval --react-doctor-ref <pushed_commit> > results.ndjson
```

The default [repository corpus](./repositories.json) contains 2,000 repositories and 5,824 available project roots selected from the canonical React Doctor Evals corpus. Every repository is pinned to a commit so repeated runs inspect the same source. Runs inspect the first root from each repository by default for breadth within the time budget; use `--project-roots-per-repository` for deeper monorepo coverage.

The corpus excludes 200 [measured slow repositories](./excluded-slow-repositories.json) whose representative root took at least 60 seconds, returned incomplete lint coverage, or could no longer be fetched at its pinned revision in the 2026-07-19 Daytona runs. Later pinned repositories from the canonical corpus replace them so the default remains at 2,000 repositories.

The evaluator accepts corpus JSON, `owner/name` text files, prior result NDJSON, URLs, and directories. Repeat `--repositories` to combine sources:

```sh
nr --silent eval \
  --repositories ./repositories.json \
  --repositories ./extra-repositories.txt \
  --repository-limit 2_000 \
  --concurrency 200 \
  --repositories-per-sandbox 10 \
  --project-roots-per-repository 1 \
  --max-duration-minutes 30 \
  --react-doctor-ref <pushed_commit>
```

Text entries use each repository's default branch. Output records replace `HEAD` with the resolved commit hash, so a baseline NDJSON file can pin the candidate run.

Candidate runs accept only complete, schema-valid baseline records pinned to full commit hashes. Evaluation concurrency defaults to 200 batches, with a target of 10 repositories per sandbox. Sandbox creation is capped at 20 to avoid overloading Daytona, so a 2,000-repository run uses about 200 sandboxes instead of provisioning 2,000. Batches are balanced by project-root count so large monorepos do not collect on one worker.

The default 30-minute wall-clock budget stops initial-pass commands after 18 minutes, the first retry after 23 minutes, and the final retry after 28 minutes. The last two minutes remain reserved for deleting sandboxes and the snapshot. Override the corpus size, batch size, concurrency, or duration for smaller investigations. After the initial pass, the evaluator retries failed or incomplete projects at concurrency 50, then 10 in isolated sandboxes. Malformed and incomplete reports make the command exit non-zero instead of presenting partial coverage as a completed evaluation.

Progress and completion metrics use stderr. Results use stdout. The evaluator deletes every repository sandbox and the build snapshot after the run.

The React Doctor revision must exist in the configured Git repository. Use `--react-doctor-repository` for a fork.

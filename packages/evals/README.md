# React Doctor evals

Run a pushed React Doctor revision against 2,000 pinned repositories with Daytona. The evaluator builds one snapshot, scans one representative project root per repository, reuses each sandbox for several repositories, and writes newline-delimited JSON (NDJSON) results. Every rule known to the evaluated revision is enabled at error severity in the requested root and every nested package. Inline disable directives and existing lint configs are ignored so parity runs expose detector changes across the full registry.

Set `DAYTONA_API_KEY`, then run:

```sh
cd packages/evals
nr --silent eval --react-doctor-ref <pushed_commit> > results.ndjson
```

The default [repository corpus](./repositories.json) contains 2,000 repositories and 5,770 available project roots selected from the canonical React Doctor Evals corpus. Every repository is pinned to a commit so repeated runs inspect the same source. Runs inspect the first root from each repository by default for breadth within the time budget; use `--project-roots-per-repository` for deeper monorepo coverage.

The corpus excludes 219 [measured slow repositories](./excluded-slow-repositories.json) whose representative root took at least 60 seconds, returned incomplete lint coverage, or could no longer be fetched at its pinned revision in the 2026-07-25 Daytona runs. Later pinned repositories from the canonical corpus replace them so the default remains at 2,000 repositories.

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

## FP/FN mining with Jev

`nr mine` composes the existing Daytona scanner with [TypeSafe AI's Jev evaluation model](https://vercel.com/docs/ai-gateway/modalities/evaluation), through Vercel AI Gateway. It takes each diagnostic's source file and rule description, classifies it, and logs likely false positives. Optional sampling checks files where a rule did not fire for likely false negatives.

Use Node 22.13+ (required by the AI SDK), set `DAYTONA_API_KEY` and `AI_GATEWAY_API_KEY`, then, from this directory:

```sh
# One pass: scan an initial batch and check reported findings.
nr mine --output .fpfn --limit 1000 -- \
  --react-doctor-ref <pushed_commit> \
  --repositories repos.txt --repository-limit 100 --concurrency 20

# Repeat, waiting 60 minutes after each cycle; also sample 10 silent files per rule/project.
nr mine --output .fpfn --interval-minutes 60 --silent-files 10 --limit 10000 -- \
  --react-doctor-ref <pushed_commit> \
  --repositories repos.txt --repository-limit 2000 --concurrency 50

# Reuse an existing parity/eval scan, without creating Daytona resources.
nr mine --input treatment.ndjson --output .fpfn
```

Arguments after `--` go directly to the existing evaluator. `repos.txt` can contain one `owner/name` per line; those entries follow their default branches on each cycle, and the scan records the resolved commit. Pinned corpus JSON keeps checking the same revisions. Add repositories to the input list between cycles to expand coverage. This loop consumes your repository list; it does not search GitHub for repositories.

FP-only is the default (`--silent-files 0`). FN mining iterates the rule catalog over a deterministic sample of analyzed files without that rule's diagnostic. Increase `--silent-files` to inspect more files, and `--limit` to process more candidates per cycle. Preparation allocates the budget across the **whole input**, round-robin by repository, then rule, choosing files by a versioned deterministic hash. It groups repeated sites in a file/rule before selection and retains their occurrence IDs, locations, messages, and counts. The model judges the group's first location only; its verdict must not be imputed to every member. The cap includes incomplete contexts and cache hits, so identical inputs select identical groups without additional calls. Run FP-only and FN-sampling passes separately when you need an explicit budget for each.

Mining defaults to `--population default`: only rules marked default-enabled in the pinned detector catalog are eligible. `--population exhaustive` also selects optional style and legacy-runtime policies. This selection filter does **not** change the parity scanner's all-rules configuration. Historical `--input` records with empty `ruleKeys` retain `scan: exhaustive` provenance even when mining filters to default rules. Explicit scan rule lists are labeled separately. Neither population observes repository-adopted policy: existing lint configs and inline disables were ignored by the evaluator. A `--rules` override is labeled `explicit-contract` and selects those supplied contracts; an optional `--rule` filter requires `--population exhaustive`.

Each cycle stores `scan.ndjson` (for fresh scans), `candidates.ndjson`, `candidates.ndjson.selection.json`, and `results.ndjson` in a unique directory. The selection manifest reports eligible/selected repository, rule, group and occurrence counts, plus per-repository/rule quotas. Two input passes retain counts per stratum and at most `--limit` group descriptors, in addition to one parsed scan record; source is loaded only after selection, in bounded batches. Duplicate identical scan records are ignored; conflicting duplicates or changes between passes fail preparation. Keep the input immutable during preparation.

The shared `issues.ndjson` appends only `candidate_fp` / `candidate_fn` results, deduplicated by policy decision ID across restarts. Schema-v2 assessments are cached independently of threshold: changing `--threshold` recomputes decisions without new model calls. Source, contract, pinned revision, evidence, schema, prompt, model and SDK adapter identity invalidate the assessment cache. Schema-v1 candidate files remain readable with legacy threshold-dependent cache behavior; old cache entries cannot masquerade as v2 assessments. Re-prepare historical scan artifacts to obtain balanced selection, provenance and improved context. API/schema errors are not cached. Run one mining process per output directory.

The loop reports scan failures and model errors, retains successful records, and exits nonzero if either occurred. Failed scan records are counted and skipped; incomplete successful reports still fail validation. A positive interval repeats after recoverable scan/model failures; invalid inputs or preparation failures stop the loop. It runs in the foreground until interrupted, so use your existing job scheduler or process supervisor for unattended operation.

### Rule descriptions and source

By default, preparation reads titles, recommendations, default-enabled status and applicability metadata from the detector revision's generated rule catalog. It fetches the catalog and source from exact GitHub commit URLs. Framework/capability/version gates accompany the descriptions, and project facts accompany each code file. Canonical exceptions/settings for `jsx-props-no-spreading` and `react-in-jsx-scope` are verified against supported source hashes at that commit; unsupported revisions require review or explicit contracts. Spreading settings describe the isolated evaluator's effective defaults, not repository preferences. Other catalog descriptions remain a first-pass rubric and do not capture every implementation exception.

`react-in-jsx-scope` additionally requires pinned build evidence. The conservative resolver handles a direct `tsc` build, strict-JSON tsconfig/jsconfig files and relative inheritance inside the repository, retaining content hashes and relevant facts. It checks ancestor manifests and known Babel/SWC/bundler configs, limits reads to 64 files of 16,000 characters each and inheritance/ancestor depth to 12, and never executes config code. Package-based inheritance, JSONC, explicit file-selection patterns, project references, custom factories, typechecking-only builds, unresolved build commands and alternate transforms remain **unknown** and produce review without a model call. React version alone never establishes JSX runtime. This intentionally abstains on many bundler projects until their transform resolver is supported. Source/comments, project metadata and config contents remain untrusted evidence; detector outcomes and diagnostic messages are excluded from Jev state.

For more precise adjudication, override the catalog with a JSON array of contracts using `--rules contracts.json`:

```json
[
  {
    "key": "react-doctor/jsx-no-duplicate-props",
    "description": "A JSX opening element must not repeat an explicit identifier attribute name.",
    "exceptions": [
      "Names are case-sensitive.",
      "Ignore spread attributes and namespaced attributes."
    ]
  }
]
```

Use rule keys that exist at the evaluated detector revision. Scoped evaluation records only permit their enabled rule keys; an empty provenance `ruleKeys` list means the evaluator enabled all rules available at that revision. Automatic catalog loading follows that scope. Supply contracts for external rules absent from the catalog, for older revisions without the generated catalog, or when using a non-GitHub detector fork. Whole-tree security and project-analysis rules are excluded from automatic catalog selection because their evidence can fall outside the linted source-file coverage. Overlapping project coverage for the same file/rule fails preparation rather than billing duplicate groups or silently choosing conflicting project facts.

Preparation requires complete **v3 full-scan eval records**, including pinned repository and detector commits, rule-set hash, project roots, and analyzed file coverage. Use the baseline or treatment NDJSON from parity, not the comparison summary. Files come from the scanned repository root at its recorded commit; arbitrary paths outside that root are rejected. Public GitHub source is supported directly. Unavailable/private source, files over 48,000 characters, and invalid diagnostic locations become `review` outcomes without model calls. Files are never silently truncated.

### Separate preparation and classification

The stages can also run independently:

```sh
nr classify prepare --input treatment.ndjson --output candidates.ndjson \
  --rule react-doctor/jsx-no-duplicate-props --silent-files 10 --limit 10000

# Validates candidates without credentials or Gateway calls.
nr classify run --input candidates.ndjson --output validated.ndjson --dry-run

nr classify run --input candidates.ndjson --output results.ndjson \
  --concurrency 8 --limit 10000 --threshold 0.9 --cache .classification-cache
```

Outputs are created exclusively: choose a new output filename to resume, reusing the cache directory. Duplicate candidates within a run are classified once. Classification emits one JSON summary to stderr, including processed/cache/error counts, newly billed input-token usage when provided, and verdict counts by rule. Preparation reports its prepared, incomplete-context, and skipped-scan counts. The SDK retries transient failures twice and each request has a 60-second deadline.

Assessment validation matches AI SDK 7.0.105: distributions keep their exact values and must sum to one within `1e-6 + 3 × 0.5 × 10^-probabilityDecimals` when rounding is declared (otherwise `1e-6`). The chosen option must have maximal probability. Declared rounding, Boolean `P(true)`, sanitized provider routing metadata and response ID/model/timestamp are retained. Response headers/bodies are excluded from successful provenance. Rejected answers retain bounded sanitized evidence (8,000 serialized characters); no malformed distribution is normalized into a valid one.

Jev receives two typed questions: `violation | valid | insufficient_context`, and whether the context suffices to judge the rule. A decisive label requires both the selected answer's probability and context-sufficiency probability to meet the threshold (default `0.9`):

| Detector           | Jev                             | Result         |
| ------------------ | ------------------------------- | -------------- |
| Reported a finding | Valid code                      | `candidate_fp` |
| No finding         | Rule violation                  | `candidate_fn` |
| Reported a finding | Rule violation                  | `likely_tp`    |
| No finding         | Valid code                      | `likely_tn`    |
| Either             | Uncertain or missing context    | `review`       |
| Either             | API failure or malformed answer | `error`        |

These are triage candidates, not ground truth or measured precision/recall. FNs are file-level leads, with no invented source line; the sample excludes files where the same rule already fired and can miss additional violations within those files. Cross-file rules often need review. Before changing a detector, check the pinned source, the rule's deliberate exclusions, and a reproducer. Start with a manually reviewed calibration set; compare confirmed findings per reviewed candidate across rules before increasing spend. Rework or stop a rubric that produces mostly rejected candidates.

Source code is sent to Vercel AI Gateway with `zeroDataRetention` requested, and is retained locally in the candidate/result/cache artifacts. Keep those artifacts in your evaluation storage. The Jev API is experimental; this package pins the SDK versions used by the runner.

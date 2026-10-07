---
name: benchmark-fp-fn-audit
description: Audit React Doctor against ReactBench or similar diagnostic benchmark corpora for confirmed false positives, false negatives, taxonomy gaps, and verifier artifacts. Use when analyzing rd.log, rd-before.json, rd-after.json, model.patch, result.json, reward/test logs, rule distributions, or when asked to perform a second adversarial pass over React Doctor benchmark findings.
---

# React Doctor benchmark FP/FN audit

Perform an evidence-backed audit of React Doctor diagnostics across a benchmark corpus. Read the complete rule documentation, quantify the distribution of failures, inspect every relevant trial artifact, and independently perform a second pass for additional false positives and false negatives.

## Corpus and required resources

For this benchmark, use:

```text
/home/aidenybai/Developer/react-bench-internal/jobs/ReactBench-v1.1-beta-rd-0.9.3-consolidated-final-20260801
```

Read the complete React Doctor rule documentation from:

```text
https://www.react.doctor/docs/rules
```

Read these repository review materials when they exist:

```text
/home/aidenybai/Developer/react-bench-internal/docs/aiden-review
```

Do not treat prior reviews or reports as ground truth. Use them as leads and reverify every claim against the current benchmark revision.

For every inspected trial, locate and read:

- `verifier/model.patch`
- `verifier/rd-before.json`
- `verifier/rd-after.json`
- `verifier/rd.log`
- `result.json`
- reward and test logs, discovered with `rg --files`
- the task README, prompt, or review material
- the base and patched source files referenced by the patch

Inspect all trial directories, including primary and verified variants. Normalize duplicate task names and repeated patch hashes before computing task-level statistics.

## Evidence rules

Classify findings conservatively:

- **Confirmed FP**: a diagnostic is caused by changed code, the behavior is intentional or required, and the rule contract does not apply or its recommended fix would regress behavior.
- **Confirmed FN**: a real defect exists in the base or final code, no applicable diagnostic is emitted, and an existing documented rule should cover it.
- **Taxonomy gap**: a real defect is present but no existing rule contract reasonably claims to cover it.
- **Harness artifact**: the result is caused by malformed output, stale baseline data, verifier behavior, generated files, or an untouched-file diagnostic.
- **Candidate**: plausible but missing enough evidence for confirmation.

Do not call a target-task miss a false negative. Do not call a diagnostic a false positive merely because the model failed tests. `react_doctor=1` is a gate result, not proof that the code is correct.

Every confirmed finding must cite the exact trial, file, line or code span, rule documentation, diagnostic delta, task behavior, and test result. Separate strict rule misses from out-of-taxonomy gaps.

## Workflow

### 1. Inventory the corpus

Use `rg --files` to enumerate trial artifacts. Record the benchmark revision, trial count, missing artifacts, duplicate variants, malformed reports, and available task reviews. Do not silently skip incomplete trials.

### 2. Build diagnostic distributions

Recompute distributions from raw `rd.log`, `rd-before.json`, and `rd-after.json` data. Rank by trial coverage before raw occurrence count. Report:

- total trials and artifact completeness;
- reward, test, and React Doctor gate tuple counts;
- direct `NEW` or introduced-diagnostic failures;
- health-mode `NEW` deltas;
- health-mode `STILL` target misses;
- baseline-to-head rule-count deltas;
- rule, category, severity, task, repository, and file concentration;
- changed-file versus untouched-file diagnostics;
- malformed or truncated reports;
- primary versus verified-task duplication;
- successful versus unsuccessful patch comparisons.

Always recompute before relying on a prior summary. Large files can inflate occurrence counts, so show both occurrence count and affected-trial count.

### 3. Inspect high-impact clusters

Prioritize high-coverage rules and exact introduced-diagnostic failures, especially:

```text
exhaustive-deps
no-giant-component
js-set-map-lookups
no-array-index-as-key
js-combine-iterations
effect-needs-cleanup
no-adjust-state-on-prop-change
button-has-type
prefer-module-scope-static-value
no-static-element-interactions
prefer-module-scope-pure-function
no-pass-data-to-parent
no-pass-live-state-to-parent
no-derived-state
no-ref-current-in-render
click-events-have-key-events
rerender-lazy-ref-init
only-export-components
rerender-lazy-state-init
```

For each high-impact cluster, inspect representative positives, representative negatives, the largest task concentration, and sibling trials with different outcomes.

### 4. Perform the independent second pass

Search every trial for additional candidates, not just the known clusters. Apply these heuristics:

- Separate expensive lazy initialization from cheap empty `Map`, `Set`, and equivalent containers.
- Distinguish render-derived state from async status, media errors, retries, resource lifetimes, subscriptions, and transient UI state.
- For controlled components, distinguish required parent synchronization from effect loops or unnecessary data forwarding.
- Follow dangerous HTML values through local aliases, `useMemo`, wrappers, and helper functions; preserve provenance for trusted serializers such as KaTeX.
- Distinguish React-docs-blessed previous-prop comparisons from pure derived state and render-phase side effects.
- Inspect timers, promises, animations, abort signals, subscriptions, and stale closures for races that generic dependency or cleanup warnings do not directly explain.
- Check focus stealing, focus restoration, controlled selection, keyboard semantics, and ARIA transitions.
- Check thresholds, aliasing, destructuring, nested callbacks, JSX wrappers, computed properties, and TypeScript syntax.
- Verify that a diagnostic is on changed code and not a pre-existing issue, generated artifact, fixture, or untouched neighbor.
- For every proposed FP, find a nearby true-positive counterexample. For every proposed FN, find a nearby case the detector catches.

Known leads to independently recheck, without presuming their classification:

```text
fix-react-rdh-nteract-semiotic-a__5uDDmgx
write-react-glific-glific-fronte__22Gg4p2
fix-react-jumperexchange-jumper__2GBTh7Z
write-react-frankchen021-datasto__2N6xFwQ
fix-react-viclafouch-mui-tel-inp__hQXzJgB
fix-react-floating-ui-floating-u__27iKG4t
fix-react-formidablelabs-victory__2uwi2vz
fix-react-igordanchenko-yet-anot__2GZGZYT
fix-react-rdh-appflowy-io-appflo__vK9uEUy
```

### 5. Produce audit artifacts

Write audit-only outputs under the benchmark directory:

```text
audit/rd-0.9.3-second-pass.md
audit/rd-0.9.3-second-pass.jsonl
audit/rd-0.9.3-rule-distribution.tsv
```

Do not edit React Doctor source, benchmark source, task tests, or verifier data. The JSONL must contain one record per finding with:

```json
{
  "id": "...",
  "classification": "confirmed_fp | confirmed_fn | taxonomy_gap | harness_artifact | candidate",
  "confidence": "high | medium | low",
  "rule": "...",
  "task": "...",
  "trial": "...",
  "file": "...",
  "lines": "...",
  "evidence": "...",
  "baselineDiagnostics": "...",
  "headDiagnostics": "...",
  "testStatus": "...",
  "rdStatus": "...",
  "rationale": "...",
  "recommendedAction": "..."
}
```

The Markdown report must contain: corpus/methodology, distributions, confirmed FPs, confirmed FNs, taxonomy gaps, harness artifacts, manual-adjudication candidates, prioritized rule fixes, and limitations.

Prioritize fixes using:

```text
affected trial coverage × confidence × reproducibility
```

Never make a code change as part of this skill unless the user separately requests implementation of a confirmed rule fix.

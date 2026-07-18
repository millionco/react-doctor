---
name: rde-eval
description: Run a targeted local React Doctor Evals loop against an uncommitted rule change. Use after focused rule tests pass, while inspecting real open-source hits, or when rule-validate needs local false-positive evidence before pull request parity.
---

# Run a local rule evaluation

Use React Doctor Evals (RDE) for bounded local iteration. Use `run-parity` only after the change has a pushed pull request.

## Prepare both checkouts

```sh
export REACT_DOCTOR_CHECKOUT=/absolute/path/to/react-doctor
export RDE_CHECKOUT=/absolute/path/to/react-doctor-evals

git -C "$RDE_CHECKOUT" pull --ff-only
ni -C "$RDE_CHECKOUT"
nr -C "$RDE_CHECKOUT" build
nr -C "$REACT_DOCTOR_CHECKOUT" build
```

The `path:` spec reads uncommitted React Doctor changes. Run RDE commands from the eval checkout.

## Run a bounded sample

```sh
cd "$RDE_CHECKOUT"
node dist/cli.js run "path:$REACT_DOCTOR_CHECKOUT" --runner local --take 100
node dist/cli.js digest "path:$REACT_DOCTOR_CHECKOUT" --rule <rule-id>
node dist/cli.js digest "path:$REACT_DOCTOR_CHECKOUT" --json --rule <rule-id> > <artifact-directory>/hits.json
```

Increase `--take` only after tests and the first sample pass.

## Inspect target-rule hits

For each hit, or a representative sample when counts are high:

1. Open the pinned repository at the reported location.
2. Compare the code with the rule contract.
3. Classify the hit as true positive, false positive, or unsupported.
4. Add a rule regression test for each false positive.
5. Add confirmed false positives to the `fuzz` regression corpus.
6. Rebuild and rerun the same sample.

Record repository count separately from project-root count. Do not treat error records as clean scans.

## Report results

Report checkout revisions, target rule, repositories, project roots, diagnostics, inspected hits, fixed false positives, and the artifact path. State any setup error or skipped repository.

After local validation, return to `rule-validate`. That skill decides whether to invoke pull request parity.

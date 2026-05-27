---
name: rde-rule-validator
description: Use React Doctor Evals to test a newly implemented rule against many OSS repos. Use after targeted tests pass to check false positives, production feel, and real diagnostics.
---

# RDE Rule Validator

Use this for RDE workflow two: testing an implemented rule against OSS.

## Goal

Validate:

- The rule is not noisy.
- Diagnostics are real or explainable.
- The detector behaves well on production-shaped code.
- Unit tests did not miss important syntax or scope cases.

## Required Handling

- Scan distinct repos, not just manifest entries.
- Record rootDir scan count separately from repo count.
- Filter output to the target rule before judging results.
- Inspect every hit manually when counts are low.
- Sample hits manually when counts are high.
- Add regression tests for false positives found by evals.

## Record

Capture:

- React Doctor checkout path
- RDE eval harness path
- Repo manifest path
- Number of distinct repos
- Number of manifest/rootDir entries
- Target rule name
- Filtered output path
- Total target-rule diagnostics
- Manually inspected hits

## Output

Return:

- Eval summary
- PR-ready eval table
- False positives found
- Follow-up fixes or tests
- Artifact paths

## Reference

For eval table format and workflow details, read `docs/HOW_TO_WRITE_A_RULE.md`.

For example PR-ready summaries and inspection notes, read `examples.md`.

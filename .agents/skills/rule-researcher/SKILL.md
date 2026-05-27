---
name: rule-researcher
description: Research React Doctor rule ideas against docs, issues, OSS code, and similar tooling. Use when grounding a proposed rule, collecting real examples, or finding false-positive traps before implementation.
---

# Rule Researcher

Use this to ground a rule idea in real evidence.

## Research Targets

Collect:

- Official framework/library docs
- Runtime behavior explanations
- Real app examples
- Existing PRs or issues
- Accepted debugging answers
- Similar rules in other linters
- False-positive traps from OSS code

## Classification

Classify each example as:

- **Strong positive:** exact bug the rule should catch.
- **Pattern-adjacent:** related issue that may need a separate rule.
- **False-positive trap:** valid code the rule must not report.
- **Out of scope:** too dynamic, imported, semantic, or unsupported for v1.

## Output

Return:

- Evidence summary
- Positive candidate list
- False-positive trap list
- Suggested adversarial tests
- Detector implications
- Recommended v1 non-goals

## Reference

For RDE-backed research guidance, read `docs/HOW_TO_WRITE_A_RULE.md`.

For evidence classification examples, read `examples.md`.

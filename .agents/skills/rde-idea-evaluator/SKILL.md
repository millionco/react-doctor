---
name: rde-idea-evaluator
description: Use React Doctor Evals to validate rule ideas against open source repos before implementation. Use when testing a theory, looking for real examples, or collecting false-positive traps with RDE.
---

# RDE Idea Evaluator

Use this for RDE workflow one: validating an idea against OSS before implementation.

## Goal

Use RDE infrastructure to answer:

- Does this rule idea match real code?
- Are exact positives common?
- What valid patterns look suspicious?
- What should v1 skip?
- What tests should be generated?

## Inputs

Collect:

- Rule name
- One-sentence bug definition
- Positive examples
- Known valid examples
- RDE repo cache or manifest

## Output

Return:

- Strong positive examples
- Pattern-adjacent examples
- False-positive traps
- Detector implications
- Suggested adversarial tests
- V1 non-goals

## Prompt Shape

```md
Find real-world evidence for a React Doctor rule:

Rule: `<rule-name>`

Goal:
Find examples where <exact bug definition>.

Return:

- Strong positive examples
- Pattern-adjacent examples
- False-positive traps
- Detector implications
- Suggested adversarial tests

Prefer examples tied to real framework/library usage.
Do not treat similar-looking valid code as a positive.
```

## Reference

For full RDE workflow details, read `docs/HOW_TO_WRITE_A_RULE.md`.

For evidence classification examples, read `examples.md`.

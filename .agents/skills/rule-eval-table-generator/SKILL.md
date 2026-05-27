---
name: rule-eval-table-generator
description: Generate PR-ready eval result tables for React Doctor rules. Use when summarizing RDE outputs, filtered JSONL results, diagnostics, false positives, or production validation evidence.
---

# Rule Eval Table Generator

Use this after RDE workflow two.

## Inputs

Collect:

- Number of distinct repos scanned
- Number of rootDir scans or manifest entries
- Target rule name
- Total target-rule diagnostics
- False positives after manual inspection
- Filtered JSONL or summary artifact

## Output Table

Use this format:

| Check | Result |
| --- | --- |
| Repos scanned | `<number of distinct repos>` |
| RootDir scans | `<number of manifest/rootDir entries>` |
| Target rule | `<rule-name>` |
| Diagnostics | `<total target-rule diagnostics>` |
| False positives found | `<count after manual inspection>` |
| Output artifact | `<filtered JSONL / summary path or link>` |

## Rules

- Distinguish distinct repos from manifest/rootDir entries.
- Filter output to the target rule before summarizing.
- Do not claim zero false positives unless hits were manually inspected or sampled.
- Mention inspection method when diagnostics are nonzero.
- Keep the table short enough to fit in a PR description.

## Reference

For PR description guidance, read `docs/HOW_TO_WRITE_A_RULE.md`.

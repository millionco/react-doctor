# Rule PR Writer Examples

## PR Body Template

Use this shape in the PR body:

- `Why`
  - Catches `<specific issue>`.
  - Explain runtime reason in 1-3 sentences.
  - Add `Before` code block.
  - Add `After` code block.
- `What changed`
  - Added `<rule-name>`.
  - Detects `<main detection surface>`.
  - Reports `<exact condition>`.
  - Allows `<important valid patterns>`.
  - Adds tests for `<edge cases>`.
- `Eval results`
  - Include the eval table below when RDE was run.
  - Add an inspection note.
- `Test plan`
  - Focused test command.
  - Typecheck command.
  - Lint command.

## Filled Eval Table

| Check                 | Result                                                         |
| --------------------- | -------------------------------------------------------------- |
| Repos scanned         | `100`                                                          |
| RootDir scans         | `671`                                                          |
| Target rule           | `react-doctor/no-mutating-reducer-state`                       |
| Diagnostics           | `1`                                                            |
| False positives found | `0`                                                            |
| Output artifact       | `/tmp/rde/run/no-mutating-reducer-state.filtered-summary.json` |

Inspection note:

```md
Inspected the single target-rule diagnostic manually; it matched the intended v1 scope.
```

## Bad Eval Table

| Check         | Result        |
| ------------- | ------------- |
| Repos scanned | `100 entries` |
| Diagnostics   | `a few`       |

Problems:

- Confuses manifest entries with distinct repos.
- Does not name the target rule.
- Does not report false positives.
- Does not link an artifact.

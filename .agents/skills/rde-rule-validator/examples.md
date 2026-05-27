# RDE Rule Validator Examples

## PR-Ready Summary

```md
Ran RDE against 100 distinct repos from `repos.json`, covering 671 rootDir scans.
Filtered output to `react-doctor/no-mutating-reducer-state`.
The run produced 1 target-rule diagnostic.
Inspected the single diagnostic manually; found 0 false positives.
```

## Eval Table

| Check                 | Result                                   |
| --------------------- | ---------------------------------------- |
| Repos scanned         | `100`                                    |
| RootDir scans         | `671`                                    |
| Target rule           | `react-doctor/no-mutating-reducer-state` |
| Diagnostics           | `1`                                      |
| False positives found | `0`                                      |
| Output artifact       | `<filtered JSONL path>`                  |

## Inspection Notes

Low-volume:

```md
Inspected all 1 target-rule diagnostics manually; 1 was in scope and 0 were false positives.
```

High-volume:

```md
Sampled 50 of 1,240 diagnostics across the highest-volume repos and 10 single-hit repos; found 3 false positives. Added regression tests for each false-positive shape and reran the affected slice.
```

## Common Mistake

Wrong:

```md
Scanned 100 repos.
```

If the manifest has 100 entries but only 12 distinct repos, this is misleading.

Correct:

```md
Scanned 12 distinct repos across 100 rootDir entries.
```

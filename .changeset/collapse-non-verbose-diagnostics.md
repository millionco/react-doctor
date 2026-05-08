---
"react-doctor": minor
---

feat(react-doctor): collapse non-verbose diagnostics to top 3 rules

Without `--verbose`, the diagnostics list now shows only the 3 most
important rule groups (sorted by severity, then by descending issue
count) and collapses the remainder into a single summary line:

```
  ⚠ 4 more warnings
    Run `npx react-doctor@latest . --verbose` to get all details
```

When the hidden tail mixes severities, both counts are reported side
by side, e.g. `✗ 2 more errors  ⚠ 64 more warnings`. `--verbose` is
unchanged: every rule group with its per-file sites is still shown.

The `--verbose` flag description in `--help` and the README now
reflect the new default.

---
"oxlint-plugin-react-doctor": patch
---

perf: early-exit sweep — cheap discriminators now run before walks, scope lookups, and parent climbs across ~23 rules (raw-name bails before getElementType, whole-file import gates for the zod and recycler-list rules, substring gates before regex-heavy className analysis, filename gates hoisted to Program, and first-match pruning in containsFetchCall)

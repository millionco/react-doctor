---
"react-doctor": patch
---

Warn before mass-fixing a migration-scale bucket. When a single rule spans dozens of files (≥ `MIGRATION_SCALE_RULE_FILE_COUNT`, default 40), the report now prints a "Migration-scale change: sample before you sweep" advisory. It names the rule(s), explains the review risk, and points at `npx react-doctor@latest <path>` to scope the work down one area at a time.

The same guidance reaches coding agents. A new "Agent guidance" line and an inline note on any migration-scale bucket in the agent handoff prompt tell the agent to fix a representative sample, confirm the recipe holds, and get the code owner's sign-off before changing the rest, instead of mass-fixing a broad pattern in one unreviewed pass.

A new wide-event attribute (`migration.largestRuleBucketFiles`, plus `migration.largestRuleBucketSites` and `migration.largestRuleBucketRule`) records the widest-blast-radius rule per scan, so the threshold can be calibrated against real runs. No change to the score, exit code, or JSON report.

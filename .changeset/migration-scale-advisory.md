---
"react-doctor": patch
---

Warn before mass-fixing a migration-scale bucket. When a single rule spans many files (≥ `MIGRATION_SCALE_RULE_FILE_COUNT`, default 40) — e.g. `manual-memoization` firing across hundreds of files — the report now prints a "Migration-scale change — sample before you sweep" advisory naming the rule(s), explaining the review risk, and pointing at `npx react-doctor@latest <path>` to scope the work down one area at a time.

The same guidance reaches coding agents: a new "Agent guidance" line and an inline note on any migration-scale bucket in the agent handoff prompt tell the agent to fix a representative sample, confirm the recipe holds, and get the code owner's sign-off before sweeping the rest — instead of mass-fixing a broad pattern in one unreviewed pass.

A new wide-event attribute (`migration.largestRuleBucketFiles`, plus `…Sites` / `…Rule`) records the widest-blast-radius rule per scan so the threshold can be calibrated against real runs. No change to the score, exit code, or JSON report.

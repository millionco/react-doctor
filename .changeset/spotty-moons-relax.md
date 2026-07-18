---
"@react-doctor/core": patch
"react-doctor": patch
---

Exclude untracked TypeScript emit output from the scan: a .js file is dropped only when a complete untracked emit quartet (.js, .js.map, .d.ts, .d.ts.map) with exact source-map targets and matching sourceMappingURL references proves it duplicates a tracked same-stem .ts/.tsx source. Tracked JavaScript files and incomplete or mismatched output sets are still scanned.

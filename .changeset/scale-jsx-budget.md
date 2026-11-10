---
"@react-doctor/core": patch
---

Scale JSX node budget with project size and collapse duplicate incomplete reasons. The maintainability scan now uses a budget proportional to the number of JSX-capable source files (30 nodes per file, 50k floor) instead of a fixed 50k global budget, preventing false incompleteness on large repos. When the budget is exceeded, only one jsx-node-limit incomplete reason is pushed instead of one per exhausted file.

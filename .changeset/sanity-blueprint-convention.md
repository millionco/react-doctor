---
"@react-doctor/core": patch
---

Treat Sanity blueprint files as convention entries

`sanity.blueprint.ts` is a Sanity Studio convention file loaded by filename by the Sanity CLI (`sanity blueprints deploy`), similar to `sanity.config.ts` and `sanity.cli.ts`. It was incorrectly reported as unused by `react-doctor/unused-file`.

Fixes #1747

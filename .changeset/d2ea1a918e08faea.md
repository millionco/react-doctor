---
"oxlint-plugin-react-doctor": patch
---

fix(async-await-in-loop): recognize local Promise.allSettled wrappers

The rule no longer reports false positives when async map callbacks are passed to a local wrapper around `Promise.allSettled`, `Promise.all`, `Promise.race`, or `Promise.any`. The rule now correctly recognizes that operations are running in parallel when the mapped promises flow into a local function that internally uses promise concurrency.

---
"react-doctor": patch
---

Speed up cold scans and bound dead-code memory on multi-project workspaces.

- Overlap the project security scan with the lint pass instead of running it synchronously beforehand. The content-regex security sweep (shipped artifacts, dotenv, SQL — files lint never parses) was the single heaviest CPU phase on real repos and blocked the event loop the whole time. It now runs on a cooperative background fiber that yields between file chunks, so its cost hides under the subprocess-bound lint pass and stops starving a multi-project scan's concurrent git/network work. Cold scans are measurably faster (~30% on a mid-size project and workspace in local benchmarks); diagnostics are byte-identical.
- Cap concurrent dead-code (deslop) workers by a memory budget so a multi-project scan can't oversubscribe memory with many simultaneous worker processes on a small CI runner. On a roomy machine the cap exceeds the project count, so nothing serializes and scan time is unchanged.
